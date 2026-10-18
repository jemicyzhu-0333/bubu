import numpy as np
from scipy.spatial import cKDTree
class Triangles:
 def __init__(self,v,f):
  self.t=np.asarray(v)[f].astype(float);self.centers=self.t.mean(1);self.radius=np.linalg.norm(self.t-self.centers[:,None],axis=2).max(1);self.tree=cKDTree(self.centers);self.lo=self.t.min(1);self.hi=self.t.max(1)
 def intersections(self,moving):
  centers=moving.mean(1);radius=np.linalg.norm(moving-centers[:,None],axis=2).max(1);lists=self.tree.query_ball_point(centers,radius+self.radius.max()+1e-9);pairs=np.array([(i,j) for i,js in enumerate(lists) for j in js],dtype=int)
  if not len(pairs):return np.empty((0,2),int)
  a=moving[pairs[:,0]];b=self.t[pairs[:,1]];ok=np.all(a.min(1)<=b.max(1)+1e-10,axis=1)&np.all(b.min(1)<=a.max(1)+1e-10,axis=1);pairs=pairs[ok];a=a[ok];b=b[ok]
  if not len(pairs):return pairs
  hit=np.zeros(len(pairs),bool)
  for first,second in [(a,b),(b,a)]:
   e1=second[:,1]-second[:,0];e2=second[:,2]-second[:,0]
   for k in range(3):
    origin=first[:,k];direction=first[:,(k+1)%3]-origin;p=np.cross(direction,e2);det=np.einsum('ij,ij->i',e1,p);valid=abs(det)>1e-13;inv=np.divide(1,det,out=np.zeros_like(det),where=valid);t=origin-second[:,0];u=np.einsum('ij,ij->i',t,p)*inv;q=np.cross(t,e1);v=np.einsum('ij,ij->i',direction,q)*inv;z=np.einsum('ij,ij->i',e2,q)*inv;hit|=valid&(u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)&(z>=-1e-9)&(z<=1+1e-9)
  return pairs[hit]
