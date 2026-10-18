#!/usr/bin/env python3
"""Rebuild frozen factories; export actual meshes; audit; bind input hashes; assert."""
import argparse,pathlib,json,hashlib,subprocess,datetime,shutil
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,type=pathlib.Path,required=True)
a=p.parse_args();pkg=pathlib.Path(__file__).resolve().parents[1];g=pkg/'prop-expansion';cache=a.cache_root.resolve();ref=a.reference_root.resolve();report=cache/'prop-expansion/reports';proof=report/'current-evidence.json';proof.unlink(missing_ok=True)
cli=['--repo-root',str(a.repo_root.resolve()),'--reference-root',str(ref),'--cache-root',str(cache)]
run=lambda args:subprocess.run(args,check=True)
r=cache/'basic-model-rebuild';(r/'src').mkdir(parents=True,exist_ok=True);(r/'models').mkdir(exist_ok=True)
for n in ['prop-models.mjs','cup-model.mjs','export-models.mjs']:shutil.copy2(g/'src'/n,r/'src'/n)
run(['node',str(r/'src/export-models.mjs')])
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
for f in (g/'models').glob('*.glb'):assert sha(f)==sha(r/'models'/f.name),f'Factory mismatch: {f}'
run(['node',str(g/'src/build-static-fit.mjs'),*cli]);run(['python',str(g/'src/prepare-static-render.py'),'--cache-root',str(cache)])
for n in ['audit-static-fit.py','audit-hand-caps.py']:
 args=['blender','-b','-t','2','--python',str(g/'src'/n),'--','--cache-root',str(cache)]
 if n=='audit-hand-caps.py':args+=['--reference-root',str(ref)]
 run(args)
run(['node',str(g/'src/test-static-contract.mjs'),*cli])
inputs=[ref/'fixture-source-manifest.json',pkg/'shared/paths.mjs',pathlib.Path(__file__),pkg/'shared/verify-basic-props.py',g/'mount-profiles.json']+list((g/'models').glob('*.glb'))+list((g/'src').glob('*'))+list((cache/'hybrid-inputs').glob('*.npz'))+list(report.glob('*.json'))+list((report/'static-binary').rglob('*.bin'))+list((cache/'tea').rglob('*.json'))+list((cache/'tea').rglob('*.bin'))
inputs=[f for f in inputs if f.is_file() and f!=proof]
proof.write_text(json.dumps({'schema':'bubu-basic-prop-evidence/1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'referenceRoot':str(ref),'fixtureManifest':str(ref/'fixture-source-manifest.json'),'report':str(report/'static-fit-audit.json'),'scope':'static contacts only; right-hand cap boundary has 19 outside points, max signed 0.01350694; no new motion/native acceptance','inputs':[{'path':str(f.resolve()),'sha256':sha(f)} for f in sorted(set(inputs))]},indent=2)+'\n')
run(['python',str(pkg/'shared/verify-basic-props.py'),'--proof',str(proof)])
