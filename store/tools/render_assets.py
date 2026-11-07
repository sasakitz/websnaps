#!/usr/bin/env python3
"""Capture the actual unpacked extension in an isolated Chrome profile.
Requires Python websockets and Pillow, Google Chrome with Extensions.loadUnpacked.
Does not use a logged-in browser, publish, or access personal pages.
"""
import asyncio, base64, contextlib, functools, http.server, io, json, os
from pathlib import Path
import shutil, subprocess, tempfile, threading, urllib.request
import websockets
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / 'store'

class CDP:
    def __init__(self, ws): self.ws, self.counter = ws, 0
    async def call(self, method, params=None, session=None):
        self.counter += 1
        command = {'id': self.counter, 'method': method, 'params': params or {}}
        if session: command['sessionId'] = session
        await self.ws.send(json.dumps(command))
        while True:
            response = json.loads(await self.ws.recv())
            if response.get('id') != command['id']: continue
            if 'error' in response: raise RuntimeError(response['error'])
            return response.get('result', {})
    async def evaluate(self, expression, session):
        result = await self.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True}, session)
        if 'exceptionDetails' in result: raise RuntimeError(result['exceptionDetails'])
        return result['result'].get('value')
    async def attach(self, target):
        return (await self.call('Target.attachToTarget', {'targetId': target, 'flatten': True}))['sessionId']
    async def targets(self): return (await self.call('Target.getTargets'))['targetInfos']
    async def page(self, url, width=1280, height=800):
        target = (await self.call('Target.createTarget', {'url': url}))['targetId']
        session = await self.attach(target)
        await self.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False}, session)
        await self.wait("document.readyState === 'complete'", session)
        await self.evaluate('document.fonts.ready.then(()=>true)', session)
        return target, session
    async def wait(self, expression, session):
        for _ in range(200):
            if await self.evaluate(expression, session): return
            await asyncio.sleep(.05)
        raise RuntimeError('Timed out: '+expression)
    async def shot(self, session, path):
        result = await self.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False}, session)
        image = Image.open(io.BytesIO(base64.b64decode(result['data']))).convert('RGB')
        image.save(path)
    async def click(self, session, x, y):
        await self.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}, session)
        await self.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}, session)
    async def drag(self, session, start, end):
        await self.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': start[0], 'y': start[1], 'button': 'left', 'clickCount': 1}, session)
        await self.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': end[0], 'y': end[1], 'button': 'left', 'buttons': 1}, session)
        await self.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': end[0], 'y': end[1], 'button': 'left', 'clickCount': 1}, session)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass

