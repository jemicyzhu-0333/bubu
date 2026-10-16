from pathlib import Path
import json,hashlib,numpy as np
from audit_export_identity import load,acc,meshes
P=Path(__file__).parent;before=Path('/tmp/batch4-before-boundary.glb');after=P/'bubu-a05-basic-batch4.glb';ga,ba=load(before);gc,bc=load(after);ma,mc=meshes(ga),meshes(gc);changed=[];endpoint=[];d4=[]
for n,m in ma.items():
 if 'targetNames' not in m.get('extras',{}):continue
 old=m['extras']['targetNames'];new=mc[n]['extras']['targetNames'];a=m['primitives'][0];c=mc[n]['primitives'][0]
 for name in old:
  aa=a['targets'][old.index(name)];cc=c['targets'][new.index(name)];same=all(np.array_equal(acc(ga,ba,i),acc(gc,bc,cc[k])) for k,i in aa.items())
  if not same:changed.append(n+'/'+name)
  if name.endswith('_08'):endpoint.append(same)
  if name.startswith('BasicD4_'):d4.append(same)
r={'beforeSHA256':hashlib.sha256(before.read_bytes()).hexdigest(),'afterSHA256':hashlib.sha256(after.read_bytes()).hexdigest(),'changedTargets':changed,'onlyA4A8MouthIntermediates':all(n.startswith(('A_mouth_ring/BasicA4_','A_mouth_ring/BasicA8_')) and not n.endswith('_08') for n in changed),'allEndpointAttributesExact':all(endpoint),'D4AllTargetsExact':all(d4)};assert r['onlyA4A8MouthIntermediates'] and r['allEndpointAttributesExact'] and r['D4AllTargetsExact'];(P/'boundary-scope-audit.json').write_text(json.dumps(r,indent=2));print(r)
