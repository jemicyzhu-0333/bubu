import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).parent;BASE=P.parent/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review';sys.path[:0]=[str(P),str(BASE)];from basic_face_utils import apply_basic;from selected_face_utils import apply_selected
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-a05-basic-batch4.blend'));names=['A_brow_L','A_brow_R'];r={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch4.glb').read_bytes()).hexdigest(),'historyStates':{},'newStates':{},'layers':{}}
def areas():
 dep=bpy.context.evaluated_depsgraph_get();out={}
 for n in names:
  o=bpy.data.objects[n].evaluated_get(dep);m=o.to_mesh();m.calc_loop_triangles();out[n]=sum(t.area for t in m.loop_triangles);o.to_mesh_clear()
 return out
for st in ['01','04','05','07','08']:
 for t in [0,.25,.5,.75,1]:apply_basic('A4',1);apply_selected(st,t);r['historyStates'][f'{st}-{t}']=areas()
for st in ['A8','D4']:
 for t in [0,.25,.5,.75,1]:apply_basic('A4',1);apply_basic(st,t);r['newStates'][f'{st}-{t}']=areas()
apply_basic('A4',1)
for n in names:
 o=bpy.data.objects[n];v=np.array([p.co[:] for p in o.data.shape_keys.key_blocks['BasicA4_08'].data]);groups=[[(o.vertex_groups[g.group].name,g.weight) for g in v.groups] for v in o.data.vertices];r['layers'][n]={'xyzMin':v.min(axis=0).tolist(),'xyzMax':v.max(axis=0).tolist(),'vertexCount':len(o.data.vertices),'BodyWeight100Percent':all(g==[('Body',1.)] for g in groups),'parent':o.parent.name,'modifierRig':o.modifiers[0].object.name,'BasisCollapsedToOnePoint':all(tuple(x.co)==tuple(o.data.vertices[0].co) for x in o.data.vertices)}
r['allOutsideA4HiddenZeroArea']=all(a==0 for k in ['historyStates','newStates'] for row in r[k].values() for a in row.values());assert r['allOutsideA4HiddenZeroArea'];(P/'new-layer-audit.json').write_text(json.dumps(r,indent=2));print('NEW_LAYERS',r['allOutsideA4HiddenZeroArea'])
