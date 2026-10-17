"""Restore immutable weighted baseline then overlay three body capability files.
Usage: python3 tools/hydrate_runtime.py /path/to/research/animation-0.1.0
The source baseline must be the validated 9d987939 revision. No downloads.
"""
from pathlib import Path
import sys,hashlib,json,shutil
out=Path(__file__).resolve().parents[1];base=Path(sys.argv[1]).resolve()
for name,digest in json.loads((out/'tools/baseline-hashes.json').read_text()).items():
 p=base/name
 assert p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==digest, f'Baseline mismatch: {name}'
overlay={f.name:f.read_bytes() for f in (out/'vendor/runtime-facepath05/src').glob('*.mjs')}
for name in ['runtime-facepath05','expression-scheduler-p1']:
 shutil.copytree(base/name,out/'vendor'/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','__pycache__'))
for name,data in overlay.items():(out/'vendor/runtime-facepath05/src'/name).write_bytes(data)
print('Hydrated verified baseline with body-only overlay. Install locked Three.js dependency before running tests.')