async def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/store/'
    profile = tempfile.mkdtemp(prefix='websnaps-cws-')
    browser = subprocess.Popen([os.environ.get('CHROME', 'google-chrome'), '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', f'--user-data-dir={profile}', '--remote-debugging-port=0', '--window-size=1280,800', '--force-device-scale-factor=1', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        portfile = Path(profile)/'DevToolsActivePort'
        for _ in range(200):
            if portfile.exists(): break
            if browser.poll() is not None: raise RuntimeError('Chrome exited before startup')
            await asyncio.sleep(.05)
        port = portfile.read_text().splitlines()[0]
        version = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version'))
        async with websockets.connect(version['webSocketDebuggerUrl'], max_size=64*1024*1024) as ws:
            cdp = CDP(ws)
            extension = (await cdp.call('Extensions.loadUnpacked', {'path': str(ROOT)}))['id']
            for _ in range(100):
                workers = [t for t in await cdp.targets() if t['type']=='service_worker' and extension in t['url']]
                if workers: break
                await asyncio.sleep(.1)
            worker = await cdp.attach(workers[0]['targetId'])
            target, page = await cdp.page(url+'screenshots/demo-page.html')
            # Start through the real worker using its existing host permission.
            await cdp.evaluate("startCapture('selection').then(()=>true)", worker)
            await cdp.wait("!!document.querySelector('#__websnaps-overlay')", page)
            await cdp.drag(page, (84, 162), (1196, 623))
            await cdp.shot(page, STORE/'screenshots/01-selection.png')
            await cdp.evaluate("document.querySelector('[data-mode=element]').click()", page)
            await cdp.call('Input.dispatchMouseEvent', {'type':'mouseMoved','x':960,'y':500}, page)
            await cdp.shot(page, STORE/'screenshots/02-element.png')
            # Visible capture, then annotations through actual editor controls.
            await cdp.evaluate("startCapture('visible').then(()=>true)", worker)
            async def editor():
                items = [t for t in await cdp.targets() if f'{extension}/editor/editor.html?' in t['url']]
                if not items: raise RuntimeError('Editor did not open')
                tid = items[-1]['targetId']; sid = await cdp.attach(tid)
                await cdp.call('Emulation.setDeviceMetricsOverride', {'width':1280,'height':800,'deviceScaleFactor':1,'mobile':False}, sid)
                await cdp.wait("document.querySelector('#canvas')?.width > 1 && !document.querySelector('#btn-save').disabled && document.querySelector('#status-size').textContent !== '--'", sid)
                await cdp.evaluate('document.fonts.ready.then(()=>true)', sid)
                return tid, sid
            editor_target, edit = await editor()
            await cdp.evaluate("document.querySelector('[data-tool=arrow]').click()", edit)
            bounds = await cdp.evaluate("(()=>{const r=document.querySelector('#canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()", edit)
            def point(x,y): return (bounds['x']+bounds['w']*x, bounds['y']+bounds['h']*y)
            await cdp.drag(edit, point(.75,.27), point(.52,.31))
            await cdp.evaluate("document.querySelector('[data-tool=text]').click()", edit)
            await cdp.click(edit, *point(.68,.18))
            await cdp.wait("document.activeElement?.classList.contains('text-input-overlay')", edit)
            await cdp.call('Input.insertText', {'text':'ここを共有'}, edit)
            await cdp.call('Input.dispatchKeyEvent', {'type':'keyDown','key':'Enter','code':'Enter','modifiers':2}, edit)
            await cdp.call('Input.dispatchKeyEvent', {'type':'keyUp','key':'Enter','code':'Enter','modifiers':2}, edit)
            await cdp.click(edit, 72, 116)
            await cdp.evaluate("document.querySelector('[data-tool=rect]').click()", edit)
            await cdp.drag(edit, point(.07,.46), point(.57,.75))
            await cdp.shot(edit, STORE/'screenshots/03-editor.png')
            # Verify real PNG and JPG download serialization without writing downloads.
            exports = await cdp.evaluate("({png:getExportCanvas('png').toDataURL('image/png').slice(0,22),jpg:getExportCanvas('jpg').toDataURL('image/jpeg').slice(0,23)})", edit)
            assert exports == {'png':'data:image/png;base64,','jpg':'data:image/jpeg;base64,'}, exports
            downloads = Path(profile)/'test-downloads'
            downloads.mkdir()
            await cdp.call('Browser.setDownloadBehavior', {'behavior':'allow','downloadPath':str(downloads)})
            saved = {}
            for fmt in ['png','jpg']:
                await cdp.evaluate(f"document.querySelector('[data-format={fmt}]').click();document.querySelector('#btn-save').click()", edit)
                for _ in range(100):
                    files = list(downloads.glob('*.'+fmt))
                    if files: break
                    await asyncio.sleep(.05)
                assert files, 'No download for '+fmt
                with Image.open(files[0]) as image:
                    assert image.size == (1280,800)
                    saved[fmt] = {'format':image.format,'size':list(image.size)}
            await cdp.call('Target.closeTarget', {'targetId': editor_target})
            await cdp.call('Target.activateTarget', {'targetId': target})
            await cdp.evaluate("startCapture('selection').then(()=>true)", worker)
            await cdp.wait("!!document.querySelector('#__websnaps-overlay')", page)
            await cdp.drag(page, (84,162), (1196,623))
            await cdp.evaluate("document.querySelector('.__ws-capture-btn').click()", page)
            for _ in range(100):
                if any(f'{extension}/editor/editor.html?' in t['url'] for t in await cdp.targets()): break
                await asyncio.sleep(.05)
            selected_target, selected = await editor()
            selection_size = await cdp.evaluate("({width:canvas.width,height:canvas.height})", selected)
            assert selection_size == {'width':1112,'height':461}, selection_size
            await cdp.call('Target.closeTarget', {'targetId': selected_target})
            await cdp.call('Target.activateTarget', {'targetId': target})
            await cdp.evaluate("startCapture('fullpage').then(()=>true)", worker)
            full_target, full = await editor()
            await cdp.evaluate("document.querySelector('#btn-zoom-fit').click()", full)
            await cdp.shot(full, STORE/'screenshots/04-fullpage.png')
            full_size = await cdp.evaluate("({width:canvas.width,height:canvas.height})", full)
            # Real popup UI at its natural width; use its image in a store composition.
            popup_target, popup = await cdp.page(f'chrome-extension://{extension}/popup/popup.html', 360, 640)
            await cdp.wait("document.querySelector('#format-hint').textContent.length > 0", popup)
            body_height = await cdp.evaluate('Math.ceil(document.body.getBoundingClientRect().height)', popup)
            await cdp.shot(popup, STORE/'assets/popup-raw.png')
            image = Image.open(STORE/'assets/popup-raw.png')
            image.crop((0,0,360,min(640,body_height))).save(STORE/'assets/popup-raw.png')
            for name, width, height in [('screenshots/ss4_popup.html',1280,800),('promo/promo_small.html',440,280),('promo/promo_marquee.html',1400,560)]:
                tid, sid = await cdp.page(url+name, width, height)
                await cdp.shot(sid, STORE/({'screenshots/ss4_popup.html':'screenshots/05-popup.png'}.get(name, name.replace('.html','.png'))))
                await cdp.call('Target.closeTarget', {'targetId':tid})
            # Browser storage regression test, using the shipped browser harness.
            tid, sid = await cdp.page(url.replace('/store/','/tests/browser-storage.test.html'))
            await asyncio.sleep(.5)
            storage_text = await cdp.evaluate('document.body.innerText', sid)
            report = {'browser':version['Browser'],'fixture':'store/screenshots/demo-page.html','captureMethod':'Actual unpacked extension; CDP invokes worker startCapture using existing host permission. Toolbar/keyboard user gestures are separate manual checks.','fullpage':full_size,'exportEncoding':exports,'actualDownloads':saved,'selectionCapture':selection_size,'storageTest':storage_text,'screenshots':5}
            (STORE/'review/browser-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(report,ensure_ascii=False),flush=True)
    finally:
        browser.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired): browser.wait(timeout=5)
        if browser.poll() is None: browser.kill(); browser.wait()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

if __name__ == '__main__': asyncio.run(main())
