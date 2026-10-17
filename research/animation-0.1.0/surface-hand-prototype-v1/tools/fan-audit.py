import json,itertools,numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import intersect_ray_tri
P=Path(__file__).resolve().parent;j=json.loads((P/'base.json').read_text());m=next(m for m in j['frames'][0]['meshes'] if m['name']=='A_mochi_skin');a=np.array(m['positions']).reshape(-1,3);tri=np.array(m['indices']).reshape(-1,3);fans=[[] for _ in a]
for i,t in enumerate(tri):
 for v in t:fans[v].append(i)
pairs=set()
for fan in fans:
 for i,k in itertools.combinations(fan,2):pairs.add(tuple(sorted((i,k))))
shared=[(i,k,list(set(tri[i])&set(tri[k]))) for i,k in sorted(pairs)];out=[]
for t in ['0.08','0.18','0.25','0.5','1']:
 q=np.load(P/f'audit-{t}.npy');changed=np.any(np.linalg.norm(q-a,axis=1)[tri]>1e-8,axis=1);vec=[Vector(p) for p in q];norm=np.cross(q[tri[:,1]]-q[tri[:,0]],q[tri[:,2]]-q[tri[:,0]]);norm/=np.maximum(np.linalg.norm(norm,axis=1)[:,None],1e-12);tested=0;hits=[];opposed=[];coplanar=0
 for i,k,common in shared:
  if not (changed[i] or changed[k]):continue
  if len(common)==2:
   if norm[i]@norm[k]<-.98:opposed.append([i,k])
   continue
  tested+=1;sharedPoint=vec[common[0]];found=False
  for ta,tb in [(tri[i],tri[k]),(tri[k],tri[i])]:
   for n in range(3):
    start,end=vec[ta[n]],vec[ta[(n+1)%3]];direction=end-start
    point=intersect_ray_tri(*[vec[v] for v in tb],direction,start,True)
    if point is not None and (point-sharedPoint).length>1e-6 and (point-start).dot(direction)>1e-10 and (point-end).dot(direction)<-1e-10:found=True;break
   if found:break
  if found:hits.append([i,k])
  if abs(norm[i]@norm[k])>.999999 and abs((q[tri[k][0]]-q[tri[i][0]])@norm[i])<1e-8:coplanar+=1
 out.append({'t':float(t),'explicitSharedVertexFanPairsTested':tested,'nontrivialSegmentHits':len(hits),'hitExamples':hits[:10],'nearlyOpposedSharedEdges':len(opposed),'opposedExamples':opposed[:10],'coplanarPairsNotCoveredBySegmentTest':coplanar});print(out[-1],flush=True)
(P/'fan-audit.json').write_text(json.dumps(out,indent=2))
