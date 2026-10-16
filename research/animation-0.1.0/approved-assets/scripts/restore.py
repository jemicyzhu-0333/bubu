"""Verify retained artifacts, restore compressed sources, rebuild omitted look scenes."""
from pathlib import Path
import argparse,json,hashlib,gzip,shutil,subprocess
P=Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser();a.add_argument('--only',choices=['body','r6','all'],default='all');a.add_argument('--out',type=Path,default=P/'_restored');a.add_argument('--blender',default='blender');a.add_argument('--verify-only',action='store_true');args=a.parse_args()
m=json.loads((P/'BACKUP-MANIFEST.json').read_text())
for item in m['files']:
 if args.only!='all' and item['batch'] not in [args.only,'shared']:continue
 p=P/item['path'];assert p.is_file(),f'Missing required file: {p}'
 assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],f'Hash mismatch: {p}'
print('Retained artifact hashes verified')
if args.verify_only:raise SystemExit()
for kind in (['body','r6'] if args.only=='all' else [args.only]):
 out=args.out.resolve()/kind;out.mkdir(parents=True,exist_ok=True)
 for src in (P/kind).rglob('*'):
  if not src.is_file():continue
  rel=src.relative_to(P/kind);dst=out/rel;dst.parent.mkdir(parents=True,exist_ok=True)
  if src.suffix=='.gz':
   dst=dst.with_suffix('')
   with gzip.open(src,'rb') as i,open(dst,'wb') as o:shutil.copyfileobj(i,o)
   expected=m['restoredSources'][kind]['sha256'];assert hashlib.sha256(dst.read_bytes()).hexdigest()==expected
  else:shutil.copy2(src,dst)
 subprocess.run([args.blender,'-b','-t','2','--python',str(P/'scripts/restore_blender.py'),'--',str(P),str(args.out.resolve()),kind],check=True)
print('Restored to',args.out.resolve())
