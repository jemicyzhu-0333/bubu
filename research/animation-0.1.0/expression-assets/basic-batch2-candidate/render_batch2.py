import bpy,sys,math,json,os,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;P=ROOT/'_renders';P.mkdir(exist_ok=True);sys.path.insert(0,str(ROOT));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'_restored/bubu-a05-basic-batch2-look.blend'));s=bpy.context.scene;s.cycles.samples=96;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100
views=[('front',0),('quarter',-52),('opposite',52),('side',-85)]
mode=sys.argv[-1];cases=[('R0',0)]+[(st,1) for st in ['R0','A7','S2']]
if mode=='first':views=views[:2]
elif mode=='other':views=views[2:]
elif mode=='pole':views=views[:2];cases=[('A7',t) for t in [.359375,.390625,.40625]]
elif mode=='interpolation':cases=[(st,t) for st in ['R0','A7','S2'] for t in [.25,.5,.75]]
if os.environ.get('ONLY_STATE'):cases=[(st,t) for st,t in cases if st==os.environ['ONLY_STATE']]
manifest={}
for st,t in cases:
 apply_basic(st,t)
 for name,yaw in views:
  a=math.radians(yaw);cam=s.camera;cam.location=(math.sin(a)*7,-math.cos(a)*7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();id=f'basic-{st}-{t:.2f}-{name}';s.render.filepath=str(P/(id+'.png'));bpy.ops.render.render(write_still=True);manifest[id]={'state':st,'intensity':t,'view':name,'assetSHA256':hashlib.sha256((ROOT/'bubu-a05-basic-batch2.glb').read_bytes()).hexdigest()};print('DONE',id,flush=True)
(P/f'render-manifest-{mode}{"-"+os.environ["ONLY_STATE"] if os.environ.get("ONLY_STATE") else ""}.json').write_text(json.dumps(manifest,indent=2))
