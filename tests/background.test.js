const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(new URL('../background.js', `file://${__filename}`), 'utf8');

function createBackground({ failCapture = false, failScroll = false, overflow = 'scroll', priority = 'important', pageHeight = 1500, viewportHeight = 600, dpr = 2, stuckScroll = false } = {}) {
  const tab = { id: 7, windowId: 3, url: 'https://example.com' };
  const calls = [];
  const listeners = {};
  const images = new Map();
  const captures = new Map();
  const style = {
    overflow,
    getPropertyValue: () => overflow,
    getPropertyPriority: () => priority,
    setProperty(name, value, valuePriority) {
      calls.push(['restore-overflow', name, value, valuePriority]);
      this[name] = value;
    },
    removeProperty(name) {
      calls.push(['remove-overflow', name]);
      this[name] = '';
    }
  };
  const window = {
    innerHeight: viewportHeight, innerWidth: 800, scrollX: 12, scrollY: 34, devicePixelRatio: dpr,
    scrollTo(x, y) {
      if (typeof x === 'object') { y = x.top; x = x.left; }
      calls.push(['scroll', x, y]);
      if (failScroll && y === 600) throw new Error('Scroll failed');
      this.scrollX = x;
      this.scrollY = stuckScroll && y >= viewportHeight ? 0 : Math.max(0, Math.min(y, pageHeight - viewportHeight));
    }
  };
  const chrome = {
    commands: { onCommand: { addListener: fn => { listeners.command = fn; } } },
    runtime: {
      onMessage: { addListener: fn => { listeners.message = fn; } },
      getURL: path => `chrome-extension://test/${path}`
    },
    tabs: {
      query: async () => [tab],
      onRemoved: { addListener: fn => { listeners.removed = fn; } },
      captureVisibleTab: async (windowId, options) => {
        calls.push(['capture', windowId, options.format]);
        if (failCapture) throw new Error('Capture failed');
        const dataUrl = `data:image/png;base64,shot${images.size}`;
        images.set(dataUrl, { width: 800 * dpr, height: Math.round(viewportHeight * dpr), scrollY: window.scrollY });
        return dataUrl;
      },
      sendMessage: async () => {},
      create: async options => { calls.push(['editor', options.url]); return { id: 99 }; }
    },
    scripting: {
      insertCSS: async () => { calls.push(['css']); },
      executeScript: async ({ func, args = [], files }) => {
        if (files) { calls.push(['script']); return []; }
        return [{ result: func(...args) }];
      }
    },
    storage: { local: { get: async () => ({ format: 'png' }) } }
  };
  const context = vm.createContext({
    chrome, window, URL,
    importScripts() {},
    CaptureStore: {
      prune: async () => {},
      save: async data => { const id = `capture-${captures.size}`; captures.set(id, data); calls.push(['store', data]); return id; },
      attach: async () => {},
      remove: async id => { captures.delete(id); },
      removeForTab: async id => { calls.push(['remove-tab', id]); }
    },
    document: { body: { scrollHeight: pageHeight }, documentElement: { scrollHeight: pageHeight, style } },
    setTimeout: fn => fn(),
    console: { error: (...args) => calls.push(['error', ...args]), warn: () => {} }
  });
  vm.runInContext(source, context);
  return { context, calls, listeners, style, window, chrome, images, captures };
}

test('full-page capture restores the page before handing screenshots to the editor', async () => {
  const bg = createBackground();
  await bg.listeners.command('capture-fullpage');
  const data = bg.calls.find(call => call[0] === 'store')[1];
  assert.equal(data.type, 'fullpage');
  assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY), [0, 600, 900]);
  assert.equal(data.totalHeight, 1500);
  assert.equal(data.devicePixelRatio, 2);
  assert.deepEqual(bg.calls.filter(call => call[0] === 'capture'), Array(3).fill(['capture', 3, 'png']));
  assert.deepEqual(bg.calls.find(call => call[0] === 'restore-overflow'), ['restore-overflow', 'overflow', 'scroll', 'important']);
  assert.equal(bg.window.scrollX, 12);
  assert.equal(bg.window.scrollY, 34);
  assert.ok(bg.calls.findIndex(call => call[0] === 'restore-overflow') < bg.calls.findIndex(call => call[0] === 'store'));
});

