import bpy,math,json
from pathlib import Path
from mathutils import Vector
P=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(P/'body-only-look.blend'));s=bpy.context.scene;s.cycles.samples=64;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100
mat=bpy.data.materials.new('Archive neutral clay');mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.65,.65,.65,1);bs.inputs['Roughness'].default_value=.8
body=bpy.data.objects['A_mochi_skin'];body.data.materials.clear();body.data.materials.append(mat)
for name,deg in [('front',0),('quarter',-52),('side',-90),('back',180)]:
 a=math.radians(deg);c=s.camera;c.location=(math.sin(a)*7,-math.cos(a)*7,.95);c.rotation_euler=(Vector((0,0,.95))-c.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(P/f'body-gray-{name}.png');bpy.ops.render.render(write_still=True)
