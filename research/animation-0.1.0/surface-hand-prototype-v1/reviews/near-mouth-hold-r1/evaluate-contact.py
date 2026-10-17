"""Evaluate the frozen isolated static contact configuration, no runtime writes."""
import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent
exec((P/'build.py').read_text().split('frames=[];report=[]')[0])
j=json.loads((P/'contact-route-fit.json').read_text());v=j['parameters'];q=a.copy()
for p in patches:q[p['mask']]=p['target'][p['mask']]
for side,angle in [(1,v['rightAngle']),(-1,v['leftAngle'])]:
 th=np.arctan2(z/depth,side*x);mask=(side*x>0)&(y>.4)&(y<.8)&(th>.8);d=bump(y+.665-v['handHeight'],th,angle)*(v['capAmplitude']/.16);scale=d/np.maximum(r,1e-12);q[mask,0]+=x[mask]*scale[mask];q[mask,2]+=z[mask]*scale[mask]
np.save(P/'contact-route-pose.npy',q)
print({'config':j['configId'],'finite':bool(np.isfinite(q).all()),'feetMax':float(np.linalg.norm(q[y<.4]-a[y<.4],axis=1).max())})