for (const failure of ['failCapture', 'failScroll']) {
  test(`full-page capture restores the page after ${failure}`, async () => {
    const bg = createBackground({ [failure]: true });
    await bg.listeners.command('capture-fullpage');
    assert.equal(bg.style.overflow, 'scroll');
    assert.equal(bg.window.scrollX, 12);
    assert.equal(bg.window.scrollY, 34);
    assert.ok(bg.calls.some(call => call[0] === 'error'));
    assert.ok(!bg.calls.some(call => call[0] === 'editor'));
  });
}

test('cleanup removes a temporary overflow property when no inline value existed', async () => {
  const bg = createBackground({ overflow: '', priority: '' });
  await bg.listeners.command('capture-fullpage');
  assert.equal(bg.style.overflow, '');
  assert.ok(bg.calls.some(call => call[0] === 'remove-overflow'));
});

test('keyboard and popup capture use the same visible capture flow', async () => {
  const bg = createBackground();
  await bg.listeners.command('capture-visible');
  const responses = [];
  bg.listeners.message({ type: 'START_CAPTURE', mode: 'visible' }, {}, response => responses.push(response));
  assert.equal(responses[0].received, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bg.calls.filter(call => call[0] === 'store' && call[1].type === 'visible').length, 2);
});

test('selection inserts styles before its content script', async () => {
  const bg = createBackground();
  await bg.listeners.command('capture-selection');
  assert.deepEqual(bg.calls.map(call => call[0]), ['css', 'script']);
});

test('unknown capture modes are ignored and tab query failures are handled', async () => {
  const bg = createBackground();
  for (const mode of ['unknown', 'constructor', '__proto__']) {
    await bg.context.startCapture(mode);
  }
  assert.equal(bg.calls.length, 0);
  bg.chrome.tabs.query = async () => { throw new Error('Tab unavailable'); };
  await bg.listeners.command('capture-visible');
  assert.equal(bg.calls[0][0], 'error');
});

const editorSource = readFileSync(new URL('../editor/editor.js', `file://${__filename}`), 'utf8');

for (const [pageHeight, viewportHeight, dpr] of [
  [1500, 600, 1],       // Partial final viewport, overlapping the previous image.
  [18000, 600, 1],      // Exact viewport multiple.
  [18050, 600, 2],      // Many scrolls and a small remainder on a high-DPI display.
  [1537, 333, 1.25],    // Fractional device-pixel boundaries.
  [901, 333, 1.5],
  [400, 600, 2],        // Page shorter than the viewport.
  [600, 600, 1]
]) {
  test(`full-page stitching preserves every row (${pageHeight}px, viewport ${viewportHeight}px, DPR ${dpr})`, async () => {
    const bg = createBackground({ pageHeight, viewportHeight, dpr });
    await bg.listeners.command('capture-fullpage');
    const captureData = bg.calls.find(call => call[0] === 'store')?.[1];
    assert.ok(captureData, 'capture must reach the editor');
    const canvas = { width: 0, height: 0 };
    const rows = new Array(Math.round(pageHeight * dpr));
    const writes = new Uint8Array(rows.length);
    const context = vm.createContext({ document: { addEventListener() {} } });
    vm.runInContext(editorSource, context);
    context.testCanvas = canvas;
    context.testCtx = {
      drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
        assert.ok(sy + sh <= image.height, 'source must stay inside the screenshot');
        assert.ok(dy + dh <= canvas.height, 'destination must stay inside the canvas');
        assert.ok(Math.abs(sh - dh) <= 1, 'only fractional-DPR rounding may resize a row');
        for (let row = 0; row < dh; row++) {
          rows[dy + row] = Math.round(image.scrollY * dpr) + sy + Math.floor(row * sh / dh);
          writes[dy + row]++;
        }
      }
    };
    vm.runInContext('canvas = testCanvas; ctx = testCtx;', context);
    context.loadImage = async url => bg.images.get(url);
    await context.loadFullPage(captureData);
    assert.equal(canvas.height, Math.round(pageHeight * dpr));
    for (let row = 0; row < rows.length; row++) {
      assert.ok(Number.isFinite(rows[row]), `missing row ${row}`);
      assert.ok(Math.abs(rows[row] - row) <= (Number.isInteger(dpr) ? 0 : 1), `wrong source at row ${row}`);
      assert.equal(writes[row], 1, `row ${row} must be drawn exactly once`);
    }
  });
}

