#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, subprocess, sys, tempfile

PKG=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--repo-root',type=Path,required=True);parser.add_argument('--report',type=Path);args=parser.parse_args()
inventory=json.loads((PKG/'FILES.sha256.json').read_text())['files']
for f in inventory:
    p=PKG/f['path'];assert p.is_file(),f'Missing {p}'
    assert hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],f'Changed {p}'
expected={f['path']for f in inventory}|{'FILES.sha256.json'}
actual={str(p.relative_to(PKG))for p in PKG.rglob('*')if p.is_file()}
assert expected==actual,f'File inventory differs: {expected^actual}'
with tempfile.TemporaryDirectory(prefix='sip-front-v2-check-') as tmp:
    out=Path(tmp)/'rebuild'
    subprocess.run([sys.executable,str(PKG/'scripts/rebuild.py'),'--repo-root',str(args.repo_root),'--output',str(out)],check=True,stdout=subprocess.DEVNULL)
    rebuilt=json.loads((out/'rebuild-report.json').read_text())
report={'ok':True,'runtimeReady':False,'hostAcceptance':None,'filesChecked':len(inventory),'rebuild':rebuilt}
if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
