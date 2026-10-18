"""Independent evidence freshness and source-coordinate rejection probes.
No cached boolean can override actual byte hashes or vertex correspondence.
"""
import json,hashlib,copy
from pathlib import Path
import numpy as np
from portable_paths import P,R,ASSET,COLLISION
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def coordinate(d):
 inv=np.linalg.inv(np.array(d['sourceToWorld']).reshape(4,4).T)
 for m in d['frames'][0]['meshes']:
  if not m['name'].startswith('Bubu_'):continue
  expected=np.load(R/f"hybrid-inputs/{m['name']}.npz")['POSITION'];world=np.array(m['positions']).reshape(-1,3);actual=world@inv[:3,:3].T+inv[:3,3]
  assert np.max(np.abs(actual-expected))<1e-6,'Source vertex mismatch'
def freshness(inputs):
 for name,record in inputs.items():assert sha(P/record['path'])==record['sha256'],f'Stale input: {name}'
host=json.loads((P/'reports/host-audit.json').read_text());freshness(host['inputs']);d=json.loads((P/'review/combined-static.json').read_text());coordinate(d)
probes={}
for label,mutate in [('wrongWorldMatrix',lambda x:x['sourceToWorld'].__setitem__(12,x['sourceToWorld'][12]+.32)),('changedBodyVertex',lambda x:x['frames'][0]['meshes'][0]['positions'].__setitem__(0,x['frames'][0]['meshes'][0]['positions'][0]+.32))]:
 bad=copy.deepcopy(d);mutate(bad)
 try:coordinate(bad)
 except AssertionError:probes[label]='rejected'
 else:raise AssertionError(f'Counterexample incorrectly accepted: {label}')
bad=copy.deepcopy(host['inputs']);bad['wrapper']['sha256']='0'*64
try:freshness(bad)
except AssertionError:probes['staleWrapperHash']='rejected'
else:raise AssertionError('Stale hash accepted')
tea=json.loads((P/'reports/tea-collision.json').read_text())
for relative,digest in tea['inputs'].items():assert sha(P.parent/relative)==digest,f'Stale tea input: {relative}'
report={'hostFresh':True,'teaFresh':True,'recomputedOriginalVertexProof':True,'counterexamples':probes,'verifierSHA256':sha(Path(__file__))}
(P/'reports/independent-rejection.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
