import bpy,sys,json,hashlib,math
from pathlib import Path
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=str(P/'_restored/bubu-a05-basic-batch1.blend'));o=bpy.data.objects['A_mouth_ring'];inner=[v.index for v in o.data.vertices if abs(math.hypot(v.co.x,v.co.z-.695)-.026)<1e-5];assert inner
r={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch1.glb').read_bytes()).hexdigest(),'innerBoundaryVertexCount':len(inner),'samples':{}}
for state in ['N2','P2']:
 for i in range(33):
  t=.5+i/64;apply_basic(state,t);e=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();a=m.vertices[inner[0]].co.copy();spread=max((m.vertices[i].co-a).length for i in inner);r['samples'][f'{state}-{t:.6f}']={'maxInnerBoundaryMaterialPointSpread3D':spread};e.to_mesh_clear()
r['float32Tolerance']=2e-7;r['passed']=all(v['maxInnerBoundaryMaterialPointSpread3D']<2e-7 for v in r['samples'].values());(P/'mouth-collapse-audit.json').write_text(json.dumps(r,indent=2));print('MOUTH_COLLAPSE',r['passed'],len(inner),max(v['maxInnerBoundaryMaterialPointSpread3D'] for v in r['samples'].values()))
