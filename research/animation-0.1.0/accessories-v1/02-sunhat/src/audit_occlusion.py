import bpy,sys,json,argparse,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1];ap=argparse.ArgumentParser();ap.add_argument('--body',required=True);ap.add_argument('--mapper',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);sys.path.insert(0,str(Path(a.mapper).parent));from face_library import STATES,apply_blender
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=a.body);old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(P/'sunhat.glb'));hats=[o for o in bpy.data.objects if o not in old and o.type=='MESH']
for o in hats:o.location.z+=1.62766
bpy.context.view_layer.update()
def tree(objects):
 verts=[];polys=[]
 for o in objects:
  offset=len(verts);verts.extend([o.matrix_world@v.co for v in o.data.vertices]);polys.extend([[offset+i for i in f.vertices] for f in o.data.polygons])
 return BVHTree.FromPolygons(verts,polys)
hat=tree(hats);skin=tree([bpy.data.objects['A_mochi_skin']]);results=[]
for state in STATES:
 apply_blender(state,1);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();points=[]
 for name in ['A_eye_L','A_eye_R','A_brow_L','A_brow_R','A_eye_highlight_L','A_eye_highlight_R','A_mouth_ring','A_tongue']:
  o=bpy.data.objects[name].evaluated_get(dg);m=o.to_mesh();ids=set(i for f in m.polygons if f.area>1e-10 for i in f.vertices);points.extend((name,o.matrix_world@m.vertices[i].co) for i in ids);o.to_mesh_clear()
 for angle,elev in [(a,e) for a in [0,-45,45,-85,85] for e in [-6,0,6]]:
  aa=math.radians(angle);ee=math.radians(elev);direction=Vector((math.sin(aa)*math.cos(ee),-math.cos(aa)*math.cos(ee),math.sin(ee)));visible=occluded=0;names={}
  for name,p in points:
   if skin.ray_cast(p+direction*1e-4,direction,5)[0] is not None:continue
   visible+=1
   if hat.ray_cast(p+direction*1e-4,direction,5)[0] is not None:occluded+=1;names[name]=names.get(name,0)+1
  results.append({'state':state,'angle':angle,'elevation':elev,'bodyVisibleFeatureVertices':visible,'hatOccludedVertices':occluded,'meshes':names})
(P/'review/all18-hat-occlusion.json').write_text(json.dumps(results,indent=2));bad=[r for r in results if r['hatOccludedVertices']];print('OCCLUSION',bad)
assert not bad
