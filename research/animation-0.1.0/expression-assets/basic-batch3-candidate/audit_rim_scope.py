from pathlib import Path
import json,hashlib,numpy as np
from audit_export_identity import load,acc,meshes
P=Path(__file__).parent;before=Path('/tmp/batch3-before-rim.glb');after=P/'bubu-a05-basic-batch3.glb';ga,ba=load(before);gc,bc=load(after);ma,mc=meshes(ga),meshes(gc);rows={};unchangedT05=[]
for n,m in ma.items():
 if 'targetNames' not in m.get('extras',{}):continue
 names=m['extras']['targetNames'];new=mc[n]['extras']['targetNames'];a=m['primitives'][0];c=mc[n]['primitives'][0]
 for target in names:
  ta=a['targets'][names.index(target)];tc=c['targets'][new.index(target)];d=acc(gc,bc,tc['POSITION'])-acc(ga,ba,ta['POSITION']);affected=bool(np.any(d));xzExact=bool(np.array_equal(d[:,:2],np.zeros_like(d[:,:2]))) # glTF x/y = Blender x/z
  if target.startswith('BasicT05_'):unchangedT05.append(all(np.array_equal(acc(ga,ba,ta[sem]),acc(gc,bc,tc[sem])) for sem in ta))
  if affected:rows[n+'/'+target]={'frontXZExactlyEqual':xzExact,'maxDepthChange':float(np.abs(d[:,2]).max()),'maxFrontPlaneChange':float(np.abs(d[:,:2]).max())}
r={'beforeSHA256':hashlib.sha256(before.read_bytes()).hexdigest(),'afterSHA256':hashlib.sha256(after.read_bytes()).hexdigest(),'affectedTargets':rows,'onlyN3MouthAndTongue':all(k.startswith(('A_mouth_ring/BasicN3_','A_tongue/BasicN3_')) for k in rows),'allFrontContoursExactlyEqual':all(v['frontXZExactlyEqual'] for v in rows.values()),'T05ExactlyUnchanged':all(unchangedT05),'T05AccessorChecks':len(unchangedT05)};assert r['onlyN3MouthAndTongue'] and r['allFrontContoursExactlyEqual'] and r['T05ExactlyUnchanged'];(P/'rim-scope-audit.json').write_text(json.dumps(r,indent=2));print('RIM_SCOPE_PASS')
