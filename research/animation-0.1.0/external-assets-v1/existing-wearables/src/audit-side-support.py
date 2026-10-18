"""Independent before/after geometric diagnostics of the bag-side support."""
from pathlib import Path
import json,hashlib,importlib.util
import numpy as np
from scipy.spatial import cKDTree
from portable_paths import P,ASSET,COLLISION
spec=importlib.util.spec_from_file_location('collision',COLLISION);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
rows=[]
for variant,path in [('original',ASSET/'.baseline-validation/existing-wearables/review/satchel-static.json'),('revised',P/'review/satchel-static.json')]:
 d=json.loads(path.read_text());inv=np.linalg.inv(np.array(d['sourceToWorld']).reshape(4,4).T)
 meshes={m['name']:{**m,'v':np.array(m['positions']).reshape(-1,3)@inv[:3,:3].T+inv[:3,3]}for m in d['frames'][0]['meshes'] if m['name'].startswith('satchel_')}
 strap=meshes['satchel_continuous_strap'];pouch=meshes['satchel_pouch'];upper=pouch['v'][pouch['v'][:,1]>.45]
 distance,indices=cKDTree(strap['v']).query(upper);i=int(distance.argmin())
 triangles=strap['v'][np.array(strap['indices']).reshape(-1,3)];body=mod.Triangles(pouch['v'],np.array(pouch['indices']).reshape(-1,3))
 joins=body.intersections(triangles)
 rows.append({'variant':variant,'inputSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'upperPouchVertexToStrapVertexMinimum':float(distance[i]),'pouchPoint':upper[i].tolist(),'strapPoint':strap['v'][indices[i]].tolist(),'strapPouchTrianglePairs':len(joins)})
report={'scope':'Static source-local contact diagnostic. Vertex proximity is not a watertight sewn-joint proof; overlapping strap/pouch triangles are intended stitching embed, not hand/cup collisions. Actual both-side and back images are separate evidence.','results':rows}
(ASSET/'reports/side-support-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
