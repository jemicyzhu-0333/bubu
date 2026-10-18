import json,numpy as np
from pathlib import Path
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--cache-root',type=Path,required=True);args=parser.parse_args();p=args.cache_root.resolve()/'prop-expansion';rec=args.cache_root.resolve();base=json.load(open(rec/'tea/reports/keyframes-compact.json'));fits=json.load(open(p/'reports/static-fit.json'))['fits'];out=p/'reports/static-binary';out.mkdir(exist_ok=True)
shared=base['sharedMeshes'];frames=[]
for fit in fits:
 meshes=[]
 for part in ['Bubu_body','Bubu_foot-left','Bubu_foot-right','Bubu_hand-left','Bubu_hand-right']:
  d=np.load(rec/'hybrid-inputs'/f'{part}.npz');pos=d['POSITION'].astype(float);normal=d['NORMAL'].astype(float)
  if 'hand-' in part:
   hand='handL' if part.endswith('left') else 'handR';mat=np.array(fit['hands'][hand]['matrix']).reshape(4,4).T;pos=pos@mat[:3,:3].T+mat[:3,3];normal=normal@mat[:3,:3].T
  pfile=out/f'{fit["id"]}-{part}-positions.bin';nfile=out/f'{fit["id"]}-{part}-normals.bin';pos.astype('<f4').tofile(pfile);normal.astype('<f4').tofile(nfile);meshes.append({'name':part,'positionsFile':str(pfile),'normalsFile':str(nfile)})
 meshes.extend(m for m in base['frames'][0]['meshes'] if not m['name'].startswith(('Bubu_','Sip_')))
 meshes.extend(fit['meshes']);frames.append({'time':0,'label':fit['id']+' static contact, original geometry', 'meshes':meshes})
json.dump({'sourceGLB':base['sourceGLB'],'sharedMeshes':shared,'frames':frames},open(p/'reports/static-render-input.json','w'))
