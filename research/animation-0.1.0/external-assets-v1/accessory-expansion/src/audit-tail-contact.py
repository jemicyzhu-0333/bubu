import importlib.util,json
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('tri',root/'shared/tea/triangle-collision.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
for folder,group,kinds in [('accessory-expansion','accessory',['cape']),('themed-accessories','themed-accessories',['fin','plum'])]:
 result={}
 for kind in kinds:
  d=json.loads((root/'.cache/weight'/group/'review'/f'{kind}-with-tail.json').read_text());meshes=d['frames'][0]['meshes'];tail=next(m for m in meshes if m['name']=='Bubu_round-tail');v=np.array(tail['positions']).reshape(-1,3);f=np.array(tail['indices']).reshape(-1,3);tri=mod.Triangles(v,f);pairs={}
  for m in meshes:
   if not m['name'].startswith(kind+'_'):continue
   mv=np.array(m['positions']).reshape(-1,3);mf=np.array(m['indices']).reshape(-1,3);pairs[m['name']]=len(tri.intersections(mv[mf]))
  result[kind]={'triangleEdgeIntersectionPairs':pairs,'allTestedClear':not any(pairs.values())}
 out=root/folder/'reports/weight-v2/tail-contact.json';out.write_text(json.dumps({'scope':'Static rest-pose triangle edge intersection test; not continuous dynamics, inside/outside containment proof or cloth simulation. Original body omitted because tail base is intentionally buried.','items':result},indent=2));print(folder,result)
