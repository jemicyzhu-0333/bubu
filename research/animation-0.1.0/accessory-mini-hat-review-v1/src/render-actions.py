import bpy,json,math,sys
from pathlib import Path
import numpy as np
from mathutils import Vector,Matrix
P=Path(__file__).resolve().parents[1]/'work';R=P.parent.parent;bpy.ops.wm.read_factory_settings(use_empty=True)
source={}
for kind,path in [('body',R/'runtime-facepath05/fixtures/face-d2/asset.glb'),('hat',R/'accessories-v1/02-sunhat/sunhat.glb')]:
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path))
 for o in set(bpy.data.objects)-before:
  if o.type=='MESH':source[o.name]=list(o.data.materials)
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
studio=json.loads((R/'accessories-v1/02-sunhat/src/review-studio.json').read_text());s=bpy.context.scene;s.render.engine='CYCLES';s.world=bpy.data.worlds.new('Review world');s.world.use_nodes=True;bg=s.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=studio['worldColor'];bg.inputs[1].default_value=studio['worldStrength'];s.view_settings.view_transform=studio['viewTransform'];s.view_settings.look=studio['look'];s.view_settings.exposure=studio['exposure'];s.view_settings.gamma=studio['gamma']
for d in studio['lights']:
 light=bpy.data.lights.new(d['name'],d['type']);light.energy=d['energy'];light.color=d['color'];
 if hasattr(light,'size'):light.size=d['size']
 o=bpy.data.objects.new(d['name'],light);s.collection.objects.link(o);o.matrix_world=Matrix(d['matrix'])
cam=bpy.data.objects.new('Review camera',bpy.data.cameras.new('Review camera'));s.collection.objects.link(cam);s.camera=cam;cam.data.type='ORTHO';s.cycles.samples=32;s.cycles.use_denoising=False;s.render.resolution_x=s.render.resolution_y=768;s.render.resolution_percentage=100;s.render.film_transparent=True;s.render.image_settings.color_mode='RGBA';out=P/'renders';out.mkdir(exist_ok=True);topo=json.loads((P/'topology.json').read_text());colors=json.loads((P/'colors.json').read_text());frames=[0,45,60,71]
for frame in frames:
 path=P/f'frames/{frame}.bin'
 if not path.exists():continue
 for o in list(bpy.data.objects):
  if o.type=='MESH':bpy.data.objects.remove(o,do_unlink=True)
 data=np.fromfile(path,dtype=np.float32).reshape(-1,3);offset=0
 for m in topo:
  a=data[offset:offset+m['count']];offset+=m['count'];vs=np.stack([a[:,0],-a[:,2],a[:,1]],axis=1);mesh=bpy.data.meshes.new(m['name']);mesh.from_pydata(vs.tolist(),[],np.array(m['indices']).reshape(-1,3).tolist());mesh.update();o=bpy.data.objects.new(m['name'],mesh);s.collection.objects.link(o);name=m['name'];slot=0
  if name.startswith('scarf_collar_') or name.startswith('scarf_tail_'):slot=int(name[-1])-1;name=name[:-2]
  mats=source.get(name)
  if mats:mesh.materials.append(mats[min(slot,len(mats)-1)])
  if m['name'] in colors:
   attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
   for c,v in zip(attr.data,colors[m['name']]):c.color=v
  for poly in mesh.polygons:poly.use_smooth=True
 # Center stage from actual world skin bounds.
 skin=bpy.data.objects['A_mochi_skin'];center=sum((v.co for v in skin.data.vertices),Vector())/len(skin.data.vertices);center.z=(min(v.co.z for v in skin.data.vertices)+max(v.co.z for v in skin.data.vertices))/2
 for label,angle,span in [('front',0,2.6),('right-quarter',45,2.6),('hat-close',0,1.2)]:
  target=center.copy()
  if label=='hat-close':target.z+=.75
  aa=math.radians(angle);cam.location=target+Vector((math.sin(aa)*7,-math.cos(aa)*7,.15));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=span;s.render.filepath=str(out/f'{frame:04d}-{label}.png');bpy.ops.render.render(write_still=True)
