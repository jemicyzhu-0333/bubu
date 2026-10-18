#!/usr/bin/env python3
"""Fail closed if source, models, generator, mounted geometry or audit has changed."""
import argparse,pathlib,json,hashlib,math
p=argparse.ArgumentParser();p.add_argument('--proof',type=pathlib.Path,required=True);a=p.parse_args();proof=json.loads(a.proof.read_text());assert proof['schema']=='bubu-current-prop-evidence/1'
for row in proof['inputs']:
 f=pathlib.Path(row['path']);assert f.is_file(),f'Missing {f}';assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale input: {f}'
for row in json.load(open(proof['fixtureManifest']))['files']:
 f=pathlib.Path(proof['referenceRoot'])/row['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale fixture source: {f}'
group=proof['group'];expected={'comfort-props':{'mirror','tissue','cushion','binoculars','telescope','pillow','tissue-sheet','telescope-handheld'},'play-props':{'ball','energy-token','treasure-chest','paper-plane','cardboard-box','building-block'},'fantasy-props':{'butterfly','ground-hole','bubble-wand','magic-hat','star','yarn-ball','knitting-needle','flower','umbrella'}}
out=a.proof.parent;actor=json.load(open(out.parent.parent/'accessory/review/halo-static.json'))['frames'][0]['meshes'];actor={m['name']:m for m in actor if m['name'].startswith(('Bubu_','A_'))};assert len(actor)==13
rows=[r for f in proof['reports'] for r in json.load(open(f))['items']]
# Fantasy manifest is authoritative for nine existing assets; never invent a replacement set.
if group=='fantasy-props':
 manifest=next(pathlib.Path(r['path']) for r in proof['inputs'] if r['path'].endswith('/fantasy-props/manifest.json'));expected[group]={r['id'] for r in json.load(open(manifest))['items']};assert len(expected[group])==9
assert len(rows)==len(expected[group]) and {r['id'] for r in rows}==expected[group]
for r in rows:
 assert r['staticAuditPass'] and r['unchanged13ActorMeshes'] and r['fixedBodyScaleSafeEnvelope'],r['id']
 assert r['bodyTriangleCrossings']==r['faceTriangleCrossings']==0,r['id']
 meshes=json.load(open(out/(r['id']+'-mounted.json')))['frames'][0]['meshes']
 for name,m in actor.items():
  matches=[x for x in meshes if x['name']==name];assert len(matches)==1;assert matches[0]['positions']==m['positions'] and matches[0]['indices']==m['indices']
 props=[m for m in meshes if m['name'] not in actor];assert props
 for m in meshes:
  assert len(m['positions'])%3==0 and all(type(v) in [int,float] and math.isfinite(v) for v in m['positions'])
  assert all(type(i)==int and 0<=i<len(m['positions'])//3 for i in m['indices'])
 bounds=[[min(m['positions'][i] for m in props for i in range(axis,len(m['positions']),3)),max(m['positions'][i] for m in props for i in range(axis,len(m['positions']),3))] for axis in range(3)]
 assert all(abs(bounds[i][j]-r['bounds'][i][j])<1e-6 for i in range(3) for j in range(2))
 if r['handMinimumSurfaceDistance'] is not None:
  assert r['handMinimumSurfaceDistance']<(.003 if group=='play-props' else .012) and r['handMaxInsidePenetration']<.025
if group=='play-props':
 stage=json.load(open(out/'stage-audit.json'));assert len(stage['items'])==8 and abs(stage['bodyDesignWidthCss']-99)<.02
 assert all(i['pass'] and len(i['views'])==4 and all(v['outOfFrameVertices']==0 for v in i['views']) for i in stage['items'])
 repeated=json.load(open(out/'repeated-audit.json'));assert len(repeated)==2 and all(r['original13MeshesUnchanged'] and r['bodyTriangleCrossings']==r['faceTriangleCrossings']==0 for r in repeated)
print(group+': current source/model/mount/audit hashes and static geometry accepted')
