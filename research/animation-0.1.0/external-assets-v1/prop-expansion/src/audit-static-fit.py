import json,array
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import argparse,sys
parser=argparse.ArgumentParser();parser.add_argument('--cache-root',type=Path,required=True);args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);p=args.cache_root.resolve()/'prop-expansion';data=json.load(open(p/'reports/static-render-input.json'));fits=json.load(open(p/'reports/static-fit.json'))['fits'];reports=[]
def mesh(local):
 m={**data['sharedMeshes'].get(local['name'],{}),**local};pos=m.get('positions')
 if pos is None:
  a=array.array('f');a.frombytes(Path(m['positionsFile']).read_bytes());pos=a
 verts=[Vector(pos[i:i+3]) for i in range(0,len(pos),3)];ind=m['indices'];tri=[ind[i:i+3] for i in range(0,len(ind),3)];return m,verts,tri,BVHTree.FromPolygons(verts,tri,all_triangles=True)
for frame,fit in zip(data['frames'],fits):
 meshes={m['name']:mesh(m) for m in frame['meshes']};body=meshes['Bubu_body'][3];face=[v[3] for k,v in meshes.items() if not k.startswith(('Bubu_','Book','Paper','Pencil'))];props={k:v for k,v in meshes.items() if k.startswith(('Book','Paper','Pencil'))};intersections={k:len(body.overlap(v[3])) for k,v in props.items()};hands={}
 for name,h in fit['hands'].items():
  root=Vector(h['root']);point,normal,idx,d=body.find_nearest(root);signed=(root-point).dot(normal);part='Bubu_hand-left' if name=='handL' else 'Bubu_hand-right';contact=Vector(h['contact']); candidates=[v for k,v in props.items() if (fit['id']!='paper-board' or (k.startswith('Pencil') if name=='handL' else k.startswith('Paper')))]; contact_distance=min(v[3].find_nearest(contact)[3] for v in candidates)
  neighborhood=[v for v in meshes[part][1] if (v-contact).length<=.09]; distances=[min(o[3].find_nearest(v)[3] for o in candidates) for v in neighborhood]; crossings=sum(len(meshes[part][3].overlap(o[3])) for o in candidates); penetrations=[]
  for vertex in neighborhood:
   for obj in candidates:
    nearest,normal,_,distance=obj[3].find_nearest(vertex)
    inside_bounds=all(min(q[i] for q in obj[1])<=vertex[i]<=max(q[i] for q in obj[1]) for i in range(3))
    if not inside_bounds:continue
    ray=Vector((1,.371,.193)).normalized();origin=vertex.copy();hits=0
    for _ in range(20):
     location,_,_,_=obj[3].ray_cast(origin,ray,5)
     if location is None:break
     hits+=1;origin=location+ray*.000001
    if hits%2:penetrations.append(distance)
  hands[name]={'maxLocalRayInsidePenetration':max(penetrations,default=0),'actualHandNeighborhoodVertexCount':len(neighborhood),'actualHandNeighborhoodMinimumPropDistance':min(distances) if distances else None,'actualHandNeighborhoodVerticesWithin001':sum(d<=.01 for d in distances),'actualHandPropBoundaryIntersections':crossings,'contactNearestPropSurfaceDistance':contact_distance,'rootNearestSurfaceDistance':d,'rootSignedAlongNearestNormal':signed,'bodyBoundaryTriangleIntersections':len(body.overlap(meshes[part][3])),'rigidContactGap':h['gap'],'translationFromTeaCarrier':h['rigidCorrection']}
 reports.append({'id':fit['id'],'propBodyBoundaryIntersections':intersections,'propFaceBoundaryIntersections':{k:sum(len(v[3].overlap(f)) for f in face) for k,v in props.items()},'hands':hands,'scope':'Actual triangle BVH boundary overlap and nearest body-surface root test. Hand/body overlap expected at attachment. Negative root sign means locally inside. No OS/GPU claim.'})
json.dump({'fits':reports},open(p/'reports/static-fit-audit.json','w'),indent=2);print(json.dumps(reports,indent=2))
