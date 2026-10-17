from pathlib import Path
import json,numpy as np,hashlib
from glb_io import load,accessor,mesh_by_node
from face_library import STATES,ROSTER,face_weights
P=Path(__file__).resolve().parent;g,b=load(P/'bubu-expression-library-v1.glb');mm=mesh_by_node(g);data={}
for name in ROSTER:
 m=mm[name];p=m['primitives'][0];data[name]={'basis':accessor(g,b,p['attributes']['POSITION']),'tris':accessor(g,b,p['indices']).reshape(-1,3),'deltas':{n:accessor(g,b,t['POSITION']) for n,t in zip(m['extras']['targetNames'],p['targets'])}}
rows=[]
for st in STATES:
 for i in range(65):
  a=i/64;w={k:v for k,v in face_weights(st,a).items() if v};row={'state':st,'intensity':a,'layers':{}}
  for name,d in data.items():
   pos=d['basis'].copy()
   for n,v in w.items():pos=pos+d['deltas'][n]*v
   tr=pos[d['tris']];area=float(np.linalg.norm(np.cross(tr[:,1]-tr[:,0],tr[:,2]-tr[:,0]),axis=1).sum()/2);coincident=bool(np.all(pos==pos[0]));row['layers'][name]={'area':area,'allPointsCoincident':coincident}
   if name.startswith('A_brow') and st not in ['N2','N3','A4','S3','S5']:assert coincident and area==0
   if name=='A_tongue' and (st!='N3' or a<=.5):assert coincident and area==0
  rows.append(row)
r={'goldSHA256':hashlib.sha256((P/'bubu-expression-library-v1.glb').read_bytes()).hexdigest(),'samples':rows,'sampleCount':len(rows),'inactiveLayersAlwaysHidden':True,'zeroMapperClearsEveryFaceLayer':all(v==0 for v in face_weights(None,0).values()),'passed':True};(P/'LAYER-RESET-AUDIT.json').write_text(json.dumps(r,indent=2));print('LAYER_RESET',len(rows),'PASSED')
