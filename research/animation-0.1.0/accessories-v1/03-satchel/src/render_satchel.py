import bpy,sys,math,json,argparse
from pathlib import Path
from mathutils import Vector,Matrix
P=Path(__file__).resolve().parents[1];ROOT=P.parents[1];sys.path.insert(0,str(P/'src'));
ap=argparse.ArgumentParser();ap.add_argument('--body',default=str(ROOT/'runtime-facepath05/fixtures/face-d2/asset.glb'));ap.add_argument('--look',default=None);ap.add_argument('--mapper');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if args.look:bpy.ops.wm.open_mainfile(filepath=args.look)
else:
 bpy.ops.wm.read_factory_settings(use_empty=True);studio=json.loads((P/'src/review-studio.json').read_text());s=bpy.context.scene;s.render.engine='CYCLES';s.world=bpy.data.worlds.new('Approved review world');s.world.use_nodes=True;bg=s.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=studio['worldColor'];bg.inputs[1].default_value=studio['worldStrength'];s.view_settings.view_transform=studio['viewTransform'];s.view_settings.look=studio['look'];s.view_settings.exposure=studio['exposure'];s.view_settings.gamma=studio['gamma']
 for d in studio['lights']:
  light=bpy.data.lights.new(d['name'],d['type']);light.energy=d['energy'];light.color=d['color']
  if hasattr(light,'size'):light.size=d['size']
  o=bpy.data.objects.new(d['name'],light);s.collection.objects.link(o);o.matrix_world=Matrix(d['matrix'])
 cd=bpy.data.cameras.new('Review camera');cd.type='ORTHO';cam=bpy.data.objects.new('Review camera',cd);s.collection.objects.link(cam);s.camera=cam
for o in list(bpy.data.objects):
 if o.type not in ['CAMERA','LIGHT'] and o.name!='A lighting floor':bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=args.body)
body=[o for o in bpy.data.objects if o.name.startswith('A_')];rig=bpy.data.objects['A_Rig05'];root=bpy.data.objects['A_reference_root']
existing=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(P/'satchel.glb'));objects=[o for o in bpy.data.objects if o not in existing];anchor=bpy.data.objects.new('Satchel contact anchor',None);bpy.context.collection.objects.link(anchor);anchor.location=(0,0,1.62766);anchor.parent=root
for o in objects:o.parent=anchor
s=bpy.context.scene;s.cycles.use_denoising=False;s.cycles.samples=24;s.cycles.seed=0;s.render.resolution_percentage=100;s.render.resolution_x=384;s.render.resolution_y=384;s.render.film_transparent=True;s.render.image_settings.color_mode='RGBA';cam=s.camera;cam.data.ortho_scale=2.9
out=P/'review';out.mkdir(exist_ok=True)
frames=[]
def render(name,angle,target=(0,0,1.10),span=2.9):
 aa=math.radians(angle);cam.location=(math.sin(aa)*7,-math.cos(aa)*7,target[2]);cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=span;s.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True);frames.append({'name':name,'angle':angle,'rootRotation':list(root.rotation_euler),'sway':list(anchor.rotation_euler)})
for n,a in [('front',0),('quarter',-45),('side',-90),('back',180)]:render('worn-'+n,a)
for angle in range(0,360,30):render('turn-%03d'%angle,angle)
for n,a in [('front',0),('quarter',-45),('side',-90),('back',180)]:
 for o in body:
  if o.type=='MESH':o.hide_render=True
 render('isolated-'+n,a,(0,0,.45),2.7)
cam.location=(0,5,.7);cam.rotation_euler=(Vector((0,0,.45))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=2.7;s.render.filepath=str(out/'isolated-underside.png');bpy.ops.render.render(write_still=True)
for o in body:
 if o.type=='MESH':o.hide_render=False
for i in range(8):
 phase=i*math.pi/4;root.rotation_euler=(.07*math.sin(phase),.04*math.cos(phase),0);anchor.rotation_euler.y=0
 rig.pose.bones['Shoulder_L'].rotation_mode='XYZ';rig.pose.bones['Shoulder_L'].rotation_euler.z=.16*math.sin(phase)
 rig.pose.bones['Hip_R'].rotation_mode='XYZ';rig.pose.bones['Hip_R'].rotation_euler.x=.10*math.cos(phase)
 render('motion-%02d'%i,-45)
if args.mapper:
 sys.path.insert(0,str(Path(args.mapper).parent));from face_library import apply_blender
 root.rotation_euler=(0,0,0);anchor.rotation_euler=(0,0,0)
 for bone in rig.pose.bones:bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0)
 for state in ['N2','N3','S3','S5']:
  apply_blender(state,1)
  render('expression-'+state+'-front',0);render('expression-'+state+'-quarter',-45)
(out/'render-manifest.json').write_text(json.dumps({'frames':frames,'scope':'Blender original approved D2 body plus independent sprout; bounded pose fixture, not production pointer events'},indent=2))
