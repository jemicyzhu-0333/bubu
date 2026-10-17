import json,math,copy
import numpy as np
from scipy.interpolate import LinearNDInterpolator, PchipInterpolator
from pathlib import Path
P=Path(__file__).resolve().parent;data=json.loads((P/'base.json').read_text());base=data['frames'][0];mesh=next(m for m in base['meshes'] if m['name']=='A_mochi_skin');a=np.array(mesh['positions']).reshape(-1,3);idx=np.array(mesh['indices']).reshape(-1,3)
x,y,z=a.T;depth=.785;n=2.12;r=(abs(x)**n+abs(z/depth)**n)**(1/n);theta=np.arctan2(z/depth,x)
# Carrier fit from actual unaffected front/back torso samples at the same height.
bins=np.linspace(.35,1.05,100);centers=(bins[:-1]+bins[1:])/2;rs=[]
for lo,hi in zip(bins[:-1],bins[1:]):
 mask=(y>=lo)&(y<hi)&(abs(x)<.72)&(abs(z)>.3);rs.append(float(np.median(r[mask])) if mask.any() else np.nan)
valid=np.isfinite(rs);carrier=PchipInterpolator(centers[valid],np.array(rs)[valid],extrapolate=True);rr=carrier(y)
(P/'carrier.json').write_text(json.dumps({'height':centers[valid].tolist(),'radius':np.array(rs)[valid].tolist(),'depth':depth,'exponent':n}))
def smooth(t):t=np.clip(t,0,1);return t*t*(3-2*t)
def envelope(h,th):return smooth((h-.43)/.07)*smooth((.96-h)/.08)*smooth((th+.48)/.10)*smooth((.38-th)/.10)
# Harmonic local coordinates remove the overhanging fin's multivalued radial map.
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve
edges=np.unique(np.sort(np.concatenate([idx[:,[0,1]],idx[:,[1,2]],idx[:,[2,0]]]),axis=1),axis=0)
adj=[set() for _ in a]
for i,j in edges:adj[i].add(j);adj[j].add(i)
patches=[]
for side in [1,-1]:
 th=np.arctan2(z/depth,side*x);mask=(side*x>0)&(y>.43)&(y<.94)&(th>-.46)&(th<.38)
 boundary=np.array([i for i in np.flatnonzero(mask) if any(not mask[j] for j in adj[i])],int)
 interior=np.setdiff1d(np.flatnonzero(mask),boundary);lookup={j:i for i,j in enumerate(interior)}
 A=lil_matrix((len(interior),len(interior)));rhs=np.zeros((len(interior),2));uv=np.column_stack([th,y])
 for row,i in enumerate(interior):
  A[row,row]=sum(1/max(np.linalg.norm(a[i]-a[j]),1e-6)**2 for j in adj[i])
  for j in adj[i]:
   w=1/max(np.linalg.norm(a[i]-a[j]),1e-6)**2
   if j in lookup:A[row,lookup[j]]=-w
   else:rhs[row]+=w*uv[j]
 uv[interior]=spsolve(A.tocsr(),rhs)
 phi,h=uv.T;rad=carrier(h);norm=(abs(np.cos(phi))**n+abs(np.sin(phi))**n)**(1/n)
 target=np.column_stack([side*rad*np.cos(phi)/norm,h,depth*rad*np.sin(phi)/norm])
 # Boundary is exact. Blend carrier discrepancy out before boundary; the harmonic
 # parameter map itself retains continuous connected triangle correspondence.
 distances=np.zeros(len(a));from scipy.sparse import coo_matrix
 from scipy.sparse.csgraph import dijkstra
 lengths=np.linalg.norm(a[edges[:,0]]-a[edges[:,1]],axis=1)
 G=coo_matrix((np.r_[lengths,lengths],(np.r_[edges[:,0],edges[:,1]],np.r_[edges[:,1],edges[:,0]])),shape=(len(a),len(a))).tocsr()
 dist=dijkstra(G,indices=boundary,directed=False,min_only=True);fade=smooth(dist/.07);target=a+(target-a)*fade[:,None];target[~mask]=a[~mask]
 patches.append(dict(side=side,mask=mask,uv=uv,target=target,boundary=boundary.tolist()))
