import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-a05-basic-batch4.blend'));result={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch4.glb').read_bytes()).hexdigest(),'samples':{},'scope':'A4 visible brow/eye boundary gap in locked chart and projected cross-occlusion in front; threshold .5 to .625 sampled densely. Wholebody/quarter visual review separate.'}
for i in range(129):
 t=i/128;apply_basic('A4',t);dep=bpy.context.evaluated_depsgraph_get();row={}
 for side in ['L','R']:
  brow=bpy.data.objects['A_brow_'+side];eye=bpy.data.objects['A_eye_'+side];ev=brow.evaluated_get(dep);me=ev.to_mesh();me.calc_loop_triangles();area=sum(tr.area for tr in me.loop_triangles)
  if area<1e-12:row[side]={'visible':False,'area':area};ev.to_mesh_clear();continue
  ebvh=BVHTree.FromObject(eye,dep);ee=eye.evaluated_get(dep);em=ee.to_mesh();bz=min(v.co.z for v in me.vertices);ez=max(v.co.z for v in em.vertices);overlap=0
  for v in me.vertices:
   h=ebvh.ray_cast(Vector((v.co.x,-3,v.co.z)),Vector((0,1,0)),6)[0];overlap+=h is not None
  row[side]={'visible':True,'area':area,'globalVerticalSkinGap':bz-ez,'frontBrowVerticesOverEye':overlap};ee.to_mesh_clear();ev.to_mesh_clear()
 result['samples'][str(t)]=row
result['minimumVisibleGap']=min(r['globalVerticalSkinGap'] for row in result['samples'].values() for r in row.values() if r['visible']);result['passed']=result['minimumVisibleGap']>.015 and all(r.get('frontBrowVerticesOverEye',0)==0 for row in result['samples'].values() for r in row.values());(P/'brow-eye-gap-audit.json').write_text(json.dumps(result,indent=2));print('BROW_EYE_GAP',result['passed'],result['minimumVisibleGap'])