test('a page that cannot advance does not produce an incomplete editor image', async () => {
  const bg = createBackground({ stuckScroll: true });
  await bg.listeners.command('capture-fullpage');
  assert.ok(bg.calls.some(call => call[0] === 'error'));
  assert.ok(!bg.calls.some(call => call[0] === 'editor'));
  assert.equal(bg.style.overflow, 'scroll');
  assert.equal(bg.window.scrollY, 34);
});

test('each editor receives an isolated capture ID', async () => {
  const bg = createBackground();
  await bg.context.captureVisible({ id: 7, windowId: 3 });
  await bg.context.captureVisible({ id: 7, windowId: 3 });
  const urls = bg.calls.filter(call => call[0] === 'editor').map(call => call[1]);
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0], urls[1]);
  assert.equal(bg.captures.size, 2);
  assert.ok(urls.every(url => bg.captures.has(new URL(url).searchParams.get('capture'))));
});

test('failed editor creation removes its pending capture', async () => {
  const bg = createBackground();
  bg.chrome.tabs.create = async () => { throw new Error('Cannot open editor'); };
  await bg.context.captureVisible({ id: 7, windowId: 3 });
  assert.equal(bg.captures.size, 0);
  assert.ok(bg.calls.some(call => call[0] === 'error'));
});

test('closing an editor requests removal of its capture data', async () => {
  const bg = createBackground();
  bg.listeners.removed(99);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(bg.calls.some(call => call[0] === 'remove-tab' && call[1] === 99));
});

test('changing the active tab aborts capture and restores the source page', async () => {
  const bg = createBackground();
  const originalCapture = bg.chrome.tabs.captureVisibleTab;
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    const result = await originalCapture(...args);
    bg.chrome.tabs.query = async () => [{ id: 8, windowId: 3 }];
    return result;
  };
  await bg.listeners.command('capture-fullpage');
  assert.equal(bg.calls.filter(call => call[0] === 'capture').length, 1);
  assert.ok(!bg.calls.some(call => call[0] === 'editor'));
  assert.equal(bg.style.overflow, 'scroll');
  assert.equal(bg.window.scrollY, 34);
});

test('concurrent requests in one window do not interleave screenshots', async () => {
  const bg = createBackground();
  await Promise.all([bg.listeners.command('capture-visible'), bg.listeners.command('capture-visible')]);
  assert.equal(bg.calls.filter(call => call[0] === 'capture').length, 1);
  assert.equal(bg.calls.filter(call => call[0] === 'editor').length, 1);
});

test('capture calls in different windows are serialized and rate-limited', async () => {
  const bg = createBackground();
  let now = 100000;
  bg.context.Date = { now: () => now };
  bg.context.setTimeout = (fn, delay) => { now += delay; fn(); };
  bg.chrome.tabs.query = async query => [{ id: query.windowId === 4 ? 8 : 7 }];
  const times = [];
  bg.chrome.tabs.captureVisibleTab = async () => { times.push(now); return 'image'; };
  await Promise.all([
    bg.context.captureTab({ id: 7, windowId: 3 }),
    bg.context.captureTab({ id: 8, windowId: 4 }),
    bg.context.captureTab({ id: 7, windowId: 3 })
  ]);
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 600);
  assert.ok(times[2] - times[1] >= 600);
});

test('a failed screenshot does not block later requests in the capture queue', async () => {
  const bg = createBackground();
  bg.chrome.tabs.captureVisibleTab = async () => { throw new Error('capture failed'); };
  await assert.rejects(bg.context.captureTab({ id: 7, windowId: 3 }), /capture failed/);
  bg.chrome.tabs.captureVisibleTab = async () => 'next-image';
  assert.equal(await bg.context.captureTab({ id: 7, windowId: 3 }), 'next-image');
});

