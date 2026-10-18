#!/usr/bin/env python3
"""Rebuild models byte-for-byte, export actual mounts, audit in Blender, bind then verify.
The existing factory placement and audit thresholds are intentionally preserved.
"""
import argparse,pathlib,json,hashlib,subprocess,datetime,sys
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,type=pathlib.Path,required=True)
p.add_argument('--group',choices=['comfort-props','play-props','fantasy-props'],action='append')
a=p.parse_args();pkg=pathlib.Path(__file__).resolve().parents[1];cache=a.cache_root.resolve();ref=a.reference_root.resolve()
cli=['--repo-root',str(a.repo_root.resolve()),'--reference-root',str(ref),'--cache-root',str(cache)]
def run(*args):subprocess.run(list(map(str,args)),check=True)
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
for group in a.group or ['comfort-props','play-props','fantasy-props']:
 src=pkg/group/'src';out=cache/group/'reports';out.mkdir(parents=True,exist_ok=True);proof=out/'current-evidence.json';proof.unlink(missing_ok=True)
 protected=list((pkg/group/'models').glob('*.glb'))+list((pkg/group/'prototypes').rglob('*'));protected=[f for f in protected if f.is_file()];before={f:sha(f) for f in protected}
 run('node',src/'export-models.mjs',*cli)
 if group=='comfort-props':run('node',src/'export-variants.mjs',*cli)
 for model in (pkg/group/'models').glob('*.glb'):
  rebuilt=cache/'model-rebuild'/group/'models'/model.name
  assert sha(model)==sha(rebuilt),f'Factory/GLB mismatch: {model}'
 run('node',src/'export-mounts.mjs',*cli)
 run('blender','-b','-t','2','--python',src/'audit-mounts.py','--','--cache-root',cache)
 reports=[out/'mount-audit.json']
 if group=='comfort-props':
  run('node',src/'export-variant-mounts.mjs',*cli)
  run('blender','-b','-t','2','--python',src/'audit-variants.py','--','--cache-root',cache)
  reports.append(out/'variant-mount-audit.json')
 if group=='play-props':
  run('node',src/'export-shared.mjs',*cli)
  run('blender','-b','-t','2','--python',src/'audit-repeated.py','--','--cache-root',cache)
  run(sys.executable,src/'audit-stage.py','--cache-root',cache)
 assert before=={f:sha(f) for f in protected},'Protected model/prototype changed'
 inputs=[ref/'fixture-source-manifest.json',pkg/'shared/check-prop-groups.py',pkg/'shared/verify-prop-evidence.py',pkg/'shared/paths.mjs',cache/'accessory/review/halo-static.json',pkg/group/'manifest.json',pkg/'accessory-expansion/src/test_and_export.mjs']+list(src.glob('*'))+protected+list((cache/'model-rebuild'/group/'models').glob('*.glb'))+list(out.glob('*.json'))
 inputs=[f for f in inputs if f.is_file() and f!=proof]
 proof.write_text(json.dumps({'schema':'bubu-current-prop-evidence/1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'group':group,'reports':[str(f) for f in reports],'referenceRoot':str(ref),'fixtureManifest':str(ref/'fixture-source-manifest.json'),'scope':'Fresh static geometry evidence only. Existing pending native, wardrobe, action and ground-hole contracts remain pending.','inputs':[{'path':str(f.resolve()),'sha256':sha(f)} for f in sorted(set(inputs))]},indent=2)+'\n')
 run(sys.executable,pkg/'shared/verify-prop-evidence.py','--proof',proof)
 for test in sorted(src.glob('test-*.mjs')):
  if test.name in ['test-static-mounts.mjs','test-variant-contracts.mjs','test-static-audits.mjs']:run('node',test,*cli)
  else:run('node','--test',test)
 print(group+': fresh audits, source-bound evidence, model byte parity and tests passed',flush=True)
