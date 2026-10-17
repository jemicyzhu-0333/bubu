import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;B=P.parent/'base.json'
if not B.exists():B=P/'base.json'
b=json.loads(B.read_text());m=next(x for x in b['frames'][0]['meshes'] if x['name']=='A_mochi_skin');a=np.array(m['positions']).reshape(-1,3);tri=np.array(m['indices']).reshape(-1,3);edges=np.unique(np.sort(np.concatenate([tri[:,[0,1]],tri[:,[1,2]],tri[:,[2,0]]]),axis=1),axis=0);lens=np.linalg.norm(a[edges[:,0]]-a[edges[:,1]],axis=1);areas=np.linalg.norm(np.cross(a[tri[:,1]]-a[tri[:,0]],a[tri[:,2]]-a[tri[:,0]]),axis=1);rows=[]
for i in [0,1,3,6,12,18,24,30,36,45,60,90,120,150,180,210,240,270]:
 q=np.fromfile(P/f'generated/normal-{i:03}-body.bin',dtype='<f4').reshape(-1,3).astype(float);er=np.linalg.norm(q[edges[:,0]]-q[edges[:,1]],axis=1)/lens;ar=np.linalg.norm(np.cross(q[tri[:,1]]-q[tri[:,0]],q[tri[:,2]]-q[tri[:,0]]),axis=1)/areas;rows.append({'frame':i,'time':i/30,'maxEdgeRatio':float(er.max()),'minAreaRatio':float(ar.min()),'outsideYMax':float(np.linalg.norm(q[(a[:,1]<.4)|(a[:,1]>1)]-a[(a[:,1]<.4)|(a[:,1]>1)],axis=1).max())})
(P/'quality-audit.json').write_text(json.dumps({'scope':'18 selected rendered float32 poses, retained quality risks not production admission','rows':rows},indent=2))
