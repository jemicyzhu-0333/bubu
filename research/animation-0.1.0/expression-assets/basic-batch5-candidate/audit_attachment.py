import bpy,json,math,hashlib,sys,numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic as apply_selected,STATES
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-a05-basic-batch5.blend'));skin=bpy.data.objects['A_mochi_skin'];body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get());faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name.startswith('A_brow') or o.name in ['A_mouth_ring','A_tongue']];report={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch5.glb').read_bytes()).hexdigest(),'singleState':{},'directBlendDiagnostic':{}}
def inspect():
 bpy.context.view_layer.update();dep=bpy.context.evaluated_depsgraph_get();eyes={s:BVHTree.FromObject(bpy.data.objects['A_eye_'+s],dep) for s in ['L','R']};row={}
 for o in faces:
  ev=o.evaluated_get(dep);m=ev.to_mesh();m.calc_loop_triangles();area=sum(t.area for t in m.loop_triangles);samples=[v.co.copy() for v in m.vertices]+[sum((m.vertices[j].co for j in t.vertices),Vector())/3 for t in m.loop_triangles];bc=[];ec=[]
  for v in samples:
   hit=body.ray_cast(Vector((v.x,-3,v.z)),Vector((0,1,0)),6)[0];bc.append(-99 if hit is None else hit.y-v.y)
   if 'highlight' in o.name and area>1e-12:
    hit=eyes[o.name[-1]].ray_cast(Vector((v.x,-3,v.z)),Vector((0,1,0)),6)[0];ec.append(-99 if hit is None else hit.y-v.y)
  row[o.name]={'minimumBodyClearance':min(bc),'bodyPenetrations':sum(x< -1e-6 for x in bc),'minimumEyeClearance':min(ec) if ec else None,'eyePenetrationsOrMissing':sum(x< -1e-6 for x in ec),'surfaceArea':area,'finiteCoordinates':all(math.isfinite(c) for v in m.vertices for c in v.co),'strictHiddenBrowPoint':o.name.startswith('A_brow') and area==0.0 and all(tuple(v.co)==tuple(m.vertices[0].co) for v in m.vertices)};ev.to_mesh_clear()
 return row
samples=sorted(set([i/40 for i in range(41)]+[(i+.5)/8 for i in range(8)]));report['sampleIntensities']=samples
for st in STATES:
 for t in samples:
  apply_selected(st,t);r=inspect();report['singleState'][f'{st}-{t:.4f}']=r;bad=sum(v['bodyPenetrations']+v['eyePenetrationsOrMissing'] for v in r.values());print('SINGLE',st,t,'bad',bad,flush=True)
apply_selected('T5',0);report['basisExact']=all(all((v.co-k.co).length==0 for v,k in zip(o.data.vertices,o.data.shape_keys.key_blocks['Basis'].data)) for o in faces);report['bodyHasNoMorph']=skin.data.shape_keys is None;report['rawSingleStatePassed']=all(r['bodyPenetrations']==0 and r['eyePenetrationsOrMissing']==0 and r['finiteCoordinates'] for row in report['singleState'].values() for r in row.values());report['hiddenPointPolicy']='Only new brow geometry with every evaluated vertex exactly coincident and surface area exactly zero may move through skin before visibility. Raw penetration counts remain recorded. No visible/small-triangle exception.';report['singleStatePassed']=all((r['bodyPenetrations']==0 or r['strictHiddenBrowPoint']) and r['eyePenetrationsOrMissing']==0 and r['finiteCoordinates'] for row in report['singleState'].values() for r in row.values());report['directBlendPassed']=False;(P/'face-attachment-audit.json').write_text(json.dumps(report,indent=2));print('PASS',report['singleStatePassed'],report['directBlendPassed'],flush=True)
