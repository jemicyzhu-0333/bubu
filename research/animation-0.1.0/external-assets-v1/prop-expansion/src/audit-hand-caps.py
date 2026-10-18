import json,array
from pathlib import Path
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
import argparse,sys
parser=argparse.ArgumentParser();parser.add_argument('--cache-root',type=Path,required=True);parser.add_argument('--reference-root',type=Path,required=True);args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);p=args.cache_root.resolve()/'prop-expansion';data=json.load(open(p/'reports/static-render-input.json'));binding=json.load(open(args.reference_root.resolve()/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/binding-manifest.json'));fits=json.load(open(p/'reports/static-fit.json'))['fits'];reports=[]
def raw(file):
 a=array.array('f');a.frombytes(Path(file).read_bytes());return a
frame=data['frames'][1];local=next(m for m in frame['meshes'] if m['name']=='Bubu_body');body={**data['sharedMeshes']['Bubu_body'],**local};v=raw(body['positionsFile']);tri=body['indices'];bvh=BVHTree.FromPolygons([v[i:i+3] for i in range(0,len(v),3)],[tri[i:i+3] for i in range(0,len(tri),3)],all_triangles=True)
for label,fit in [('after',next(f for f in fits if f['id']=='paper-board'))]:
 for hand,name in [('handL','Bubu_hand-left'),('handR','Bubu_hand-right')]:
  current=next(m for m in frame['meshes'] if m['name']==name);positions=raw(current['positionsFile']);newfit=next(f for f in fits if f['id']=='paper-board');untransform=Matrix([newfit['hands'][hand]['matrix'][i:i+4] for i in range(0,16,4)]).transposed().inverted();target=Matrix([fit['hands'][hand]['matrix'][i:i+4] for i in range(0,16,4)]).transposed();caps={i for i,source in enumerate(binding['sourceVertexIds'][name]) if source<0};indices=data['sharedMeshes'][name]['indices'];caps=caps|{v for j in range(0,len(indices),3) if any(v in caps for v in indices[j:j+3]) for v in indices[j:j+3]};outside=[];signed=[]
  for i in caps:
   q=target@untransform@Vector(positions[i*3:i*3+3]);near,n,_,dist=bvh.find_nearest(q);s=(q-near).dot(n);signed.append(s)
   if s>0:outside.append(i)
  reports.append({'revision':label,'hand':hand,'capVertices':len(caps),'verticesOutsideByNearestNormal':len(outside),'maxSignedDistance':max(signed),'minSignedDistance':min(signed),'scope':'Generated closure vertices plus adjacent original boundary ring, identified via sourceVertexIds < 0 and incident triangles. Nearest-normal signed distance, not just shoulder root.'})
json.dump({'results':reports},open(p/'reports/hand-cap-audit.json','w'),indent=2);print(json.dumps(reports,indent=2))
