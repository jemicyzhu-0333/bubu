import bpy,json,sys,argparse,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1];ap=argparse.ArgumentParser();ap.add_argument('--points',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);data=json.loads(Path(a.points).read_text());bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(P/'scarf.glb'));objects=[o for o in bpy.data.objects if o.type=='MESH']
for o in objects:o.location.z+=1.62766
bpy.context.view_layer.update();report=[]
for dx,dz in [(0,0),(-.025,-.018),(-.025,.018),(.025,-.018),(.025,.018)]:
 trees={};bounds={}
 for o in objects:
  verts=[]
  for v in o.data.vertices:
   p=o.matrix_world@v.co
   if 'tail' in o.name:
    w=max(0,min(1,(.88-p.z)/.56))**2;p.x+=dx*w;p.y-=dz*w
   verts.append(p)
  bounds[o.name]=[(min(v[k] for v in verts),max(v[k] for v in verts)) for k in range(3)]
  trees[o.name]=BVHTree.FromPolygons(verts,[list(f.vertices) for f in o.data.polygons])
 for frame in data['frames']:
  minimum=999;intersections={};examples=[]
  for index,bone,x,y,z in frame['points']:
   p=Vector((x,-z,y))
   for name,tree in trees.items():
    q,n,face,d=tree.find_nearest(p);minimum=min(minimum,d)
    inside=False
    if all(lo<=p[k]<=hi for k,(lo,hi) in enumerate(bounds[name])):
     origin=p.copy();direction=Vector((.932,.271,.241)).normalized();hits=0
     for _ in range(32):
      hit=tree.ray_cast(origin,direction,10)[0]
      if hit is None:break
      hits+=1;origin=hit+direction*1e-5
     inside=hits%2==1
    if inside and d>.0005:
     intersections[name]=intersections.get(name,0)+1
     if len(examples)<3:examples.append({'vertex':index,'bone':bone,'object':name,'depth':d})
  report.append({'dx':dx,'dz':dz,'axis':frame['axis'],'phase':frame['phase'],'limbVertexCount':len(frame['points']),'minimumClothSurfaceDistance':minimum,'insideCounts':intersections,'examples':examples})
result={'scope':'Actual shared-r5 limb vertices: 51 poses across xyz axes at four-bone caps, multiplied by rest and four tail envelope corners. Closed-mesh ray parity penetration check with nearest-surface distance includes collar and tail; discrete envelope samples, not continuous collision proof.','frames':report};(P/'review/limb-clearance-audit.json').write_text(json.dumps(result,indent=2));bad=[r for r in report if r['insideCounts']];print('LIMB_CLEARANCE_BAD',bad[:6]);print('MIN_DISTANCE',min(r['minimumClothSurfaceDistance'] for r in report));assert not bad
