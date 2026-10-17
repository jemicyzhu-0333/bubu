from pathlib import Path
import numpy as np,json
P=Path(__file__).resolve().parents[1]/'work';topo=json.loads((P/'topology.json').read_text());off=np.cumsum([0]+[m['count']for m in topo]);si=next(i for i,m in enumerate(topo)if m['name']=='A_mochi_skin');first=np.fromfile(P/'frames/0.bin',dtype=np.float32).reshape(-1,3).astype(float);skin0=first[off[si]:off[si+1]];anchor=np.flatnonzero(skin0[:,1]>1.6);head=np.flatnonzero(skin0[:,1]>1.4);hat=np.concatenate([np.arange(off[i],off[i+1])for i,m in enumerate(topo)if m['kind']=='hat']);A=skin0[anchor];ca=A.mean(0);maxHead=maxHat=0;worst=None
for f in json.loads((P/'manifest.json').read_text()):
 d=np.fromfile(P/f"frames/{f['id']}.bin",dtype=np.float32).reshape(-1,3).astype(float);skin=d[off[si]:off[si+1]];B=skin[anchor];cb=B.mean(0);u,s,v=np.linalg.svd((A-ca).T@(B-cb));r=u@v
 if np.linalg.det(r)<0:u[:,-1]*=-1;r=u@v
 hp=np.linalg.norm((skin0[head]-ca)@r+cb-skin[head],axis=1).max();ap=np.linalg.norm((first[hat]-ca)@r+cb-d[hat],axis=1).max()
 if ap>maxHat:worst=f
 maxHead=max(maxHead,float(hp));maxHat=max(maxHat,float(ap))
result={'frames':len(json.loads((P/'manifest.json').read_text())),'upperHeadVertices':len(head),'rigidFitAnchorVertices':len(anchor),'hatVertices':len(hat),'maxUpperHeadRigidResidual':maxHead,'maxHatSameRigidTransformResidual':maxHat,'worst':worst,'scope':'Kabsch rigid transform of actual exported head points; verifies static hat/head relative fit is preserved within sampled CPU geometry precision'};assert maxHead<2e-6 and maxHat<2e-6;(P/'rigid-fit-result.json').write_text(json.dumps(result,indent=2));print(result)
