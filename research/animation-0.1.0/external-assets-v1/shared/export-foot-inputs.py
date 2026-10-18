#!/usr/bin/env python3
"""Extract exact foot accessor bytes from the verified committed hybrid; no reconstruction."""
import argparse,pathlib,hashlib,importlib.util,numpy as np
p=argparse.ArgumentParser();p.add_argument('--repo-root',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--all-parts',action='store_true');a=p.parse_args();g=a.repo_root/'research/animation-0.1.0/original-parts-hybrid-v1/geometry';asset=g/'bubu-hybrid-binding.glb';assert hashlib.sha256(asset.read_bytes()).hexdigest()=='52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67'
spec=importlib.util.spec_from_file_location('source_glb',g/'tools/split_glb.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);glb=m.GLB(asset);a.out.mkdir(parents=True,exist_ok=True)
for name in (['Bubu_body','Bubu_hand-left','Bubu_hand-right','Bubu_foot-left','Bubu_foot-right'] if a.all_parts else ['Bubu_foot-left','Bubu_foot-right']):
 mesh=next(x for x in glb.doc['meshes'] if x.get('name')==name);assert len(mesh['primitives'])==1;pr=mesh['primitives'][0];attrs={k:glb.accessor(v) for k,v in pr['attributes'].items()};tri=glb.accessor(pr['indices']).reshape(-1,3);np.savez_compressed(a.out/(name+'.npz'),**attrs,triangles=tri)
print('Extracted exact verified hybrid accessor inputs')