test('a tab switched during the screenshot API call is rejected', async () => {
  const bg = createBackground();
  bg.chrome.tabs.captureVisibleTab = async () => {
    bg.chrome.tabs.query = async () => [{ id: 8 }];
    return 'wrong-image';
  };
  await assert.rejects(bg.context.captureTab({ id: 7, windowId: 3 }), /タブが切り替わりました/);
});

test('full-page capture uses the document height after scrollbar-induced reflow', async () => {
  const bg = createBackground();
  const getHeight = () => bg.style.overflow === 'hidden' ? 1800 : 1500;
  for (const node of [bg.context.document.body, bg.context.document.documentElement]) {
    Object.defineProperty(node, 'scrollHeight', { get: getHeight });
  }
  const scroll = bg.window.scrollTo;
  bg.window.scrollTo = function (x, y) {
    scroll.call(this, x, y);
    const requestedY = typeof x === 'object' ? x.top : y;
    this.scrollY = Math.max(0, Math.min(requestedY, getHeight() - this.innerHeight));
  };
  await bg.listeners.command('capture-fullpage');
  const data = bg.calls.find(call => call[0] === 'store')?.[1];
  assert.equal(data?.totalHeight, 1800);
  assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY), [0, 600, 1200]);
  assert.equal(bg.style.overflow, 'scroll');
});

function setDynamicPageHeight(bg, getHeight) {
  for (const node of [bg.context.document.body, bg.context.document.documentElement]) {
    Object.defineProperty(node, 'scrollHeight', { get: getHeight });
  }
  const scroll = bg.window.scrollTo;
  bg.window.scrollTo = function (x, y) {
    scroll.call(this, x, y);
    const requestedY = typeof x === 'object' ? x.top : y;
    this.scrollY = Math.max(0, Math.min(requestedY, getHeight() - this.innerHeight));
  };
}

for (const [newHeight, expectedOffsets] of [
  [1000, [0, 400]],
  [2100, [0, 600, 1200, 1500]]
]) {
  test(`layout changes during a screenshot restart capture at height ${newHeight}`, async () => {
    const bg = createBackground();
    let height = 1500;
    setDynamicPageHeight(bg, () => height);
    const capture = bg.chrome.tabs.captureVisibleTab;
    bg.chrome.tabs.captureVisibleTab = async (...args) => {
      const image = await capture(...args);
      height = newHeight;
      return image;
    };
    await bg.listeners.command('capture-fullpage');
    const data = bg.calls.find(call => call[0] === 'store')?.[1];
    assert.equal(data?.totalHeight, newHeight);
    assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY), expectedOffsets);
    assert.ok(!data.screenshots.some(shot => shot.dataUrl.endsWith('shot0')), 'old-layout screenshots must be discarded');
    assert.equal(bg.style.overflow, 'scroll');
    assert.equal(bg.window.scrollY, 34);
  });
}

test('ORICON-style shrink near the bottom restarts instead of chasing a stale page height', async () => {
  const bg = createBackground({ pageHeight: 10464, viewportHeight: 813 });
  let height = 10464;
  setDynamicPageHeight(bg, () => height);
  const scroll = bg.window.scrollTo;
  bg.window.scrollTo = function (x, y) {
    const requestedY = typeof x === 'object' ? x.top : y;
    if (requestedY >= 6504) height = 9859;
    scroll.call(this, x, y);
  };
  await bg.listeners.command('capture-fullpage');
  const data = bg.calls.find(call => call[0] === 'store')?.[1];
  assert.equal(data?.totalHeight, 9859);
  assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY),
    [0, 813, 1626, 2439, 3252, 4065, 4878, 5691, 6504, 7317, 8130, 8943, 9046]);
  assert.ok(data.screenshots.every(shot => Number(shot.dataUrl.split('shot')[1]) >= 8));
  assert.ok(!bg.calls.some(call => call[0] === 'error'));
});

test('continuously changing layouts stop after bounded retries and restore the page', async () => {
  const bg = createBackground();
  let height = 1500;
  setDynamicPageHeight(bg, () => height);
  const capture = bg.chrome.tabs.captureVisibleTab;
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    const image = await capture(...args);
    height += 100;
    return image;
  };
  await bg.listeners.command('capture-fullpage');
  assert.equal(bg.calls.filter(call => call[0] === 'capture').length, 4);
  assert.ok(!bg.calls.some(call => call[0] === 'editor'));
  assert.ok(bg.calls.some(call => call[0] === 'error' && call[2].message.includes('レイアウトが変化し続けています')));
  assert.equal(bg.style.overflow, 'scroll');
  assert.equal(bg.window.scrollY, 34);
});

