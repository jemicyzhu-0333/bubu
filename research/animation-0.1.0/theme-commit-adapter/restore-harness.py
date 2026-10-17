#!/usr/bin/env python3
"""Build an isolated, verified harness; never modify the source checkout."""
from pathlib import Path
import argparse,hashlib,json,subprocess,shutil
p=argparse.ArgumentParser();s=p.add_mutually_exclusive_group(required=True);s.add_argument('--repo',type=Path);s.add_argument('--source-dir',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent;manifest=json.loads((root/'SOURCE-MANIFEST.json').read_text());overlay=json.loads((root/'MANIFEST.json').read_text())
out=a.out.resolve()
if out.exists():raise SystemExit('Output must be a new directory; existing paths are never overwritten.')
# Read and verify everything before creating the output directory.
verified=[]
for row in manifest['files']:
 r=row['path']
 if Path(r).is_absolute() or '..' in Path(r).parts:raise SystemExit('Unsafe manifest path')
 if a.repo:b=subprocess.check_output(['git','-C',str(a.repo.resolve()),'cat-file','blob',manifest['commit']+':'+r])
 else:
  path=(a.source_dir.resolve()/r).resolve()
  if not path.is_relative_to(a.source_dir.resolve()):raise SystemExit('Source path escapes source directory')
  b=path.read_bytes()
 if hashlib.sha256(b).hexdigest()!=row['sha256']:raise SystemExit('Base hash mismatch: '+r)
 verified.append((r,b))
for row in overlay['files']:
 b=(root/'overlay'/row['path']).read_bytes()
 if hashlib.sha256(b).hexdigest()!=row['sha256']:raise SystemExit('Overlay hash mismatch: '+row['path'])
 verified.append((row['path'],b))
out.mkdir(parents=True)
for r,b in verified:
 f=out/'stage'/r;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
shutil.copytree(root/'tests',out/'tests')
shutil.copyfile(root/'package.json',out/'package.json')
print('Verified isolated harness:',out)
print('Run: cd',out,'&& node --test tests/*.test.cjs')
