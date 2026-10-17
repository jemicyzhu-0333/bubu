import json,numpy as np,hashlib
from pathlib import Path
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent;b=json.loads((P/'base.json').read_text());m=next(m for m in b['frames'][0]['meshes'] if m['name']=='A_mochi_skin');tri=np.array(m['indices']).reshape(-1,3);q=np.load(P/'contact-route-pose.npy');tree=BVHTree.FromPolygons(q.tolist(),tri.tolist(),all_triangles=True,epsilon=0);cup=json.loads((P/'contact-cup-meshes.json').read_text());rows=[]
for part in cup['meshes']:
 v=np.array(part['positions']).reshape(-1,3);idx=np.array(part['indices']).reshape(-1,3);ct=BVHTree.FromPolygons(v.tolist(),idx.tolist(),all_triangles=True,epsilon=0);pairs=tree.overlap(ct);verts=sorted({int(i) for a,k in pairs for i in tri[a]});rows.append({'mesh':part['name'],'triangleIntersectionPairs':len(pairs),'examples':pairs[:20],'bodyVertexBounds':[q[verts].min(0).tolist(),q[verts].max(0).tolist()] if verts else None});print(rows[-1],flush=True)
selfpairs=[(i,k) for i,k in tree.overlap(tree) if i<k and not set(tri[i])&set(tri[k])];faceChecks=[]
for fm in b['frames'][0]['meshes']:
 if fm['name']=='A_mochi_skin':continue
 fv=np.array(fm['positions']).reshape(-1,3);fi=np.array(fm['indices']).reshape(-1,3);ft=BVHTree.FromPolygons(fv.tolist(),fi.tolist(),all_triangles=True,epsilon=0)
 faceChecks.append({'mesh':fm['name'],'cupPairs':sum(len(ft.overlap(BVHTree.FromPolygons(np.array(part['positions']).reshape(-1,3).tolist(),np.array(part['indices']).reshape(-1,3).tolist(),all_triangles=True,epsilon=0))) for part in cup['meshes'])})
out={'neutralFaceCup':faceChecks,'hashes':{n:hashlib.sha256((P/n).read_bytes()).hexdigest() for n in ['contact-route-fit.json','contact-route-pose.npy','contact-cup-meshes.json']},'scope':'static triangle overlap in both body/cup surface directions, no continuous guarantee','fitSHA256':hashlib.sha256((P/'contact-route-fit.json').read_bytes()).hexdigest(),'parts':rows,'bodyNonAdjacentSelfIntersections':len(selfpairs),'selfExamples':selfpairs[:10]};(P/'contact-triangle-audit.json').write_text(json.dumps(out,indent=2))