function addResponsiveMainSpacing(bg) {
  const properties = new Map();
  const main = {
    style: {
      getPropertyValue: property => properties.get(property)?.value || '',
      getPropertyPriority: property => properties.get(property)?.priority || '',
      setProperty: (property, value, priority) => properties.set(property, { value, priority }),
      removeProperty: property => properties.delete(property)
    }
  };
  bg.context.document.querySelectorAll = () => [main];
  bg.context.getComputedStyle = () => ({
    getPropertyValue(property) {
      if (properties.has(property)) return properties.get(property).value;
      return property === 'padding-top' ? (bg.window.scrollY > 0 ? '82px' : '102px') : '0px';
    }
  });
  const height = () => 1500 + parseFloat(bg.context.getComputedStyle(main).getPropertyValue('padding-top')) - 102;
  setDynamicPageHeight(bg, height);
  return { main, properties };
}

test('shrinking-header spacing does not cause an endless full-page restart loop', async () => {
  const bg = createBackground();
  const { properties } = addResponsiveMainSpacing(bg);
  await bg.listeners.command('capture-fullpage');
  const data = bg.calls.find(call => call[0] === 'store')?.[1];
  assert.equal(data?.totalHeight, 1500);
  assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY), [0, 600, 900]);
  assert.equal(bg.calls.filter(call => call[0] === 'capture').length, 3);
  assert.equal(properties.size, 0, 'temporary spacing must be removed');
  assert.equal(bg.window.scrollY, 34);
  assert.equal('__websnapsCaptureSpacing' in bg.window, false);
});

for (const failCapture of [false, true]) {
  test(`main spacing restores inline values and priorities (capture failure: ${failCapture})`, async () => {
    const bg = createBackground({ failCapture });
    const { main, properties } = addResponsiveMainSpacing(bg);
    main.style.setProperty('padding-top', '90px', 'important');
    main.style.setProperty('margin-top', '15px', '');
    const original = JSON.stringify([...properties]);
    await bg.listeners.command('capture-fullpage');
    assert.equal(JSON.stringify([...properties]), original);
    assert.equal('__websnapsCaptureSpacing' in bg.window, false);
    assert.equal(bg.style.overflow, 'scroll');
    assert.equal(bg.window.scrollY, 34);
  });
}

test('fractional scroll limits at high DPI terminate without a repeated final screenshot', async () => {
  const bg = createBackground({ pageHeight: 5138, viewportHeight: 913, dpr: 2 });
  bg.context.document.documentElement.scrollHeight = 5137;
  const scroll = bg.window.scrollTo;
  bg.window.scrollTo = function (x, y) {
    scroll.call(this, x, y);
    const requestedY = typeof x === 'object' ? x.top : y;
    this.scrollY = Math.max(0, Math.min(requestedY, 5137.5 - this.innerHeight));
  };
  await bg.listeners.command('capture-fullpage');
  const data = bg.calls.find(call => call[0] === 'store')?.[1];
  assert.equal(data?.totalHeight, 5137.5);
  assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY), [0, 913, 1826, 2739, 3652, 4224.5]);
  assert.ok(!bg.calls.some(call => call[0] === 'error'));
});

test('a real one-pixel final strip is still captured', async () => {
  const bg = createBackground({ pageHeight: 601, viewportHeight: 600 });
  await bg.listeners.command('capture-fullpage');
  const data = bg.calls.find(call => call[0] === 'store')?.[1];
  assert.equal(data?.totalHeight, 601);
  assert.deepEqual(Array.from(data.screenshots, shot => shot.scrollY), [0, 1]);
});

function addCaptureLayers(bg, elements) {
  bg.context.document.querySelectorAll = selector => selector === '*' ? elements : [];
  bg.context.getComputedStyle = element => ({
    get position() { return element.properties.get('position')?.value || element.position; }
  });
}

