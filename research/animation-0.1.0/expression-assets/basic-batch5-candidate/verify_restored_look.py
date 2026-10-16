import bpy,sys
from pathlib import Path
from mathutils import Vector
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=str(P/'_restored/bubu-a05-basic-batch5-look.blend'));apply_basic('T5',0)
s=bpy.context.scene;s.cycles.samples=96;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100;s.camera.location=(0,-7,.95);s.camera.rotation_euler=(Vector((0,0,.95))-s.camera.location).to_track_quat('-Z','Y').to_euler();(P/'_verification').mkdir(exist_ok=True);s.render.filepath=str(P/'_verification/restored-neutral-front.png');bpy.ops.render.render(write_still=True)
