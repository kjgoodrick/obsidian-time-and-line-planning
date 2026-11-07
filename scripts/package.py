#!/usr/bin/env python3
"""Deterministic plugin-only archive. Never includes a vault or source exports."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root/'manifest.json').read_text())
imports = set(re.findall(r'\brequire\([\"\']([^\"\']+)[\"\']\)', (root/'main.js').read_text()))
assert imports == {'obsidian'}, f'Unexpected runtime dependency: {imports}'
names = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'PLANNING.md', 'TESTING.md', 'COLLABORATION.md']
files = {name:(root/name).read_bytes() for name in names}
info = {'version':manifest['version'], 'upstream':'https://github.com/sabidurian/timeline-gantt-view', 'upstream_commit':'a554066bf9ace86fbf8042a31c36a72ecda522cb', 'runtime_imports':sorted(imports), 'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
files['build-info.json'] = (json.dumps(info, indent=2)+'\n').encode()
out = root/'dist'; out.mkdir(exist_ok=True)
archive = out/f'timeline-gantt-view-{manifest["version"]}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in sorted(files.items()):
        item = zipfile.ZipInfo('timeline-gantt-view/'+name, (2026,11,2,0,0,0))
        item.compress_type=zipfile.ZIP_DEFLATED; item.external_attr=0o644 << 16
        z.writestr(item,data)
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.with_suffix('.zip.sha256')).write_text(digest+'  '+archive.name+'\n')
print(archive)
print('SHA-256: '+digest)
