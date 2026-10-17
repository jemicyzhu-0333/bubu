import bpy,sys,os,json,hashlib,math
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parent;sys.path.insert(0,str(P));from face_library import STATES,apply_blender
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-expression-library-v1-look.blend'));s=bpy.context.scene;s.cycles.samples=96;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100
V=[('front',0),('quarter',-52),('opposite',52),('side',-85)]
mode=sys.argv[-1];cases=[(st,1) for st in STATES] if mode=='endpoints' else[(None,0)]
if mode=='midpoints':cases=[(st,.5) for st in ['04','N3','A7','07','S5','R0','N2']]
if os.environ.get('ONLY_STATE'):cases=[r for r in cases if r[0]==os.environ['ONLY_STATE']]
if os.environ.get('VIEW'):V=[r for r in V if r[0]==os.environ['VIEW']]
manifest={};(P/'renders').mkdir(exist_ok=True)
for state,t in cases:
 apply_blender(state,t)
 for view,ang in V:
  a=math.radians(ang);cam=s.camera;cam.location=(math.sin(a)*7,-math.cos(a)*7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();name=f'{state or "Basis"}-{t:.2f}-{view}';f=P/'renders'/(name+'.png');s.render.filepath=str(f);bpy.ops.render.render(write_still=True);manifest[name]={'state':state,'intensity':t,'view':view,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()};print('DONE',name,flush=True)
(P/f'render-manifest-{mode}{"-"+os.environ["VIEW"] if os.environ.get("VIEW") else ""}.json').write_text(json.dumps(manifest,indent=2))
