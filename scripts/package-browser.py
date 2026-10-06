#!/usr/bin/env python3
"""Package the existing static browser app using local tools only."""
import argparse
from pathlib import Path
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
subprocess.run(['node', 'scripts/build.mjs'], cwd=root, check=True)
output = args.output.resolve() if args.output else root / 'dist' / 'workshop-browser.zip'
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'dist' / 'client').rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(root / 'dist' / 'client'))
    archive.write(root / 'README.md', 'BROWSER-SETUP.md')
with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Browser package failed its CRC check')
    required = {'index.html', 'app.js', 'phone-store.js', 'scanner.js', 'offline.js',
                'android-bridge.js', 'sw.js', 'manifest.webmanifest',
                'vendor/html5-qrcode.min.js', 'icons/icon-192.png', 'icons/icon-512.png'}
    if not required.issubset(archive.namelist()):
        raise RuntimeError('Browser package is missing required offline assets')
print(f'Browser-only package: {output} ({output.stat().st_size} bytes).')
print('Initial use needs HTTPS or a phone-local localhost server; no network access was used.')
