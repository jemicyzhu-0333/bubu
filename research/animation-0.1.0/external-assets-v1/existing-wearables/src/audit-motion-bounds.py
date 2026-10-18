"""Conservative stage envelope over every supplied pointer pose."""
from pathlib import Path
import json,itertools,hashlib
import numpy as np
from portable_paths import P,R,ASSET
padding=.18
bounds=[];inputs={}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
for kind in ['sprout','sunhat','satchel','scarf']:
 file=P/f'review/{kind}-static.json';d=json.loads(file.read_text());inputs[str(file)]=sha(file)
 inv=np.linalg.inv(np.array(d['sourceToWorld']).reshape(4,4).T)
 vertices=np.concatenate([np.array(m['positions']).reshape(-1,3)for m in d['frames'][0]['meshes'] if m['name'].startswith(kind+'_')])
 vertices=vertices@inv[:3,:3].T+inv[:3,3]
 lo=vertices.min(0)-padding;hi=vertices.max(0)+padding
 corners=np.array(list(itertools.product(*zip(lo,hi))));bounds.append((kind,corners))
rows=[]
for scenario in ['drag','longpress']:
 file=R/f'pointer/{scenario}/trajectory.json';records=json.loads(file.read_text());inputs[str(file)]=sha(file)
 minimum=float('inf');worst=None
 for i,frame in enumerate(records):
  matrix=np.array(frame['body']['actorMatrix']).reshape(4,4).T
  for kind,corners in bounds:
   v=corners@matrix[:3,:3].T+matrix[:3,3]
   for angle in [0,45,90,180]:
    a=np.deg2rad(angle);x=v[:,0]*np.cos(a)-v[:,2]*np.sin(a)
    margin=min(5.264/2-abs(x).max(),5.264/2-abs(v[:,1]-1.05).max())
    if margin<minimum:minimum=float(margin);worst={'frame':i,'time':frame['time'],'kind':kind,'yaw':angle}
 assert minimum>0,(scenario,minimum,worst)
 rows.append({'scenario':scenario,'frames':len(records),'conservativeMinimumMargin':minimum,'marginCSS':minimum*219/5.264,'worst':worst})
report={'scope':'Conservative boxes around actual revised source-local garment geometry, padded .18 units in every direction and transformed by every recorded source-to-world actor matrix. This exceeds measured/analytic bounded secondary deformations. Four camera directions, span5.264, targetY1.05; no stage expansion. Body/face itself is unchanged and not recertified by this envelope.','padding':padding,'inputs':inputs,'results':rows}
(ASSET/'reports/motion-bounds.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