(P/'patches.json').write_text(json.dumps([dict(side=p['side'],vertices=np.flatnonzero(p['mask']).tolist(),boundary=p['boundary']) for p in patches]))
def bump(h,phi,center):
 # Compact C1 rounded protrusion: no interpolation hull or multivalued samples.
 u=np.sqrt(((h-.665)/.17)**2+((phi-center)/.195)**2);return .205*np.maximum(0,1-u**4)**2*(u<1)
def deform(t):
 if t==0:return a.copy()
 s=smooth(t/.18);travel=smooth((t-.08)/.92);q=a.copy()
 for p in patches:
  side=p['side'];mask=p['mask'];th=np.arctan2(z/depth,side*x);center=-.08+(1.12 if side==1 else 1.22)*travel
  # Original fin patch becomes a regular carrier patch with its own harmonic UV.
  target=p['target'].copy();phi,h=p['uv'].T;d=bump(h,phi,center);rad=carrier(h);norm=(abs(np.cos(phi))**n+abs(np.sin(phi))**n)**(1/n)
  target[:,0]+=side*d*np.cos(phi)/norm;target[:,2]+=depth*d*np.sin(phi)/norm
  q[mask]=(1-s)*a[mask]+s*target[mask]
  # Other surface vertices only gain the moving bump. They never acquire the
  # old fin's material vertices or a long-distance tangent translation.
  other=(side*x>0)&(~mask);d=bump(y,th,center)*s;scale=d/np.maximum(r,1e-9)
  q[other,0]+=x[other]*scale[other];q[other,2]+=z[other]*scale[other]
 return q
frames=[];report=[]
for t in [0,.25,.5,.75,1]:
 q=deform(t);delta=np.linalg.norm(q-a,axis=1);e=np.unique(np.sort(np.concatenate([idx[:,[0,1]],idx[:,[1,2]],idx[:,[2,0]]]),axis=1),axis=0);length=np.linalg.norm(a[e[:,0]]-a[e[:,1]],axis=1);ratio=np.linalg.norm(q[e[:,0]]-q[e[:,1]],axis=1)/np.maximum(length,1e-12)
 ta=np.cross(a[idx[:,1]]-a[idx[:,0]],a[idx[:,2]]-a[idx[:,0]]);tq=np.cross(q[idx[:,1]]-q[idx[:,0]],q[idx[:,2]]-q[idx[:,0]]);areas=np.linalg.norm(tq,axis=1);orig=np.linalg.norm(ta,axis=1)
 report.append(dict(t=t,maxDelta=float(delta.max()),changed=int(np.count_nonzero(delta>1e-7)),footMax=float(delta[y<.4].max()),outsideYMax=float(delta[(y<.4)|(y>1.0)].max()),edgeRatioQuantiles=np.quantile(ratio,[0,.01,.5,.99,1]).tolist(),areaRatioQuantiles=np.quantile(areas/np.maximum(orig,1e-12),[0,.01,.5,.99,1]).tolist(),minTriangleArea=float(areas.min()/2)))
 np.save(P/f'pose-{t:.2f}.npy',q)
 for yaw in [0,45,90,180]:
  f=copy.deepcopy(base);f['time']=t;f['label']=f'travel {t} / yaw {yaw}';angle=math.radians(yaw);rot=np.array([[math.cos(angle),0,math.sin(angle)],[0,1,0],[-math.sin(angle),0,math.cos(angle)]])
  for m in f['meshes']:
   pos=q if m['name']=='A_mochi_skin' else np.array(m['positions']).reshape(-1,3);m['positions']=(pos@rot.T).ravel().tolist()
  frames.append(f)
(P/'frames.json').write_text(json.dumps(dict(sourceGLB=data['sourceGLB'],frames=frames)));(P/'metrics.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
