"""Render actual CPU-deformed Three.js geometry; not browser/WebGL evidence.
Input JSON {frames:[exportSceneFrame(...)], sourceGLB:absolute path}.
Fixed camera, same material source, no separate animation or face reconstruction.
"""
import bpy,json,sys,argparse,math,array
from pathlib import Path
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--out',required=True);p.add_argument('--size',type=int,default=384);p.add_argument('--samples',type=int,default=16);p.add_argument('--span',type=float,default=5.0);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);data=json.loads(Path(a.input).read_text());out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=data['sourceGLB'])
materials={o.name:list(o.data.materials) for o in bpy.data.objects if o.type=='MESH'}
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.use_denoising=False;scene.cycles.samples=a.samples;scene.cycles.seed=0
scene.world=bpy.data.worlds.new('World');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.12
for name,loc,power,size in [('grazing',(-5,-.2,2.2),350,1.0)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
camd=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',camd);scene.collection.objects.link(cam);cam.location=(0,-8,1.5);cam.rotation_euler=(Vector((0,0,1.5))-cam.location).to_track_quat('-Z','Y').to_euler();camd.type='ORTHO';camd.ortho_scale=a.span;scene.camera=cam
scene.render.resolution_x=a.size;scene.render.resolution_y=a.size;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='Standard'
objects={}
for i,frame in enumerate(data['frames']):
 for m in frame['meshes']:
  pos=m.get('positions')
  if pos is None:
   pos=array.array('f');pos.frombytes(Path(m['positionsFile']).read_bytes())
  vertices=[(pos[k],-pos[k+2],pos[k+1]) for k in range(0,len(pos),3)]
  if m['name'] not in objects:
   mesh=bpy.data.meshes.new(m['name']);idx=m['indices'];mesh.from_pydata(vertices,[],[idx[k:k+3] for k in range(0,len(idx),3)]);mesh.update();o=bpy.data.objects.new(m['name'],mesh);scene.collection.objects.link(o);objects[m['name']]=o
   for mat in materials.get(m['name'],[]):mesh.materials.append(mat.copy() if m.get('diffuseColors') else mat)
   if m.get('materialColor'):
    mat=bpy.data.materials.new(m['name']);mat.diffuse_color=(*m['materialColor'],1);mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*m['materialColor'],1);mesh.materials.append(mat)
   if m.get('colors'):
    colors=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for k,c in enumerate(colors.data):c.color=m['colors'][k*4:k*4+4]
   for poly in mesh.polygons:poly.use_smooth=True
  else:
   mesh=objects[m['name']].data
   for v,co in zip(mesh.vertices,vertices):v.co=co
   mesh.update()
  if m.get('diffuseColors'):
   mesh=objects[m['name']].data
   color=mesh.color_attributes.get('ActualDiffuse') or mesh.color_attributes.new(name='ActualDiffuse',type='FLOAT_COLOR',domain='POINT')
   for k,c in enumerate(color.data):c.color=m['diffuseColors'][k*4:k*4+4]
   for mat in mesh.materials:
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    attr=nodes.get('ActualDiffuse')
    if attr is None:
     attr=nodes.new('ShaderNodeVertexColor');attr.name='ActualDiffuse';attr.layer_name='ActualDiffuse'
     bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');links.new(attr.outputs['Color'],bsdf.inputs['Base Color'])
 scene.render.filepath=str(out/f'{i:04d}.png');bpy.ops.render.render(write_still=True);print('ACTUAL_FRAME',i,frame['time'],frame.get('label',''),flush=True)
(out/'render-manifest.json').write_text(json.dumps({'scope':'Blender CPU rendering of actual Three.js world-deformed meshes; WebGL/OS unverified','sourceGLB':data['sourceGLB'],'fixedCamera':[0,-8,1.5],'span':a.span,'frames':[{'index':i,'time':f['time'],'label':f.get('label','')} for i,f in enumerate(data['frames'])]},indent=2))
