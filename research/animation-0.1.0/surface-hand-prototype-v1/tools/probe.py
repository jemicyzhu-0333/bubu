import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent
ns={'__file__':str(P/'build.py')};exec((P/'build.py').read_text().split('frames=[];report=[]')[0],ns)
a=ns['a'];e=ns['edges'];d=ns['deform'];q=d(1);length=np.linalg.norm(a[e[:,0]]-a[e[:,1]],axis=1);rat=np.linalg.norm(q[e[:,0]]-q[e[:,1]],axis=1)/length
for k in np.argsort(rat)[-4:]:print(e[k],rat[k],a[e[k]],q[e[k]])
records=[]
for t in [0,1e-6,1e-4,.001,.01,.08,.18,.999999,1]:records.append({'t':t,'maxDelta':float(np.linalg.norm(d(t)-a,axis=1).max())})
(P/'entry-continuity.json').write_text(json.dumps(records,indent=2));print(records)
idx=ns['idx'];q=d(1);cent=q[idx].mean(axis=1);normal=np.cross(q[idx[:,1]]-q[idx[:,0]],q[idx[:,2]]-q[idx[:,0]]);radial=cent.copy();radial[:,1]=0
for p in ns['patches']:
 mask=p['mask'];ti=idx[np.all(mask[idx],axis=1)];uv=p['uv'][ti];area=(uv[:,1,0]-uv[:,0,0])*(uv[:,2,1]-uv[:,0,1])-(uv[:,1,1]-uv[:,0,1])*(uv[:,2,0]-uv[:,0,0]);sel=np.any(mask[idx],axis=1);dot=(normal*radial).sum(axis=1);print('patch',p['side'],'uv+',sum(area>0),'uv-',sum(area<0),'radial+',sum(dot[sel]>0),'radial-',sum(dot[sel]<0),'uvMin',min(abs(area)))
