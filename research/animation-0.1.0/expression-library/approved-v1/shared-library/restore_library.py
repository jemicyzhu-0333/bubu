"""Verify/recover this frozen approved-library closure without historic workspace paths.
Python3 + numpy are required for exact GLB rebuild. Blender4.3.2 is needed only
for the optional render-smoke test. No network or package installation is used.
"""
from pathlib import Path
import argparse,hashlib,gzip,json,os,shutil,subprocess,sys
P=Path(__file__).resolve().parent
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
a=argparse.ArgumentParser();a.add_argument('--output',type=Path,default=P/'restored');a.add_argument('--verify-only',action='store_true');a.add_argument('--render-smoke',action='store_true');a.add_argument('--blender',default='blender');args=a.parse_args()
m=json.loads((P/'BACKUP-MANIFEST.json').read_text())
for f in m['files']:
 p=P/f['path'];assert p.is_file(),f'Missing {p}';assert H(p)==f['sha256'],f'Hash mismatch {p}'
print('Stored closure hashes verified:',len(m['files']))
if args.verify_only:sys.exit(0)
out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
for n in ['compose_gold.py','glb_io.py','library-array-spec.json','library-arrays.npz','face_library.py','render_library.py','verify_local_arrays.py']:
 shutil.copyfile(P/n,out/n)
subprocess.run([sys.executable,str(out/'compose_gold.py'),'--rebuild'],check=True,cwd=out)
for f in m['rebuildOutputs']:
 assert H(out/f['file'])==f['sha256'],f'Rebuilt GLB hash mismatch {f["file"]}'
look=m['authoringLook'];raw=gzip.decompress((P/look['gzipFile']).read_bytes());assert hashlib.sha256(raw).hexdigest()==look['sha256'];(out/look['file']).write_bytes(raw)
subprocess.run([sys.executable,str(out/'verify_local_arrays.py')],check=True,cwd=out)
print('Both canonical GLBs rebuilt byte-exact; complete authoring look restored.')
if args.render_smoke:
 env=dict(os.environ,VIEW='front');env.pop('ONLY_STATE',None)
 subprocess.run([args.blender,'-b','-t','4','--python',str(out/'render_library.py'),'--','neutral'],check=True,cwd=out,env=env)
 from PIL import Image
 import numpy as np
 a=np.asarray(Image.open(out/'renders/Basis-0.00-front.png').convert('RGBA'));b=np.asarray(Image.open(P/m['smokeReference']).convert('RGBA'))
 assert np.array_equal(a,b),'Restored look smoke image is not pixel-exact; check Blender version/device'
 print('Restored neutral front image is pixel-exact.')
