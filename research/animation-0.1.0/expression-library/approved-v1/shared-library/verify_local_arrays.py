"""Offline comparison against the signed-zero-preserving archived source arrays."""
from pathlib import Path
import json,hashlib,numpy as np
from glb_io import load,accessor,mesh_by_node
P=Path(__file__).resolve().parent;s=json.loads((P/'library-array-spec.json').read_text());arrays=np.load(P/'library-arrays.npz');report={}
for f in ['bubu-expression-library-v1.glb','bubu-expression-slice7.glb']:
 g,b=load(P/f);mm=mesh_by_node(g);checks=0;zeros=0
 for name,m in mm.items():
  p=m['primitives'][0]
  for sem,a in s['base'][name].items():
   ix=p['indices'] if sem=='indices' else p['attributes'][sem];assert accessor(g,b,ix).tobytes()==arrays[a['array']].tobytes(),(f,name,sem);checks+=1
  if name not in s['faceRoster']:assert not p.get('targets');continue
  assert all(x==0 for x in m['weights']);names=m['extras']['targetNames'];assert len(names)==8*len(g['extras']['activeSemanticStates'])
  for st in g['extras']['activeSemanticStates']:
   for target,entry in s['targets'][st][name].items():
    t=p['targets'][names.index(target)]
    for sem,a in entry['attributes'].items():assert accessor(g,b,t[sem]).tobytes()==arrays[a['array']].tobytes(),(f,name,target,sem);checks+=1
    if entry['fillReason'] is not None:zeros+=2
 for skin,a in zip(g['skins'],s['skin']):assert accessor(g,b,skin['inverseBindMatrices']).tobytes()==arrays[a['array']].tobytes();checks+=1
 assert g['materials']==s['template']['materials']
 report[f]={'sha256':hashlib.sha256((P/f).read_bytes()).hexdigest(),'arrayChecks':checks,'sourceMissingAttributeFills':zeros,'allBitExact':True,'materialsExact':True,'passed':True}
(P/'LOCAL-ARRAY-AUDIT.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
