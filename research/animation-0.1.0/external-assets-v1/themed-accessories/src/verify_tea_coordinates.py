import json,hashlib
from pathlib import Path
import numpy as np
from portable_paths import P,R,ASSET,COLLISION;d=json.loads((P/'review/combined-static.json').read_text());m=np.array(d['sourceToWorld']).reshape(4,4).T;inverse=np.linalg.inv(m);meshes={x['name']:x for x in d['frames'][0]['meshes']};report={'method':'Compare inverse-transformed host exports with independent approved source-local hybrid NPZ positions, including left/right foot identity. Cup geometry remains in its existing tea source frame.','sourceToWorldColumnMajor':d['sourceToWorld'],'checks':{}}
for name,source in [('Bubu_body','Bubu_body'),('Bubu_foot-left','Bubu_foot-left'),('Bubu_foot-right','Bubu_foot-right')]:
 expected=np.load(R/f'hybrid-inputs/{source}.npz')['POSITION'];world=np.array(meshes[name]['positions']).reshape(-1,3)[:len(expected)];actual=world@inverse[:3,:3].T+inverse[:3,3];error=float(np.max(np.abs(actual-expected)));assert error<1e-6,(name,error);report['checks'][name]={'vertices':len(expected),'maxSourceCoordinateError':error,'firstExpectedAnchor':expected[0].tolist(),'firstActualAnchor':actual[0].tolist()}
report['teaAuditScriptSHA256']=hashlib.sha256((ASSET/'src/audit_tea.py').read_bytes()).hexdigest();report['allPassed']=True;(P/'reports/tea-coordinate-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
