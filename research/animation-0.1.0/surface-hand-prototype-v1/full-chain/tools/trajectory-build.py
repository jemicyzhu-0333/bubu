"""One isolated geometry parameter u, no production owner or clock."""
import json,numpy as np,math,copy
from pathlib import Path
from scipy.spatial.transform import Rotation
P=Path(__file__).resolve().parent
exec((P/'build.py').read_text().split('frames=[];report=[]')[0])
hold=json.loads((P/'../inputs/hold-fit.json').read_text());sip=json.loads((P/'../inputs/sip-fit.json').read_text());face=json.loads((P/'face-08.json').read_text());D=P/'trajectory';D.mkdir(exist_ok=True)
flat=a.copy()
for p in patches:flat[p['mask']]=p['target'][p['mask']]
localcup=json.loads((P/'../inputs/sip-cup-meshes.json').read_text());siprot=np.array(sip['cupRotation']);sipcenter=np.array(sip['cupCenter'])
for m in localcup['meshes']:m['positions']=((np.array(m['positions']).reshape(-1,3)-sipcenter)@siprot).ravel().tolist()
def sample(u):
 hp,sp=hold['parameters'],sip['parameters'];par={k:hp[k]*(1-u)+sp[k]*u for k in hp};q=flat.copy()
 for side,key in [(1,'rightAngle'),(-1,'leftAngle')]:
  th=np.arctan2(z/depth,side*x);d=bump(y+.665-par['handHeight'],th,par[key])*(par['capAmplitude']/.16);mask=(side*x>0)&(y>.4)&(y<.88)&(th>.8);scale=d/r;q[mask,0]+=x[mask]*scale[mask];q[mask,2]+=z[mask]*scale[mask]
 rot=Rotation.from_euler('xy',[par['cupTiltX'],par['cupYawY']]).as_matrix();c=np.array(hold['cupCenter'])*(1-u)+np.array(sip['cupCenter'])*u
 c[2]+=.0035*math.sin(math.pi*u)
 cup=copy.deepcopy(localcup)
 for m in cup['meshes']:m['positions']=(np.array(m['positions']).reshape(-1,3)@rot.T+c).ravel().tolist()
 return q,cup,par,c,rot
rows=[]
for i,u in enumerate(np.linspace(0,1,33)):
 q,cup,par,c,rot=sample(u);np.save(D/f'body-{i:03}.npy',q);(D/f'cup-{i:03}.json').write_text(json.dumps(cup));rows.append({'index':i,'u':float(u),'parameters':par,'center':c.tolist(),'rotation':rot.tolist()})
(D/'samples.json').write_text(json.dumps({'scope':'hold lift tilt sip return. 33 geometric samples in u, return reuses reverse path; not full rest entry/exit','face':'08 exact source','controls':[rows[i] for i in range(0,33,4)],'samples':rows},indent=2));(D/'face.json').write_text(json.dumps(face));(D/'base.json').write_text(json.dumps({'frames':[base],'sourceGLB':data['sourceGLB']}));print('33 geometric samples ready')
