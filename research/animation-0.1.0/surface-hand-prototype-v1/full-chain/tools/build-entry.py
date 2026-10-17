import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent
exec((P/'build.py').read_text().split('frames=[];report=[]')[0])
hold=json.loads((P/'../inputs/hold-fit.json').read_text())['parameters'];D=P/'lifecycle';D.mkdir(exist_ok=True)
def entry(u):
 if u==0:return a.copy()
 s=smooth(u/.18);travel=smooth((u-.08)/.92);cy=.665+(hold['handHeight']-.665)*travel;amplitude=.16+(hold['capAmplitude']-.16)*travel;q=a.copy()
 for p in patches:
  side=p['side'];mask=p['mask'];th=np.arctan2(z/depth,side*x);key='rightAngle' if side==1 else 'leftAngle';center=-.08+(hold[key]+.08)*travel;target=p['target'].copy();phi,h=p['uv'].T;d=bump(h+.665-cy,phi,center)*(amplitude/.16);norm=(abs(np.cos(phi))**n+abs(np.sin(phi))**n)**(1/n);target[:,0]+=side*d*np.cos(phi)/norm;target[:,2]+=depth*d*np.sin(phi)/norm;q[mask]=(1-s)*a[mask]+s*target[mask]
  other=(side*x>0)&(~mask);d=bump(y+.665-cy,th,center)*(amplitude/.16)*s;scale=d/r;q[other,0]+=x[other]*scale[other];q[other,2]+=z[other]*scale[other]
 return q
for i,u in enumerate(np.linspace(0,1,33)):np.save(D/f'entry-{i:03}.npy',entry(u))
check=entry(1)-np.load(P/'../inputs/hold-pose.npy');print('entry endpoint delta',abs(check).max());(D/'entry-config.json').write_text(json.dumps({'scope':'same cotangent carrier and round cap; rest -> frozen near-mouth hold. 33u samples','endpointMaxDelta':float(abs(check).max()),'samples':[float(u) for u in np.linspace(0,1,33)]},indent=2))
