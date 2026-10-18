import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parent;ROOT=P.parents[1];bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'bubu-recovery-20261017/research/animation-0.1.0/expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb'))
bpy.ops.import_scene.gltf(filepath=str(P/'bubu-round-tail.glb'))
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=24;s.cycles.use_denoising=False;s.world=bpy.data.worlds.new('world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.6
for name,loc,power,size in [('key',(-3,-4,6),450,5),('fill',(4,-2,3),180,4),('rim',(0,3,5),220,3)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.size=size;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
c=bpy.data.cameras.new('camera');o=bpy.data.objects.new('camera',c);s.collection.objects.link(o);s.camera=o;c.type='ORTHO';c.ortho_scale=2.8;s.render.resolution_x=512;s.render.resolution_y=512;s.render.resolution_percentage=100;s.render.film_transparent=True;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard';(P/'renders').mkdir(exist_ok=True)
for name,angle,z in [('front',0,.95),('profile',90,.95),('rear-quarter',135,.95),('rear',180,.95),('underside',160,-2)]:
 o.location=(8*math.sin(math.radians(angle)),-8*math.cos(math.radians(angle)),z);o.rotation_euler=(Vector((0,0,.95))-o.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(P/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
