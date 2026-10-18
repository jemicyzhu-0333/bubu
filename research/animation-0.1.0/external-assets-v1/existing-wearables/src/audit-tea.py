import json,hashlib,importlib.util,os
from pathlib import Path
import numpy as np
from portable_paths import P,R,ASSET,COLLISION
spec=importlib.util.spec_from_file_location('collision',COLLISION);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
inputs=[ASSET/'src/audit-tea.py',ASSET/'src/existing-wearable-host.mjs',ASSET/'src/test-and-export.mjs',R/'tea/reports/normal-30fps-compact.json',R/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb']
d=json.loads(inputs[3].read_text());colliders=[];coordinate={};assets=[]
for kind in ['sprout','sunhat','satchel','scarf']:
 path=P/f'review/{kind}-static.json';inputs.append(path);sd=json.loads(path.read_text());inv=np.linalg.inv(np.array(sd['sourceToWorld']).reshape(4,4).T);assets+=sd['assetGLBs'];inputs.append(Path(sd['sourceGLB']))
 for m in sd['frames'][0]['meshes']:
  v=np.array(m['positions']).reshape(-1,3);v=v@inv[:3,:3].T+inv[:3,3]
  if m['name'].startswith('Bubu_'):
   expected=np.load(R/f"hybrid-inputs/{m['name']}.npz")['POSITION'];err=float(np.abs(v-expected).max());assert err<1e-6,(m['name'],err);coordinate[m['name']]={'vertices':len(v),'error':err}
  if not m['name'].startswith(('Bubu_','A_')):colliders.append((kind,m['name'],mod.Triangles(v,np.array(m['indices']).reshape(-1,3))))
inputs+=list(map(Path,assets));initialHashes={str(p):sha(p) for p in set(inputs)};rows=[]
for idx,f in enumerate(d['frames']):
 hits={}
 for local in f['meshes']:
  m={**d['sharedMeshes'].get(local['name'],{}),**local}
  if not m['name'].startswith(('Bubu_hand','Sip_')) or m.get('opacity',1)<=0:continue
  if 'positions' in m:v=np.array(m['positions']).reshape(-1,3)
  else:
   path=Path(m['positionsFile']);inputs.append(path);v=np.fromfile(path,dtype='<f4').reshape(-1,3)
  triangles=v[np.array(m['indices']).reshape(-1,3)]
  for kind,name,c in colliders:
   count=len(c.intersections(triangles))
   if count:hits[f'{kind}/{name}/{m["name"]}']=count
 rows.append({'time':f['time'],'hits':hits})
 if idx%30==0:print(idx,flush=True)
summary={}
for row in rows:
 for key,n in row['hits'].items():
  if key not in summary:summary[key]={'frames':0,'min':n,'max':n}
  summary[key]['frames']+=1;summary[key]['min']=min(summary[key]['min'],n);summary[key]['max']=max(summary[key]['max'],n)
for p,digest in initialHashes.items():assert sha(p)==digest,'Input changed during audit: '+p
report={'scope':'271 discrete tea frames in source coordinates; triangle edge intersections, not continuous collision. Original static attachment shape, reduced motion; apparel animated flutter not certified here. Nonzero overlaps retained honestly.','inputs':{os.path.relpath(p,P.parent):sha(p) for p in set(inputs)},'coordinateProof':coordinate,'frames':rows,'summary':summary}
(P/'reports/tea-collision.json').write_text(json.dumps(report,indent=2));print(json.dumps(summary,indent=2))
