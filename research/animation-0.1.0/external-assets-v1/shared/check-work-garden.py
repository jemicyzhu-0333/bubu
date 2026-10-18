#!/usr/bin/env python3
"""Rebuild fixed final candidates in explicit cache, audit fresh geometry, bind all evidence."""
import argparse,pathlib,json,hashlib,subprocess,datetime
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,type=pathlib.Path,required=True)
p.add_argument('--group',choices=['work-props','garden-props'],required=True)
a=p.parse_args();pkg=pathlib.Path(__file__).resolve().parents[1];cache=a.cache_root.resolve();ref=a.reference_root.resolve();group=pkg/a.group;out=cache/a.group;out.mkdir(parents=True,exist_ok=True);proof=out/'reports/current-evidence.json';proof.unlink(missing_ok=True)
args=['--repo-root',str(a.repo_root.resolve()),'--reference-root',str(ref),'--cache-root',str(cache)]
def run(script,blender=False):subprocess.run((['blender','-b','-t','2','--python',str(group/'src'/script),'--'] if blender else ['node',str(group/'src'/script)])+args,check=True)
run('export-models.mjs')
for model in (group/'models').glob('*.glb'):
 if model.name=='watering-can-fixed-stage-v2.glb':continue
 assert hashlib.sha256(model.read_bytes()).digest()==hashlib.sha256((out/'models'/model.name).read_bytes()).digest(),f'Factory/GLB mismatch: {model}'
run('test-models.mjs')
if a.group=='work-props':
 run('read-hands.mjs');run('export-static.mjs');run('audit-static.py',True);run('audit-hand-boundaries.py',True);run('test-static.mjs');report=out/'reports/static-geometry-audit.json'
else:
 run('export-mounts.mjs');run('repair-shaft-depth.mjs');run('repair-watering-can.mjs')
 assert (out/'models/watering-can-fixed-stage-v2.glb').read_bytes()==(group/'models/watering-can-fixed-stage-v2.glb').read_bytes(),'Final watering-can GLB changed'
 run('test-watering-can-v2.mjs');run('test-static-body-intersection.mjs');run('audit-final-mounts.py',True);report=out/'reports/current-mount-audit.json'
inputs=[ref/'fixture-source-manifest.json',pkg/'shared/paths.mjs',pkg/'shared/work-garden-paths.mjs',pathlib.Path(__file__).resolve(),pkg/'shared/verify-work-garden.py',cache/'accessory/review/halo-static.json',ref/'research/animation-0.1.0/runtime-facepath05/fixtures/face-d2/asset.glb',ref/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb',ref/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/binding-manifest.json']+list((group/'src').glob('*'))+list((group/'models').glob('*.glb'))+[f for d in ['models','reports','review'] for f in (out/d).glob('*') if f.is_file() and f!=proof]
proof.write_text(json.dumps({'schema':'bubu-work-garden-current-evidence/1','group':a.group,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'report':str(report),'referenceRoot':str(ref),'fixtureManifest':str(ref/'fixture-source-manifest.json'),'scope':'static only; fixed historical fit inputs replayed without optimization; no final user/native acceptance','inputs':[{'path':str(f.resolve()),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in inputs]},indent=2)+'\n')
subprocess.run(['python',str(pkg/'shared/verify-work-garden.py'),'--proof',str(proof)],check=True)
