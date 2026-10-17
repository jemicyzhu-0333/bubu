import json,itertools,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;b=json.loads((P/'base.json').read_text());m=next(m for m in b['frames'][0]['meshes'] if m['name']=='A_mochi_skin');a=np.array(m['positions']).reshape(-1,3);tri=np.array(m['indices']).reshape(-1,3);fans=[[] for _ in a]
for i,t in enumerate(tri):
 for v in t:fans[v].append(i)
pairs=np.array(sorted({tuple(sorted((i,k))) for fan in fans for i,k in itertools.combinations(fan,2)}))
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def area(p):return abs(sum(cross(p[i],p[(i+1)%len(p)]) for i in range(len(p))))/2 if len(p)>2 else 0
# Convex polygon clipping, positive triangle area means overlap beyond shared boundary.
def clip(subject,cutter):
 orient=np.sign(cross(cutter[1]-cutter[0],cutter[2]-cutter[0]));poly=list(subject)
 for i in range(3):
  c,d=cutter[i],cutter[(i+1)%3];new=[]
  for j in range(len(poly)):
   p,q=poly[j-1],poly[j];dp=orient*cross(d-c,p-c);dq=orient*cross(d-c,q-c)
   if (dp>=0)!=(dq>=0):new.append(p+(q-p)*(dp/(dp-dq)))
   if dq>=0:new.append(q)
  poly=new
 return area(poly)
out=[]
for t in ['0.08','0.18','0.25','0.5','1']:
 q=np.load(P/f'audit-{t}.npy');changed=np.any(np.linalg.norm(q-a,axis=1)[tri]>1e-8,axis=1);norm=np.cross(q[tri[:,1]]-q[tri[:,0]],q[tri[:,2]]-q[tri[:,0]]);norm/=np.maximum(np.linalg.norm(norm,axis=1)[:,None],1e-12);i,k=pairs.T;mask=(changed[i]|changed[k])&(abs(np.einsum('ij,ij->i',norm[i],norm[k]))>.999999)&(abs(np.einsum('ij,ij->i',q[tri[k,0]]-q[tri[i,0]],norm[i]))<1e-8);hits=[]
 for f,g in pairs[mask]:
  axes=[n for n in range(3) if n!=np.argmax(abs(norm[f]))];ar=clip(q[tri[f]][:,axes],q[tri[g]][:,axes])
  if ar>1e-12:hits.append({'triangles':[int(f),int(g)],'projectedOverlapArea':float(ar)})
 out.append({'t':float(t),'nearCoplanarPairsTested':int(mask.sum()),'positiveOverlapCount':len(hits),'hits':hits});print(out[-1],flush=True)
(P/'coplanar-fan-audit.json').write_text(json.dumps(out,indent=2))
