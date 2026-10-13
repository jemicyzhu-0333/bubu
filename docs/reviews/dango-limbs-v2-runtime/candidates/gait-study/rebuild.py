from pathlib import Path
import argparse,os,subprocess,sys
p=argparse.ArgumentParser();p.add_argument('--canonical-package',type=Path,required=True);a=p.parse_args();env=dict(os.environ,DANGO_CANONICAL_PACKAGE=str(a.canonical_package.resolve()));root=Path(__file__).resolve().parent
for name in ['extract_gait.py','render_phase_set.py','check_assets.py']:
 subprocess.run([sys.executable,str(root/name)],check=True,env=env)
for name in ['check_gait.mjs','playback-review/sample.mjs']:
 subprocess.run(['node',str(root/name)],check=True,env=env)
for name in ['playback-review/render.py','playback-review/audit.py']:
 subprocess.run([sys.executable,str(root/name)],check=True,env=env)

# Normalize generated provenance after checks, preserving all image bytes.
for file in root.rglob('*.json'):
 text=file.read_text().replace(str(a.canonical_package.resolve()),'canonical-package').replace(str(root),'gait-production')
 file.write_text(text)
import hashlib,json
manifest={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sorted(root.rglob('*'))if f.is_file() and f.name!='FILES.sha256.json'}
(root/'FILES.sha256.json').write_text(json.dumps(manifest,indent=2)+'\n')
