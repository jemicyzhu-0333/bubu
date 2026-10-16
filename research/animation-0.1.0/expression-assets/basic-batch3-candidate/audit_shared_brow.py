from pathlib import Path
import json,hashlib
from audit_export_identity import load,acc,meshes
import numpy as np
P=Path(__file__).parent
A=P.parent/'bubu-3d-a-basic-face-batch1-20261016/bubu-a05-basic-batch1.glb';C=P/'bubu-a05-basic-batch3.glb';ga,ba=load(A);gc,bc=load(C);ma,mc=meshes(ga),meshes(gc);r={'batch1SHA256':hashlib.sha256(A.read_bytes()).hexdigest(),'batch3SHA256':hashlib.sha256(C.read_bytes()).hexdigest(),'brows':{}}
for n in ['A_brow_L','A_brow_R']:
 a,c=ma[n]['primitives'][0],mc[n]['primitives'][0];row={sem:bool(np.array_equal(acc(ga,ba,i),acc(gc,bc,c['attributes'][sem]))) for sem,i in a['attributes'].items()};row['indices']=bool(np.array_equal(acc(ga,ba,a['indices']),acc(gc,bc,c['indices'])));r['brows'][n]=row
r['allSharedBaseExact']=all(v for row in r['brows'].values() for v in row.values());assert r['allSharedBaseExact'];(P/'shared-brow-basis-audit.json').write_text(json.dumps(r,indent=2));print('SHARED_BROW_BASIS',r['allSharedBaseExact'])
