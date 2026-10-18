#!/usr/bin/env python3
"""Prepare an isolated read-only-source fixture overlay; never write into repo/reference roots."""
import argparse,pathlib,shutil,subprocess,hashlib,json
p=argparse.ArgumentParser();p.add_argument('--repo-root',type=pathlib.Path,required=True);p.add_argument('--reference-root',type=pathlib.Path,required=True);p.add_argument('--cache-root',type=pathlib.Path,required=True);p.add_argument('--node-modules-root',type=pathlib.Path,required=True);a=p.parse_args()
repo=a.repo_root.resolve();ref=a.reference_root.resolve();cache=a.cache_root.resolve();research=repo/'research/animation-0.1.0';out=cache/'research/animation-0.1.0'
if cache==repo or repo in cache.parents or cache==ref or ref in cache.parents:raise ValueError('Cache must be outside supplied source roots')
if out.exists():raise ValueError('Use a fresh cache root to avoid stale input acceptance')
deps=a.node_modules_root.resolve();assert json.load(open(deps/'three/package.json'))['version']=='0.186.1'
cache.mkdir(parents=True,exist_ok=True);(cache/'node_modules').symlink_to(deps,target_is_directory=True)
# Copy source code, configuration and small immutable fixture inputs; exclude large review frames.
source_files=[]
for f in research.rglob('*'):
 if not f.is_file() or 'node_modules' in f.parts:continue
 if f.suffix not in ['.mjs','.js','.json','.py','.txt','.glsl'] or f.stat().st_size>2_000_000:continue
 target=out/f.relative_to(research);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target);source_files.append({"path":str(target.relative_to(cache)),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()})
pkg='original-parts-hybrid-v1';g=research/pkg/'geometry';target=out/pkg/'geometry';target.mkdir(parents=True,exist_ok=True);shutil.copy2(g/'bubu-hybrid-binding.glb',target/'bubu-hybrid-binding.glb')
variant='expression-library/d2-style-variant';archive=ref/'research/animation-0.1.0'/variant/'asset/bubu-full18-d2-static-blush.glb.gz';source=out/'runtime-facepath05/fixtures/face-d2/asset.glb'
subprocess.run(['python',str(research/variant/'recover_asset.py'),'--gzip',str(archive),'--out',str(source)],check=True)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(source)=='84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a'
assert sha(target/'bubu-hybrid-binding.glb')=='52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67'
(cache/'source-proof.json').write_text(json.dumps({'sourceSHA256':sha(source),'hybridSHA256':sha(target/'bubu-hybrid-binding.glb'),'scope':'single cached actor, unchanged bytes; no remote source download'},indent=2)+'\n')
(cache/'fixture-source-manifest.json').write_text(json.dumps({'schema':'bubu-fixture-source/1','files':source_files},indent=2)+'\n')
print(out)
