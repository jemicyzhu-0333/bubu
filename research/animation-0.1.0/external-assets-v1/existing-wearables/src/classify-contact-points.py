import json,importlib.util,numpy as np
from pathlib import Path
from scipy.spatial import cKDTree
def closest_point(t,p):
 a,b,c=t[:,0],t[:,1],t[:,2];ab=b-a;ac=c-a;ap=p-a
 aa=np.einsum('ij,ij->i',ab,ab);bb=np.einsum('ij,ij->i',ab,ac);cc=np.einsum('ij,ij->i',ac,ac);dd=np.einsum('ij,ij->i',ap,ab);ee=np.einsum('ij,ij->i',ap,ac);den=aa*cc-bb*bb
 u=np.divide(dd*cc-ee*bb,den,out=np.zeros_like(den),where=abs(den)>1e-20);v=np.divide(ee*aa-dd*bb,den,out=np.zeros_like(den),where=abs(den)>1e-20);proj=a+u[:,None]*ab+v[:,None]*ac;inside=(u>=0)&(v>=0)&(u+v<=1)&(abs(den)>1e-20)
 options=[]
 for x,y in [(a,b),(b,c),(c,a)]:
  edge=y-x;length=np.einsum('ij,ij->i',edge,edge);ratio=np.divide(np.einsum('ij,ij->i',p-x,edge),length,out=np.zeros_like(length),where=length>1e-20);options.append(x+np.clip(ratio,0,1)[:,None]*edge)
 candidates=np.stack(options,axis=1);dist=np.linalg.norm(candidates-p[:,None],axis=2);nearest=candidates[np.arange(len(p)),dist.argmin(1)];nearest[inside]=proj[inside];return nearest
from portable_paths import P,R,ASSET,COLLISION;spec=importlib.util.spec_from_file_location('collision',COLLISION);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def vertices(m):return np.array(m['positions']).reshape(-1,3) if 'positions'in m else np.fromfile(m['positionsFile'],dtype='<f4').reshape(-1,3)
def triangles(m):return vertices(m)[np.array(m['indices']).reshape(-1,3)]
def intersection_points(a,b):
 out=[]
 for first,second in [(a,b),(b,a)]:
  e1=second[:,1]-second[:,0];e2=second[:,2]-second[:,0]
  for k in range(3):
   origin=first[:,k];direction=first[:,(k+1)%3]-origin;p=np.cross(direction,e2);det=np.einsum('ij,ij->i',e1,p);valid=abs(det)>1e-13;inv=np.divide(1,det,out=np.zeros_like(det),where=valid);t=origin-second[:,0];u=np.einsum('ij,ij->i',t,p)*inv;q=np.cross(t,e1);v=np.einsum('ij,ij->i',direction,q)*inv;z=np.einsum('ij,ij->i',e2,q)*inv;hit=valid&(u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)&(z>=-1e-9)&(z<=1+1e-9);out.extend((origin+direction*z[:,None])[hit])
 return np.array(out)
rows=[]
for kind in ['satchel','scarf']:
 for phase in ['first','max','raised_cup']:
  path=P/f'review/contact-{kind}-{phase}.json';d=json.loads(path.read_text());meshes=d['frames'][0]['meshes'];body=next(m for m in meshes if m['name']=='Bubu_body');bt=triangles(body);tree=cKDTree(bt.mean(1));norm=np.cross(bt[:,1]-bt[:,0],bt[:,2]-bt[:,0]);norm/=np.linalg.norm(norm,axis=1)[:,None];row={'kind':kind,'phase':phase,'time':d['frames'][0]['time'],'contacts':[]}
  for cloth in [m for m in meshes if m['name'].startswith(kind+'_')]:
   ct=triangles(cloth);c=mod.Triangles(vertices(cloth),np.array(cloth['indices']).reshape(-1,3))
   for hand in [m for m in meshes if m['name'].startswith('Bubu_hand')]:
    ht=triangles(hand);pairs=c.intersections(ht)
    if not len(pairs):continue
    points=intersection_points(ht[pairs[:,0]],ct[pairs[:,1]]);_,ids=tree.query(points,k=32);candidates=bt[ids.reshape(-1)];rep=np.repeat(points,32,axis=0);closest=closest_point(candidates,rep);dist=np.linalg.norm(closest-rep,axis=1).reshape(-1,32);ix=dist.argmin(1);near=closest.reshape(-1,32,3)[np.arange(len(points)),ix];ni=norm[ids[np.arange(len(points)),ix]];signed=np.einsum('ij,ij->i',points-near,ni)
    row['contacts'].append({'cloth':cloth['name'],'hand':hand['name'],'points':points.tolist(),'trianglePairs':len(pairs),'intersectionPointSamples':len(points),'insideBodyBeyond002':int((signed<-.002).sum()),'nearBodySurface002':int((abs(signed)<=.002).sum()),'outsideBodyBeyond002':int((signed>.002).sum()),'signedDistanceRange':[float(signed.min()),float(signed.max())]})
  rows.append(row)
report={'method':'Actual edge intersection points; nearest of 32 body-triangle-center neighbors, signed by body outward normal. Local geometric diagnostic, not watertight inside/visibility proof. Outside body does not alone prove visible camera pixel; inspect paired actual renders.','rows':rows}
(P/'reports/contact-point-classification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
