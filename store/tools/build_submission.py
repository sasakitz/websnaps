#!/usr/bin/env python3
"""Build runtime-only CWS ZIP and review bundle using explicit allowlists."""
from pathlib import Path
from PIL import Image
import hashlib, json, re, zipfile
ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / 'store'
DIST = STORE / 'dist'
RUNTIME_DIRS = {'content', 'editor', 'popup', 'shared'}


def digest(data): return hashlib.sha256(data).hexdigest()


def make_zip(path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)


def main():
    manifest = json.loads((ROOT/'manifest.json').read_text())
    version = manifest['version']
    assert manifest['manifest_version'] == 3
    assert 1 <= len(manifest['description']) <= 132
    assert manifest['description'] in (STORE/'store-listing.md').read_text()
    DIST.mkdir(exist_ok=True)
    (STORE/'assets/store-icon-128.png').write_bytes((ROOT/'icons/icon128.png').read_bytes())
    entries = {name: (ROOT/name).read_bytes() for name in ['manifest.json', 'background.js', 'icons/brand.svg']}
    for directory in RUNTIME_DIRS:
        for p in sorted((ROOT/directory).rglob('*')):
            if p.is_file() and p.suffix in {'.js', '.css', '.html'}:
                entries[p.relative_to(ROOT).as_posix()] = p.read_bytes()
    for size in [16, 48, 128]:
        name = f'icons/icon{size}.png'
        im = Image.open(ROOT/name)
        assert im.size == (size, size)
        entries[name] = (ROOT/name).read_bytes()
    # Ensure referenced local scripts/styles/images are present in the package.
    for name, data in entries.items():
        if name.endswith('.html'):
            for ref in re.findall(r'(?:src|href)="([^"]+)"', data.decode()):
                if ref.startswith(('#', 'http:', 'https:', 'data:')): continue
                refpath = (ROOT/name).parent/ref
                canonical = refpath.resolve().relative_to(ROOT).as_posix()
                assert canonical in entries, (name, ref)
    package = DIST/f'websnaps-{version}.zip'
    make_zip(package, entries)
    # Keep the existing root-level release artifact synchronized.
    (ROOT/'websnaps.zip').write_bytes(package.read_bytes())
    with zipfile.ZipFile(package) as z:
        assert z.testzip() is None
        assert 'manifest.json' in z.namelist()
        assert all(z.read(n) == entries[n] for n in z.namelist())
    images = {}
    for p in sorted((STORE/'screenshots').glob('[0-9][0-9]-*.png')):
        im = Image.open(p)
        assert im.size == (1280, 800) and im.mode == 'RGB', p
        images[str(p.relative_to(STORE))] = {'size': list(im.size), 'mode': im.mode}
    assert len(images) == 5
    for name, size in [('promo/promo_small.png',(440,280)), ('promo/promo_marquee.png',(1400,560)), ('assets/store-icon-128.png',(128,128))]:
        im = Image.open(STORE/name)
        assert im.size == size, name
        if name.startswith('promo/'): assert im.mode == 'RGB'
        images[name] = {'size':list(im.size), 'mode':im.mode}
    report = {
        'version':version, 'descriptionCharacters':len(manifest['description']),
        'package':str(package.relative_to(STORE)), 'packageSHA256':digest(package.read_bytes()),
        'permissions':manifest['permissions'],'hostPermissions':manifest.get('host_permissions',[]),
        'runtimeFiles':[{'path':n,'bytes':len(d),'sha256':digest(d)} for n,d in sorted(entries.items())],
        'images':images,
    }
    (STORE/'review/package-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    kit = {}
    for name in ['README.md','store-listing.md','privacy-policy.html','submission-checklist.md']:
        kit['store/'+name] = (STORE/name).read_bytes()
    for folder in ['review','assets','screenshots','promo','tools']:
        for p in sorted((STORE/folder).rglob('*')):
            if p.is_file() and p.suffix in {'.md','.json','.txt','.png','.html','.py'}:
                kit['store/'+p.relative_to(STORE).as_posix()] = p.read_bytes()
    kit['store/dist/'+package.name] = package.read_bytes()
    bundle = DIST/f'websnaps-{version}-submission-kit.zip'
    make_zip(bundle, kit)
    sums = ''.join(f'{digest(p.read_bytes())}  {p.name}\n' for p in [package,bundle])
    (DIST/'SHA256SUMS.txt').write_text(sums)
    print(json.dumps({'package':str(package),'bundle':str(bundle),'files':len(entries),'images':len(images),'sha256':report['packageSHA256']},ensure_ascii=False))


if __name__ == '__main__': main()
