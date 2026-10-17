import json,sys
import numpy as np
from pathlib import Path
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent;data=json.loads((P/'base.json').read_text());mesh=next(m for m in data['frames'][0]['meshes'] if m['name']=='A_mochi_skin');tris=np.array(mesh['indices']).reshape(-1,3)
results=[]
for t in ['0','0.01','0.04','0.08','0.12','0.18','0.25','0.5','0.75','1']:
 q=np.load(P/f'audit-{t}.npy');tree=BVHTree.FromPolygons(q.tolist(),tris.tolist(),all_triangles=True,epsilon=0);pairs=tree.overlap(tree);pairs=[(i,j) for i,j in pairs if i<j and not set(tris[i])&set(tris[j])];results.append({'t':float(t),'nonAdjacentBVHOverlaps':len(pairs),'examples':pairs[:20]});print(results[-1],flush=True)
(P/'bvh-overlap.json').write_text(json.dumps(results,indent=2))
