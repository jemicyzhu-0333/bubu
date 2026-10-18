import json,numpy as np,hashlib
from pathlib import Path
from portable_paths import P;rows=[]
for kind in ['sprout','sunhat','satchel','scarf']:
 path=P/f'review/{kind}-static.json';d=json.loads(path.read_text());v=np.concatenate([np.array(m['positions']).reshape(-1,3) for m in d['frames'][0]['meshes']]);views=[]
 for a in [0,45,90,180]:
  angle=np.deg2rad(a);horizontal=v[:,0]*np.cos(angle)-v[:,2]*np.sin(angle);margin=min(5.264/2-np.max(np.abs(horizontal)),5.264/2-np.max(np.abs(v[:,1]-1.05)));assert margin>0;views.append({'yaw':a,'marginWorld':float(margin),'marginCSS':float(margin*219/5.264)})
 rows.append({'kind':kind,'vertices':len(v),'views':views,'inputSHA256':hashlib.sha256(path.read_bytes()).hexdigest()})
(P/'reports/static-stage.json').write_text(json.dumps({'scope':'actual full 13 meshes and accessory vertices; fixed orthographic span 5.264, target y1.05, CSS219','items':rows},indent=2))
