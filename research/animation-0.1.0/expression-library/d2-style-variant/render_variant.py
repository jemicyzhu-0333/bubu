import bpy,sys,argparse,gzip,tempfile,math
from pathlib import Path
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--look',required=True);p.add_argument('--asset',required=True);p.add_argument('--mapper',required=True);p.add_argument('--out',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True);sys.path.insert(0,str(Path(a.mapper).resolve().parent));from face_library import apply_blender,STATES
with tempfile.TemporaryDirectory() as tmp:
 look=Path(tmp)/'look.blend';look.write_bytes(gzip.decompress(Path(a.look).read_bytes()));bpy.ops.wm.open_mainfile(filepath=str(look))
for o in list(bpy.data.objects):
 if o.type not in ['CAMERA','LIGHT'] and o.name!='A lighting floor':bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(Path(a.asset).resolve()));s=bpy.context.scene;s.cycles.samples=64;s.cycles.seed=0;s.render.resolution_percentage=100
for st in STATES:
 apply_blender(st,1);s.render.resolution_x=140;s.render.resolution_y=115;cam=s.camera;cam.location=(0,-7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(out/f'{st}-front.png');bpy.ops.render.render(write_still=True)
for st in ['P2','N3']:
 apply_blender(st,1);s.render.resolution_x=414;s.render.resolution_y=342
 for view,ang in [('quarter',-52),('side',-85)]:
  aa=math.radians(ang);cam.location=(math.sin(aa)*7,-math.cos(aa)*7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(out/f'{st}-{view}.png');bpy.ops.render.render(write_still=True)
print('ACTUAL_VARIANT_18_AND_SIDE_RENDER_COMPLETE')
