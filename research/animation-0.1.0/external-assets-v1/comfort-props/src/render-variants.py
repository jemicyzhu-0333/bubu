"""True GLB geometry CPU renders. Does not use prototype PNG as model texture."""
import bpy, math,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'variants-manifest.json').read_text())
for item in manifest['items']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(root/item['file']))
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=False
 scene.world=bpy.data.worlds.new('World');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.78,.78,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
 meshes=[o for o in scene.objects if o.type=='MESH'];coords=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box];center=Vector(tuple((min(v[i] for v in coords)+max(v[i] for v in coords))/2 for i in range(3)));span=max(max(v[i] for v in coords)-min(v[i] for v in coords) for i in range(3))*1.5
 for name,loc,power in [('Key',(-3,-4,5),350),('Fill',(4,-1,3),120)]:
  d=bpy.data.lights.new(name,'AREA');d.energy=power;d.size=4;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
 d=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',d);scene.collection.objects.link(cam);d.type='ORTHO';d.ortho_scale=span;scene.camera=cam
 scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100;scene.render.film_transparent=False;scene.view_settings.view_transform='Standard'
 for name,angle in [('front',0),('side',90),('quarter',45),('back',180)]:
  t=math.radians(angle);cam.location=center+Vector((4*math.sin(t),-4*math.cos(t),1.5));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(root/'renders'/f'{item["id"]}-{name}.png');bpy.ops.render.render(write_still=True)
print('ALL_RENDERED')
