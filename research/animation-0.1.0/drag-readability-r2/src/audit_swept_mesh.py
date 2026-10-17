import json,sys,numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
P=Path(__file__).resolve().parents[1];data=json.loads((P/'evidence/poses.json').read_text());meta=json.loads((P/'evidence/poses-metadata.json').read_text());mesh=next(m for m in data['frames'][2]['meshes'] if m['name']=='A_mochi_skin');rest=np.array(mesh['positions']).reshape(-1,3);T=np.array(mesh['indices']).reshape(-1,3);R=np.array(meta[2]['snapshot']['actorMatrix']).reshape(4,4).T;local=(np.c_[rest,np.ones(len(rest))]@np.linalg.inv(R).T)[:,:3]
area=lambda v:np.linalg.norm(np.cross(v[T[:,1]]-v[T[:,0]],v[T[:,2]]-v[T[:,0]]),axis=1);baseArea=area(rest);E=np.unique(np.sort(np.concatenate([T[:,[0,1]],T[:,[1,2]],T[:,[2,0]]]),axis=1),axis=0);baseEdge=np.linalg.norm(rest[E[:,0]]-rest[E[:,1]],axis=1)
mask=(local[:,1]<.47)|((local[:,1]>.4)&(local[:,1]<.94)&(np.abs(local[:,0])>.8));active=[tuple(map(int,ids)) for ids in T if mask[ids].any()];report=[]
for index in range(40,80):
 v=np.fromfile(P/f'evidence/short-binary/{index}-A_mochi_skin.bin',dtype='<f4').reshape(-1,3);ar=area(v)[baseArea>1e-12]/baseArea[baseArea>1e-12];er=np.linalg.norm(v[E[:,0]]-v[E[:,1]],axis=1)[baseEdge>1e-9]/baseEdge[baseEdge>1e-9];row={'frame':index,'areaRatioMin':float(ar.min()),'edgeRatioMax':float(er.max()),'finite':bool(np.isfinite(v).all())}
 if index%4==0 or index==79:
  vs=[Vector(p) for p in v];tree=BVHTree.FromPolygons(vs,active,all_triangles=True,epsilon=1e-8);pairs=[(i,j) for i,j in tree.overlap(tree) if i<j and not set(active[i]).intersection(active[j])];hits=[]
  for i,j in pairs:
   A=[vs[k] for k in active[i]];B=[vs[k] for k in active[j]];found=False
   for aa,bb in [(A,B),(B,A)]:
    for p,q in zip(aa,aa[1:]+aa[:1]):
     d=q-p;hit=intersect_ray_tri(bb[0],bb[1],bb[2],d,p,True)
     if hit is not None and d.length_squared>1e-16 and 1e-6<(hit-p).dot(d)/d.length_squared<1-1e-6:found=True;break
    if found:break
   if found:hits.append([i,j])
  row['sampledNonAdjacentIntersections']=len(hits)
 report.append(row)
print('AREA',min(r['areaRatioMin'] for r in report),'EDGE',max(r['edgeRatioMax'] for r in report),'HITS',sum(r.get('sampledNonAdjacentIntersections',0) for r in report))
(P/'evidence/swept-deformation.json').write_text(json.dumps({'scope':'Actual CPU geometry, 40 candidate frames area/edge gates; 11 sampled nonadjacent limb-root intersection screens. Not exhaustive self collision or GPU validation.','referenceGates':{'minArea':.55,'maxEdge':1.60},'frames':report},indent=2))
