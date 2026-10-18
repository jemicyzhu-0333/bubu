#!/usr/bin/env python3
"""Fail closed for stale candidates, sources, generators, tests, or fresh reports."""
import argparse,pathlib,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--proof',type=pathlib.Path,required=True);a=p.parse_args();proof=json.loads(a.proof.read_text());assert proof['schema']=='bubu-work-garden-current-evidence/1'
for row in proof['inputs']:
 f=pathlib.Path(row['path']);assert f.is_file(),f'Missing {f}';assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale input: {f}'
for row in json.load(open(proof['fixtureManifest']))['files']:
 f=pathlib.Path(proof['referenceRoot'])/row['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale source: {f}'
report=json.load(open(proof['report']))
if proof['group']=='garden-props':
 assert {x['id'] for x in report['items']}=={'shovel','broom','watering-can','dirt-mound','plant-pot'}
 assert all(x['staticAuditPass'] and x['unchanged13ActorMeshes'] and x['bodyTriangleCrossings']==0 and x['faceTriangleCrossings']==0 for x in report['items'])
else:
 assert {x['id'] for x in report}=={'keyboard','laptop','microphone','drum'}
 for x in report:
  assert all(n==0 for n in x['propBodyBoundaryTriangleIntersections'].values());assert all(n==0 for n in x['propFaceBoundaryTriangleIntersections'].values())
  for name in (['Bubu_hand-left'] if x['id']=='microphone' else ['Bubu_hand-left','Bubu_hand-right']):
   h=x['hands'][name];assert h['minimumPropSurfaceDistance']<.01 and h['bodyBoundaryTriangleIntersections']>0 and h['rootSignedBodySurfaceDistance']<=0
 boundary=json.load(open(pathlib.Path(proof['report']).with_name('hand-boundary-audit.json')));assert len(boundary)==7;assert all(h['boundaryVertexCount']>180 and h['outsideBoundaryCount']==0 for h in boundary)
print('PASS fresh hash-bound',proof['group'],'static evidence; user and runtime acceptance pending')
