import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import argparse,sys
parser=argparse.ArgumentParser();parser.add_argument('--cache-root',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
root=args.cache_root.resolve()/'play-props'
source_root=Path(__file__).resolve().parents[1]
original=json.load(open(root.parent/'accessory/review/halo-static.json'))['frames'][0]['meshes'];original={m['name']:m for m in original if m['name'].startswith(('Bubu_','A_'))}
def geo(m):
 p=m['positions'];v=[Vector(p[i:i+3]) for i in range(0,len(p),3)];ii=m['indices'];return v,BVHTree.FromPolygons(v,[ii[i:i+3] for i in range(0,len(ii),3)],all_triangles=True)
reports=[]
for id in ['ball','energy-token','treasure-chest','paper-plane','cardboard-box','building-block']:
 data=json.load(open(root/'reports'/f'{id}-mounted.json'));meshes=data['frames'][0]['meshes'];actor={m['name']:m for m in meshes if m['name'] in original};props={m['name']:geo(m) for m in meshes if m['name'] not in original};body=geo(actor['Bubu_body'])[1];face=[geo(m)[1] for n,m in actor.items() if n.startswith('A_') and len(set(m['positions']))>3];handv,hand=geo(actor['Bubu_hand-right']);footv=[v for n,m in actor.items() if n.startswith('Bubu_foot') for v in geo(m)[0]]
 pverts=[v for v,b in props.values() for v in v];bounds=[[min(v[i] for v in pverts),max(v[i] for v in pverts)] for i in range(3)];distances=[min(b.find_nearest(v)[3] for _,b in props.values()) for v in handv];footdist=[min(b.find_nearest(v)[3] for _,b in props.values()) for v in footv];contact= id in ['energy-token','paper-plane'];penetrations=[]
 if contact:
  solids=list(props.values())
  if id=='energy-token':
   # Four material surfaces jointly form one closed beveled crystal.
   # Ray parity on an individual open material fragment is not a solid test.
   vv=[];ff=[]
   for m in meshes:
    if m['name'].startswith('Energy_crystal_'):
     off=len(vv);pp=m['positions'];vv.extend(Vector(pp[k:k+3]) for k in range(0,len(pp),3));ii=m['indices'];ff.extend([off+x for x in ii[k:k+3]] for k in range(0,len(ii),3))
   solids=[(vv,BVHTree.FromPolygons(vv,ff,all_triangles=True))]
  for vertex in handv:
   for verts,bvh in solids:
    if not all(min(q[i] for q in verts)<=vertex[i]<=max(q[i] for q in verts) for i in range(3)):continue
    origin=vertex.copy();direction=Vector((1,.371,.193)).normalized();hits=0
    for _ in range(30):
     loc,_,_,_=bvh.ray_cast(origin,direction,5)
     if loc is None:break
     hits+=1;origin=loc+direction*.000001
    if hits%2:penetrations.append(bvh.find_nearest(vertex)[3])
 intersections={n:len(body.overlap(b)) for n,(v,b) in props.items()};face_intersections={n:sum(len(b.overlap(f)) for f in face) for n,(v,b) in props.items()}
 r={'id':id,'unchanged13ActorMeshes':len(actor)==13 and all(m['positions']==original[n]['positions'] and m['indices']==original[n]['indices'] for n,m in actor.items()),'bodyTriangleCrossings':sum(intersections.values()),'faceTriangleCrossings':sum(face_intersections.values()),'handMinimumSurfaceDistance':min(distances) if contact else None,'surfaceContactTolerance':.003 if contact else None,'handVerticesWithin001':sum(d<.01 for d in distances) if contact else None,'handMaxInsidePenetration':max(penetrations,default=0) if contact else None,'footMinSurfaceDistance':min(footdist) if id=='picnic-mat' else None,'bounds':bounds,'fixedBodyScaleSafeEnvelope':all(-2.63<=v.x<=2.63 and -.04<=v.y<=3.1 and -2.63<=v.z<=2.63 for v in pverts),'bodyCrossingByPart':{k:v for k,v in intersections.items() if v}};r['staticAuditPass']=r['unchanged13ActorMeshes'] and r['bodyTriangleCrossings']==0 and r['faceTriangleCrossings']==0 and r['fixedBodyScaleSafeEnvelope'] and (not contact or (r['handMinimumSurfaceDistance']<.003 and r['handMaxInsidePenetration']<.025)) and (id!='picnic-mat' or r['footMinSurfaceDistance']<.005);reports.append(r)
json.dump({'scope':'Actual world triangle BVH + surface proximity + unchanged original geometry. Static only, no wardrobe or motion certification. Fixed units, no auto fit.', 'items':reports},open(root/'reports/mount-audit.json','w'),indent=2);print(json.dumps(reports,indent=2))
