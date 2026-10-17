import json,copy,math,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;ns={'__file__':str(P/'build.py')};exec((P/'build.py').read_text().split('frames=[];report=[]')[0],ns)
base=ns['base'];frames=[]
def add(q,label,views):
 for yaw in views:
  f=copy.deepcopy(base);f['label']=label+' / '+str(yaw);f['time']=len(frames);a=math.radians(yaw);rot=np.array([[math.cos(a),0,math.sin(a)],[0,1,0],[-math.sin(a),0,math.cos(a)]])
  for m in f['meshes']:
   p=q if m['name']=='A_mochi_skin' else np.array(m['positions']).reshape(-1,3);m['positions']=(p@rot.T).ravel().tolist()
  frames.append(f)
for t in [.25,.5,.75]:add(ns['deform'](t),'bump '+str(t),[45,90])
ns['bump']=lambda h,phi,center:np.zeros_like(h)
q=ns['deform'](1);np.save(P/'carrier-only.npy',q);add(q,'carrier-only',[45,90])
(P/'grazing.json').write_text(json.dumps({'sourceGLB':ns['data']['sourceGLB'],'frames':frames}))
