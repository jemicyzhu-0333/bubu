#!/usr/bin/env python3
import argparse,pathlib,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--proof',type=pathlib.Path,required=True);a=p.parse_args();d=json.loads(a.proof.read_text());assert d['schema']=='bubu-basic-prop-evidence/1'
for r in d['inputs']:
 f=pathlib.Path(r['path']);assert f.is_file() and hashlib.sha256(f.read_bytes()).hexdigest()==r['sha256'],f'Stale input: {f}'
for r in json.load(open(d['fixtureManifest']))['files']:
 f=pathlib.Path(d['referenceRoot'])/r['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==r['sha256'],f'Stale fixture: {f}'
fits=json.load(open(d['report']))['fits'];assert len(fits)==2
for fit in fits:
 assert sum(fit['propBodyBoundaryIntersections'].values())==0
 assert sum(fit['propFaceBoundaryIntersections'].values())==0
 for h in fit['hands'].values():assert h['actualHandNeighborhoodMinimumPropDistance']<.003
print('Current static geometry-bound evidence accepted; hand-cap qualification retained')
