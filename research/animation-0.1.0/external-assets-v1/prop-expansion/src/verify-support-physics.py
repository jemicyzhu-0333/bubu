import json,hashlib,argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True);a=p.parse_args();d=json.loads(a.report.read_text())
for f in d['inputs']:assert hashlib.sha256(Path(f['path']).read_bytes()).hexdigest()==f['sha256'],'Stale support evidence: '+f['path']
assert len(d['items'])==41
for i in d['items']:
 assert i['originalActorArraysUnchangedVsPriorPose'],i['id']+' actor changed'
 assert i['bodyTriangleCrossings']==0 and i['faceTriangleCrossings']==0,i['id']+' intersects body/face'
 if i['groundError'] is not None:assert i['groundError']<1e-6,i['id']+' leaves ground'
 if i['kind']=='hand-constraint':assert i['finiteSurfaceContact'],i['id']+' has only point contact'
 if i['id']=='open-book':assert i['bounds'][1][0]>.006,'Book penetrates ground'
print('41 current-input support records verified; geometric patch does not certify grasp closure or runtime dynamics')
