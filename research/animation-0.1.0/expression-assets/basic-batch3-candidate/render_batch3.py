import bpy,sys,math,json,os,hashlib
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-a05-basic-batch3-look.blend'));s=bpy.context.scene;s.cycles.samples=96;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100
views=[('front',0),('quarter',-52),('opposite',52),('side',-85)]
mode=sys.argv[-1];cases=[('N3',0)]+[(st,1) for st in ['N3','T05']]
if mode=='first':views=views[:2]
elif mode=='other':views=views[2:]
elif mode=='tongue-threshold':views=views[:2];cases=[('N3',t) for t in [.49,.51,.55,.625]]
elif mode=='interpolation':cases=[(st,t) for st in ['N3','T05'] for t in [.25,.5,.75]]
if os.environ.get('ONLY_STATE'):cases=[(st,t) for st,t in cases if st==os.environ['ONLY_STATE']]
manifest={}
for st,t in cases:
 apply_basic(st,t)
 for name,yaw in views:
  a=math.radians(yaw);cam=s.camera;cam.location=(math.sin(a)*7,-math.cos(a)*7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();id=f'basic-{st}-{t:.2f}-{name}';s.render.filepath=str(P/(id+'.png'));bpy.ops.render.render(write_still=True);manifest[id]={'state':st,'intensity':t,'view':name,'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch3.glb').read_bytes()).hexdigest()};print('DONE',id,flush=True)
(P/f'render-manifest-{mode}{"-"+os.environ["ONLY_STATE"] if os.environ.get("ONLY_STATE") else ""}.json').write_text(json.dumps(manifest,indent=2))
