"""Offline candidate only: sample the pinned approved cape authoring surface.
Run in Blender with --body-input from export-foot-inputs.py --all-parts.
The actor and approved render meshes are never modified.
"""
import argparse, ast, hashlib, json, math, sys, importlib.util
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--body-input',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--cols',type=int,default=64);p.add_argument('--rows',type=int,default=18);p.add_argument('--spacing',type=float,default=.08)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
research=Path(__file__).resolve().parents[3]
source=research/'wearable-approved-round5/shared/build-approved-wearables.py'
raw=source.read_bytes()
data=np.load(a.body_input)
hybrid=research/'original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'
hybrid_sha=hashlib.sha256(hybrid.read_bytes()).hexdigest()
assert hybrid_sha=='52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67'
spec=importlib.util.spec_from_file_location('verified_glb',hybrid.parent/'tools/split_glb.py')
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
glb=reader.GLB(hybrid);mesh=next(m for m in glb.doc['meshes'] if m.get('name')=='Bubu_body')
assert len(mesh['primitives'])==1
primitive=mesh['primitives'][0]
assert np.array_equal(data['POSITION'],glb.accessor(primitive['attributes']['POSITION']))
assert np.array_equal(data['triangles'],glb.accessor(primitive['indices']).reshape(-1,3))
vertices=[(float(x),float(-z),float(y)) for x,y,z in data['POSITION']]
body_bvh=BVHTree.FromPolygons(vertices,data['triangles'].tolist(),all_triangles=True)
# Reuse exactly these two approved pure geometry functions, without executing
# the builder's CLI or its model-export side effects. Never used at runtime.
tree=ast.parse(raw);functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('surface','cloth_point')]
assert {n.name for n in functions}=={'surface','cloth_point'}
namespace={'math':math,'Vector':Vector,'body_bvh':body_bvh}
exec(compile(ast.Module(body=functions,type_ignores=[]),str(source),'exec'),namespace)
cols,rows=a.cols,a.rows
assert 4<=cols<=64 and 3<=rows<=18 and (cols+1)*(rows+1)<=2048
positions=[];indices=[];pins=[];columns=[];triangle_columns=[];row_counts=[]
assert .03<=a.spacing<=.15
for i in range(cols+1):
 angle=-math.pi/2+.055+(2*math.pi-.11)*i/cols
 samples=[np.array(namespace['cloth_point'](angle,j/18)) for j in range(19)]
 length=sum(float(np.linalg.norm(samples[j+1]-samples[j])) for j in range(18))
 n=max(1,min(rows,math.ceil(length/a.spacing)))
 row_counts.append(n);column=[]
 for j in range(n+1):
  x,y,z=namespace['cloth_point'](angle,j/n)
  index=len(positions)//3;column.append(index);positions.extend((x,z,-y))
  if j==0:pins.append(index)
 columns.append(column)
for col in range(cols):
 left,right=columns[col],columns[col+1];i=j=0
 while i<len(left)-1 or j<len(right)-1:
  lt=(i+1)/(len(left)-1) if i<len(left)-1 else math.inf
  rt=(j+1)/(len(right)-1) if j<len(right)-1 else math.inf
  if rt<=lt:
   indices.extend((left[i],right[j],right[j+1]));triangle_columns.append(col);j+=1
  else:
   indices.extend((left[i],right[j],left[i+1]));triangle_columns.append(col);i+=1
points=np.asarray(positions).reshape(-1,3);tri=points[np.asarray(indices).reshape(-1,3)]
area=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)/2
assert len(points)<=2048 and np.isfinite(points).all() and area.min()>1e-9
out={'schema':'bubu-cloth-surface/1','scope':'Candidate thin simulation surface, not garment/contact admission','coordinates':'approved source GLTF Y-up','sourceBuilderSHA256':hashlib.sha256(raw).hexdigest(),'sourceHybridSHA256':hybrid_sha,'bodyTrianglesSHA256':hashlib.sha256(data['triangles'].tobytes()).hexdigest(),'grid':{'cols':cols,'rowsPerColumn':row_counts,'targetSpacing':a.spacing},'triangleColumns':triangle_columns,'bodyPositionSHA256':hashlib.sha256(data['POSITION'].tobytes()).hexdigest(),'positions':positions,'indices':indices,'pins':pins,'minimumTriangleArea':float(area.min())}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(out,separators=(',',':'))+'\n');print('candidate particles',len(points),'triangles',len(indices)//3,'minimum area',area.min())