function captureLayer(position, width = 800, height = 80) {
  const properties = new Map();
  return {
    position, properties,
    getBoundingClientRect: () => ({ width, height }),
    style: {
      getPropertyValue: property => properties.get(property)?.value || '',
      getPropertyPriority: property => properties.get(property)?.priority || '',
      setProperty: (property, value, priority) => properties.set(property, { value, priority }),
      removeProperty: property => properties.delete(property)
    }
  };
}

test('fixed headers appear only in the first full-page frame and are restored afterwards', async () => {
  const bg = createBackground();
  const header = captureLayer('fixed');
  addCaptureLayers(bg, [header]);
  const visibility = [];
  const capture = bg.chrome.tabs.captureVisibleTab;
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    visibility.push(header.style.getPropertyValue('visibility') || 'visible');
    return capture(...args);
  };
  await bg.listeners.command('capture-fullpage');
  assert.deepEqual(visibility, ['visible', 'hidden', 'hidden']);
  assert.equal(header.properties.size, 0);
  assert.equal('__websnapsCaptureLayers' in bg.window, false);
});

test('sticky content stays at its natural position even when originally below the first viewport', async () => {
  const bg = createBackground();
  const sticky = captureLayer('sticky');
  sticky.style.setProperty('position', 'sticky', 'important');
  sticky.style.setProperty('top', '16px', '');
  const original = JSON.stringify([...sticky.properties]);
  addCaptureLayers(bg, [sticky]);
  const positions = [];
  const capture = bg.chrome.tabs.captureVisibleTab;
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    positions.push(sticky.style.getPropertyValue('position'));
    assert.equal(sticky.style.getPropertyValue('top'), 'auto');
    return capture(...args);
  };
  await bg.listeners.command('capture-fullpage');
  assert.deepEqual(positions, ['relative', 'relative', 'relative']);
  assert.equal(JSON.stringify([...sticky.properties]), original);
  assert.equal(bg.calls.find(call => call[0] === 'store')[1].totalHeight, 1500);
});

test('failed capture restores a hidden header including inline priorities and transitions', async () => {
  const bg = createBackground();
  const header = captureLayer('fixed');
  header.style.setProperty('visibility', 'visible', 'important');
  header.style.setProperty('opacity', '0.8', 'important');
  header.style.setProperty('transition', 'opacity 3s', '');
  const original = JSON.stringify([...header.properties]);
  addCaptureLayers(bg, [header]);
  const capture = bg.chrome.tabs.captureVisibleTab;
  let count = 0;
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    if (++count === 2) {
      assert.equal(header.style.getPropertyValue('opacity'), '0');
      throw new Error('capture failed');
    }
    return capture(...args);
  };
  await bg.listeners.command('capture-fullpage');
  assert.equal(JSON.stringify([...header.properties]), original);
  assert.equal(bg.window.scrollY, 34);
  assert.ok(!bg.calls.some(call => call[0] === 'editor'));
});

test('layout restarts show the fixed header again for the new first frame', async () => {
  const bg = createBackground();
  const header = captureLayer('fixed');
  addCaptureLayers(bg, [header]);
  let height = 1500;
  setDynamicPageHeight(bg, () => height);
  const capture = bg.chrome.tabs.captureVisibleTab;
  const visibility = [];
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    visibility.push(header.style.getPropertyValue('visibility') || 'visible');
    const image = await capture(...args);
    if (visibility.length === 2) height = 1000;
    return image;
  };
  await bg.listeners.command('capture-fullpage');
  assert.deepEqual(visibility, ['visible', 'hidden', 'visible', 'hidden']);
  assert.equal(bg.calls.find(call => call[0] === 'store')[1].totalHeight, 1000);
  assert.equal(header.properties.size, 0);
});

test('viewport-sized fixed background layers remain visible throughout the capture', async () => {
  const bg = createBackground();
  const background = captureLayer('fixed', 800, 600);
  addCaptureLayers(bg, [background]);
  const capture = bg.chrome.tabs.captureVisibleTab;
  bg.chrome.tabs.captureVisibleTab = async (...args) => {
    assert.equal(background.properties.size, 0);
    return capture(...args);
  };
  await bg.listeners.command('capture-fullpage');
  assert.equal(bg.calls.filter(call => call[0] === 'capture').length, 3);
});
