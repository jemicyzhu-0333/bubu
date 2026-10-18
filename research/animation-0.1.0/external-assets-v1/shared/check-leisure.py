#!/usr/bin/env python3
"""Generate actual mounted meshes, recompute triangle audit, bind inputs, then assert."""
import argparse,pathlib,json,hashlib,subprocess,datetime,shutil
p=argparse.ArgumentParser();
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,type=pathlib.Path,required=True)
a=p.parse_args();pkg=pathlib.Path(__file__).resolve().parents[1];cache=a.cache_root.resolve();ref=a.reference_root.resolve();repo=a.repo_root.resolve();group=pkg/'leisure-props';report=cache/'leisure-props/reports/mount-audit.json';proof=report.with_name('current-evidence.json')
proof.unlink(missing_ok=True)
rebuild=cache/'leisure-model-rebuild';(rebuild/'src').mkdir(parents=True,exist_ok=True);(rebuild/'models').mkdir(exist_ok=True)
for name in ['prop-models.mjs','export-models.mjs']:shutil.copy2(group/'src'/name,rebuild/'src'/name)
subprocess.run(['node',str(rebuild/'src/export-models.mjs')],check=True)
for model in (group/'models').glob('*.glb'):
 assert hashlib.sha256(model.read_bytes()).digest()==hashlib.sha256((rebuild/'models'/model.name).read_bytes()).digest(),f'Factory/GLB mismatch: {model}'

subprocess.run(['node',str(group/'src/export-mounts.mjs'),'--repo-root',str(repo),'--reference-root',str(ref),'--cache-root',str(cache)],check=True)
subprocess.run(['blender','-b','-t','2','--python',str(group/'src/audit-mounts.py'),'--','--cache-root',str(cache)],check=True)
inputs=[ref/'fixture-source-manifest.json',pkg/'shared/check-leisure.py',pkg/'shared/verify-evidence.py',pkg/'shared/paths.mjs',group/'src/export-models.mjs',group/'src/export-mounts.mjs',group/'src/prop-models.mjs',group/'src/audit-mounts.py',cache/'accessory/review/halo-static.json',report,cache/'leisure-props/reports/mount-contracts.json',ref/'research/animation-0.1.0/runtime-facepath05/fixtures/face-d2/asset.glb',ref/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb',ref/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/binding-manifest.json',pkg/'accessory-expansion/src/test_and_export.mjs']+list((group/'models').glob('*.glb'))+list(report.parent.glob('*-mounted.json'))
proof.write_text(json.dumps({'schema':'bubu-current-mount-evidence/1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'report':str(report),'referenceRoot':str(ref),'fixtureManifest':str(ref/'fixture-source-manifest.json'),'coordinates':'actual exported source actor world space; constants bound by exporter hash','scope':'static only; no final user or native runtime acceptance','inputs':[{'path':str(f.resolve()),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in inputs]},indent=2)+'\n')
subprocess.run(['python',str(pkg/'shared/verify-evidence.py'),'--proof',str(proof)],check=True)
