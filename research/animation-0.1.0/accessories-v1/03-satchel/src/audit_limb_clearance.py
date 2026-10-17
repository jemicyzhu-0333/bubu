import bpy,json,sys,argparse,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1];ap=argparse.ArgumentParser();ap.add_argument('--points',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);data=json.loads(Path(a.points).read_text());bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(P/'satchel.glb'));objects=[o for o in bpy.data.objects if o.type=='MESH' and 'strap' not in o.name]
for o in objects:o.location.z+=1.62766
bpy.context.view_layer.update();trees={o.name:BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[list(f.vertices) for f in o.data.polygons]) for o in objects};report=[]
for frame in data['frames']:
 minimum=999;intersections={};examples=[]
 for index,bone,x,y,z in frame['points']:
  p=Vector((x,-z,y))
  for name,tree in trees.items():
   q,n,face,d=tree.find_nearest(p);minimum=min(minimum,d)
   if (p-q).dot(n)<-.0005:
    intersections[name]=intersections.get(name,0)+1
    if len(examples)<3:examples.append({'vertex':index,'bone':bone,'object':name,'depth':-(p-q).dot(n)})
 report.append({'axis':frame['axis'],'phase':frame['phase'],'limbVertexCount':len(frame['points']),'minimumPouchSurfaceDistance':minimum,'insideCounts':intersections,'examples':examples})
result={'scope':'Actual shared-r5 Three.js limb deformation, 51 samples across three axes at four-bone caps, convex pouch/flap/catch signed nearest-surface check. Continuous strap excluded because near-hand occlusion is intentional; body itself never changed.','frames':report};(P/'review/limb-clearance-audit.json').write_text(json.dumps(result,indent=2));bad=[r for r in report if r['insideCounts']];print('LIMB_CLEARANCE_BAD',bad[:6]);print('MIN_DISTANCE',min(r['minimumPouchSurfaceDistance'] for r in report));assert not bad
