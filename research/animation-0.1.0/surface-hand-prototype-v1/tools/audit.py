import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;ns={'__file__':str(P/'build.py')};exec((P/'build.py').read_text().split('frames=[];report=[]')[0],ns)
a=ns['a'];idx=ns['idx'];edges=ns['edges'];originalLength=np.linalg.norm(a[edges[:,0]]-a[edges[:,1]],axis=1);originalArea=np.linalg.norm(np.cross(a[idx[:,1]]-a[idx[:,0]],a[idx[:,2]]-a[idx[:,0]]),axis=1)/2
samples=[]
for t in [0,1e-6,1e-4,.01,.04,.08,.12,.18,.25,.5,.75,1]:
 q=ns['deform'](t);np.save(P/f'audit-{t}.npy',q);length=np.linalg.norm(q[edges[:,0]]-q[edges[:,1]],axis=1);ratio=length/originalLength;area=np.linalg.norm(np.cross(q[idx[:,1]]-q[idx[:,0]],q[idx[:,2]]-q[idx[:,0]]),axis=1)/2;k=int(np.argmax(ratio));delta=np.linalg.norm(q-a,axis=1)
 samples.append(dict(t=t,maximumDelta=float(delta.max()),maxEdgeRatio=float(ratio[k]),maxEdgeIDs=edges[k].tolist(),maxEdgeRestLength=float(originalLength[k]),maxEdgePosedLength=float(length[k]),minAreaRatio=float(min(area/originalArea)),minimumArea=float(area.min()),degenerateTriangles=int(sum(area<1e-10)),footError=float(delta[a[:,1]<.4].max()),outsideHeightError=float(delta[(a[:,1]<.4)|(a[:,1]>1)].max())))
(P/'audit.json').write_text(json.dumps(samples,indent=2));print(samples[-1])
