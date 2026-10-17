import json,numpy as np
from pathlib import Path
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent;j=json.loads((P/'base.json').read_text());m=next(m for m in j['frames'][0]['meshes'] if m['name']=='A_mochi_skin');tri=np.array(m['indices']).reshape(-1,3);faces={}
for f in j['frames'][0]['meshes']:
 if f['name']=='A_mochi_skin':continue
 faces[f['name']]=BVHTree.FromPolygons(np.array(f['positions']).reshape(-1,3).tolist(),np.array(f['indices']).reshape(-1,3).tolist(),all_triangles=True,epsilon=0)
baseTree=BVHTree.FromPolygons(np.array(m['positions']).reshape(-1,3).tolist(),tri.tolist(),all_triangles=True,epsilon=0);baseline={n:set(baseTree.overlap(tree)) for n,tree in faces.items()};rows=[]
for t in ['0','0.04','0.08','0.12','0.18','0.25','0.5','0.75','1']:
 q=np.load(P/f'audit-{t}.npy');tree=BVHTree.FromPolygons(q.tolist(),tri.tolist(),all_triangles=True,epsilon=0);row={'t':float(t),'meshes':{n:{'baselinePairs':len(baseline[n]),'newPairs':len(set(tree.overlap(f))-baseline[n])} for n,f in faces.items()}};rows.append(row)
(P/'face-collision.json').write_text(json.dumps(rows,indent=2));print([(r['t'],sum(f['newPairs'] for f in r['meshes'].values())) for r in rows])
