#!/usr/bin/env python3
"""Fail closed on stale geometry, source, audit, generator or report inputs."""
import argparse,pathlib,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--proof',type=pathlib.Path,required=True);a=p.parse_args();proof=json.load(open(a.proof));assert proof['schema']=='bubu-current-mount-evidence/1'
for row in proof['inputs']:
 f=pathlib.Path(row['path']);assert f.is_file(),f'Missing {f}';assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale input: {f}'
fixture=json.load(open(proof['fixtureManifest']))
for row in fixture['files']:
 f=pathlib.Path(proof['referenceRoot'])/row['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale fixture source: {f}'
report=json.load(open(proof['report']));assert len(report['items'])==5
assert all(x['staticAuditPass'] and x['unchanged13ActorMeshes'] and x['bodyTriangleCrossings']==0 and x['faceTriangleCrossings']==0 for x in report['items'])
print('Current geometry-bound audit accepted; static evidence only')
