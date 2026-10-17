import json,numpy as np,hashlib
from pathlib import Path
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent;b=json.loads((P/'base.json').read_text());m=next(m for m in b['frames'][0]['meshes'] if m['name']=='A_mochi_skin');a=np.array(m['positions']).reshape(-1,3);q=np.load(P/'contact-route-pose.npy');cup=json.loads((P/'contact-cup-meshes.json').read_text());shell=next(x for x in cup['meshes'] if x['name']=='Sip_cup_shell');ct=BVHTree.FromPolygons(np.array(shell['positions']).reshape(-1,3).tolist(),np.array(shell['indices']).reshape(-1,3).tolist(),all_triangles=True,epsilon=0);rows=[]
for side in [-1,1]:
 ids=np.flatnonzero((side*q[:,0]>0)&(q[:,1]>.4)&(q[:,1]<.8)&(np.linalg.norm(q-a,axis=1)>.04)&(q[:,2]>.6));near=[]
 for i in ids:
  loc,n,tri,d=ct.find_nearest(q[i].tolist());near.append((d,int(i),list(loc),int(tri)))
 near.sort();rows.append({'side':side,'minimumVertexToCupTriangleDistance':near[0][0],'nearestBodyVertex':near[0][1],'cupPoint':near[0][2],'cupTriangle':near[0][3],'verticesWithin.003':sum(x[0]<.003 for x in near),'verticesWithin.01':sum(x[0]<.01 for x in near)})
mouth=next(x for x in b['frames'][0]['meshes'] if x['name']=='A_mouth_ring');mv=np.array(mouth['positions']).reshape(-1,3);mt=BVHTree.FromPolygons(mv.tolist(),np.array(mouth['indices']).reshape(-1,3).tolist(),all_triangles=True,epsilon=0);mouthCandidates=[]
for i,point in enumerate(mv):
 loc,n,tid,d=ct.find_nearest(point.tolist());mouthCandidates.append({'distance':float(d),'mouthVertex':int(i),'mouthPoint':point.tolist(),'cupPoint':list(loc),'cupNormal':list(n),'cupTriangle':int(tid)})
for i,point in enumerate(np.array(shell['positions']).reshape(-1,3)):
 loc,n,tid,d=mt.find_nearest(point.tolist());mouthCandidates.append({'distance':float(d),'cupVertex':int(i),'cupPoint':point.tolist(),'mouthPoint':list(loc),'mouthNormal':list(n),'mouthTriangle':int(tid)})
closestMouth=min(mouthCandidates,key=lambda e:e['distance'])
result={'mouthCupClosestVertexTriangle':closestMouth,'scope':'static hand vertex to real triangulated cup shell closest points, contact location need art review; no continuous clearance bound','hands':rows,'hashes':{n:hashlib.sha256((P/n).read_bytes()).hexdigest() for n in ['contact-route-fit.json','contact-route-pose.npy','contact-cup-meshes.json']}};(P/'contact-distance-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
