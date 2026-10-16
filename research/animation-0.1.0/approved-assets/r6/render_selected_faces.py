import bpy,math,json,sys
from pathlib import Path
from mathutils import Vector
P=Path(__file__).parent;sys.path.insert(0,str(P));from selected_face_utils import apply_selected
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-a05-selected-faces-look.blend'));s=bpy.context.scene;s.cycles.samples=96;s.cycles.seed=0;s.render.resolution_x=414;s.render.resolution_y=342;s.render.resolution_percentage=100
views=[('front',0),('quarter',-52),('opposite',52),('side',-85)];manifest={}
mode=sys.argv[-1]
if mode=='first':cases=[('01',0)]+[(st,1) for st in ['01','04','05','07','08']];views=views[:2]
elif mode=='review-new-front':cases=[(st,t) for st in ['04','05','07','08'] for t in [.25,.5,.75]];views=views[:2]
elif mode=='review-new-other':cases=[(st,t) for st in ['04','05','07','08'] for t in [.25,.5,.75,1]];views=views[2:]
elif mode=='correct04':cases=[('04',1)];views=views[:2]
elif mode=='correct0405':cases=[('04',1),('05',1)];views=views[:2]
elif mode=='first08':cases=[('08',1)];views=views[:2]
elif mode=='refresh08':cases=[('08',t) for t in [.25,.5,.75,1]]
elif mode=='contact04':cases=[('04',t) for t in [.3125,.6875,.8125]];views=[views[1],views[3]]
elif mode=='path04-front':cases=[('04',t) for t in [.25,.5,.75]];views=views[:2]
elif mode=='path04-other':cases=[('04',t) for t in [.25,.5,.75]];views=views[2:]
elif mode=='path-front':cases=[(st,t) for st in ['04','07'] for t in [.25,.5,.75]];views=views[:2]
elif mode=='path-other':cases=[(st,t) for st in ['04','07'] for t in [.25,.5,.75]];views=views[2:]
elif mode=='refresh-front':cases=[(st,t) for st in ['07','08'] for t in [.25,.5,.75,1]];views=views[:2]
elif mode=='refresh-other':cases=[(st,t) for st in ['07','08'] for t in [.25,.5,.75,1]];views=views[2:]
elif mode=='views':cases=[('01',0)]+[(st,1) for st in ['01','04','05','07','08']];views=views[2:]
else:cases=[(st,t) for st in ['01','04','05','07','08'] for t in [.25,.5,.75]]
if mode=='interp-front':views=views[:2]
if mode=='interp-other':views=views[2:]
for st,t in cases:
 apply_selected(st,t)
 for view,yaw in views:
  a=math.radians(yaw);cam=s.camera;cam.location=(math.sin(a)*7,-math.cos(a)*7,.95);cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler();name=f'face-{st}-{t:.2f}-{view}';s.render.filepath=str(P/(name+'.png'));bpy.ops.render.render(write_still=True);manifest[name]={'state':st,'intensity':t,'view':view,'yawDegrees':yaw};print('DONE',name,flush=True)
(P/f'render-manifest-{mode}.json').write_text(json.dumps(manifest,indent=2))
