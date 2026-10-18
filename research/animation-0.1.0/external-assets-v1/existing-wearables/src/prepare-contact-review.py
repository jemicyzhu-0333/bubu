import json,numpy as np
from pathlib import Path
from portable_paths import P,R,ASSET,COLLISION;s=json.loads((P/'review/combined-static.json').read_text());d=json.loads((R/'tea/reports/normal-30fps-compact.json').read_text());report=json.loads((P/'reports/tea-collision.json').read_text());inv=np.linalg.inv(np.array(s['sourceToWorld']).reshape(4,4).T);acc=[]
for m in s['frames'][0]['meshes']:
 if not m['name'].startswith(('Bubu_','A_')):
  v=np.array(m['positions']).reshape(-1,3);m['positions']=(v@inv[:3,:3].T+inv[:3,3]).ravel().tolist();acc.append(m)
selection=[]
for kind in ['satchel','scarf']:
 matches=[(i,sum(v for k,v in r['hits'].items() if k.startswith(kind+'/'))) for i,r in enumerate(report['frames'])];nonzero=[(i,v) for i,v in matches if v];first=nonzero[0][0];maximum=max(matches,key=lambda x:x[1])[0]
 # Tea full_raise phase peak selected from actual phase label, with explicit time retained.
 for label,i in [('first',first),('max',maximum),('raised_cup',102)]:
  f=d['frames'][i];selection.append({'kind':kind,'case':label,'index':i,'time':f['time'],'phase':f['label'],'hits':report['frames'][i]['hits']})
  frame={**f,'meshes':[{**d['sharedMeshes'].get(m['name'],{}),**m} for m in f['meshes']]+[m for m in acc if m['name'].startswith(kind+'_')]}
  (P/f'review/contact-{kind}-{label}.json').write_text(json.dumps({'sourceGLB':s['sourceGLB'],'assetGLBs':s['assetGLBs'],'frames':[frame]}))
(P/'reports/contact-keyframe-index.json').write_text(json.dumps(selection,indent=2));print(json.dumps(selection,indent=2))
