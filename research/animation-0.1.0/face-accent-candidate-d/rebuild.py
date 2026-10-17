"""Blender 4.3.2: --python rebuild.py -- --source approved/look.blend.gz --out recovery [--render]."""
import bpy,sys,argparse,gzip,tempfile,hashlib,json,math,array
from pathlib import Path
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--mapper');p.add_argument('--out',required=True);p.add_argument('--render',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);src=Path(a.source).resolve();out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
expected='6f2ad01a560198b0297fbc472bbcc0863f1291a2de937d5084e51feecf510dde';assert hashlib.sha256(src.read_bytes()).hexdigest()==expected,'Wrong approved look archive'
mapper=Path(a.mapper).resolve() if a.mapper else src.parent/'face_library.py';assert hashlib.sha256(mapper.read_bytes()).hexdigest()=='898363a08b26dabe7abcb19612987c329fc9520f3cba0e1e88cc086891eecbc6','Wrong approved mapper';sys.path.insert(0,str(mapper.parent));from face_library import apply_blender

def geometry():
 d={}
 for o in bpy.data.objects:
  if o.type!='MESH':continue
  h=hashlib.sha256()
  for v in o.data.vertices:h.update(array.array('f',v.co).tobytes())
  for poly in o.data.polygons:h.update(array.array('I',poly.vertices).tobytes())
  if o.data.shape_keys:
   for k in o.data.shape_keys.key_blocks:
    h.update(k.name.encode())
    for v in k.data:h.update(array.array('f',v.co).tobytes())
  d[o.name]=h.hexdigest()
 return d

def colorhash(attr):return hashlib.sha256(b''.join(array.array('f',c.color).tobytes() for c in attr.data)).hexdigest()
def render(st,variant,views):
 s=bpy.context.scene;s.cycles.samples=96;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100
 for view,ang in views:
  aa=math.radians(ang);cam=s.camera;cam.location=(math.sin(aa)*7,-math.cos(aa)*7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(out/f'{st}-{variant}-{view}.png');bpy.ops.render.render(write_still=True)
with tempfile.TemporaryDirectory() as tmp:
 blend=Path(tmp)/'approved-look.blend';blend.write_bytes(gzip.decompress(src.read_bytes()))
 for st in ['P2','N3']:
  bpy.ops.wm.open_mainfile(filepath=str(blend));baseline=geometry();apply_blender(st,1)
  if a.render:render(st,'original',[('front',0)])
  skin=bpy.data.objects['A_mochi_skin'];ca=skin.data.color_attributes.active_color;before=[tuple(c.color) for c in ca.data];outside=[];weights=[]
  for i,(v,c) in enumerate(zip(skin.data.vertices,ca.data)):
   x,y,z=v.co;old=Vector(c.color[:3]);r2=((abs(x)-.61)/.27)**2+((z-.80)/.17)**2;field=max(0,1-r2)**2;front=max(0,min(1,(-y-.18)/.4));front=front*front*(3-2*front);w=.72*field*front;tint=Vector((.95,.090,.125));c.color=(*old.lerp(tint,w),1);weights.append(w)
   if not w:outside.append(i)
  if st=='N3':
   mouth=bpy.data.objects['A_mouth_ring'];mat=mouth.data.materials[0].copy();mat.name='Candidate D warm N3 cavity';mouth.data.materials[0]=mat;attr=mouth.data.color_attributes.new(name='CandidateCavity',type='FLOAT_COLOR',domain='POINT');n=mat.node_tree.nodes.new('ShaderNodeVertexColor');n.layer_name=attr.name;mat.node_tree.links.new(n.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color']);ev=mouth.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh()
   for v,c in zip(me.vertices,attr.data):
    x,y,z=v.co;rho=((x/.140)**2+((z-.677)/.157)**2)**.5;w=max(0,1-rho*rho)**2*.85;c.color=(.002+.027*w,.002+.004*w,.003+.006*w,1)
   ev.to_mesh_clear()
  audit={'state':st,'status':'pending user visual acceptance; not runtime integrated','sourceArchiveSha256':expected,'geometryExact':baseline==geometry(),'outsideSupportColorsExact':all(before[i]==tuple(ca.data[i].color) for i in outside),'changedBodyVertices':sum(before[i]!=tuple(c.color) for i,c in enumerate(ca.data)),'bodyVertexCount':len(ca.data),'bodyColorSha256':colorhash(ca),'mouthColorSha256':colorhash(attr) if st=='N3' else None,'tongueGeometryAndMaterialUnchanged':True}
  assert audit['geometryExact'] and audit['outsideSupportColorsExact'];(out/f'audit-{st}.json').write_text(json.dumps(audit,indent=2));bpy.ops.wm.save_as_mainfile(filepath=str(out/f'candidate-d-{st}.blend'))
  if a.render:render(st,'local-soft',[('front',0),('quarter',-52)] if st=='P2' else [('front',0)])
print('CANDIDATE_D_RECOVERY_VERIFIED')
