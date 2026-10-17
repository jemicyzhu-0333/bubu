import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;base=json.loads((P/'base.json').read_text());m=next(m for m in base['frames'][0]['meshes'] if m['name']=='A_mochi_skin');a=np.array(m['positions']).reshape(-1,3);tri=np.array(m['indices']).reshape(-1,3);edges=np.unique(np.sort(np.concatenate([tri[:,[0,1]],tri[:,[1,2]],tri[:,[2,0]]]),axis=1),axis=0);L=np.linalg.norm(a[edges[:,0]]-a[edges[:,1]],axis=1);A=np.linalg.norm(np.cross(a[tri[:,1]]-a[tri[:,0]],a[tri[:,2]]-a[tri[:,0]]),axis=1)/2;source=np.zeros(len(a),bool)
for p in json.loads((P/'patches.json').read_text()):source[p['vertices']]=True
out=[]
for label,file in [('entry','audit-0.18.npy'),('travel','audit-0.25.npy'),('final','audit-1.npy'),('carrier','carrier-only.npy')]:
 q=np.load(P/file);delta=np.linalg.norm(q-a,axis=1);affected=np.any(delta[edges]>1e-8,axis=1);lr=np.linalg.norm(q[edges[:,0]]-q[edges[:,1]],axis=1)/L;ar=np.linalg.norm(np.cross(q[tri[:,1]]-q[tri[:,0]],q[tri[:,2]]-q[tri[:,0]]),axis=1)/(2*A);k=np.argsort(lr)[-10:][::-1]
 out.append({'label':label,'affectedEdges':int(sum(affected)),'edgeQuantilesAffected':np.quantile(lr[affected],[0,.01,.5,.95,.99,1]).tolist(),'edgesOver2':int(sum(lr>2)),'edgesOver3':int(sum(lr>3)),'trianglesBelowAreaRatioPoint1':int(sum(ar<.1)),'topEdges':[{'ids':edges[j].tolist(),'restLength':float(L[j]),'posedLength':float(L[j]*lr[j]),'ratio':float(lr[j]),'inOriginalFinPatch':bool(source[edges[j]].all()),'restMidpoint':a[edges[j]].mean(axis=0).tolist()} for j in k]})
(P/'distribution-audit.json').write_text(json.dumps(out,indent=2));print([(r['label'],r['affectedEdges'],r['edgesOver2'],r['edgesOver3'],r['trianglesBelowAreaRatioPoint1']) for r in out])
