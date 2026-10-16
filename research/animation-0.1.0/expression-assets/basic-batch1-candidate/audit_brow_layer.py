import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).parent;BASE=P;sys.path[:0]=[str(P),str(BASE)];from basic_face_utils import apply_basic;from selected_face_utils import apply_selected
bpy.ops.wm.open_mainfile(filepath=str(P/'_restored/bubu-a05-basic-batch1.blend'));names=['A_brow_L','A_brow_R'];result={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch1.glb').read_bytes()).hexdigest(),'historyStates':{},'newStates':{},'browLayer':{}}
def areas():
 dep=bpy.context.evaluated_depsgraph_get();r={}
 for n in names:
  o=bpy.data.objects[n].evaluated_get(dep);m=o.to_mesh();m.calc_loop_triangles();r[n]=sum(t.area for t in m.loop_triangles);o.to_mesh_clear()
 return r
for st in ['01','04','05','07','08']:
 for t in [0,.25,.5,.75,1]:apply_basic('N2',1);apply_selected(st,t);result['historyStates'][f'{st}-{t}']=areas()
for st in ['D1','P2']:
 for t in [0,.25,.5,.75,1]:apply_basic('N2',1);apply_basic(st,t);result['newStates'][f'{st}-{t}']=areas()
apply_basic('N2',1)
for n in names:
 o=bpy.data.objects[n];v=np.array([p.co[:] for p in o.data.shape_keys.key_blocks['BasicN2_08'].data]);groups=[[(o.vertex_groups[g.group].name,g.weight) for g in v.groups] for v in o.data.vertices];result['browLayer'][n]={'xyzMin':v.min(axis=0).tolist(),'xyzMax':v.max(axis=0).tolist(),'BodyWeight100Percent':all(g==[('Body',1.)] for g in groups),'parent':o.parent.name,'modifierRig':o.modifiers[0].object.name,'BasisCollapsedToOnePoint':all(tuple(x.co)==tuple(o.data.vertices[0].co) for x in o.data.vertices)}
result['allNonN2BrowsZeroArea']=all(a==0 for k in ['historyStates','newStates'] for r in result[k].values() for a in r.values());assert result['allNonN2BrowsZeroArea'];(P/'brow-layer-audit.json').write_text(json.dumps(result,indent=2));print('BROW_LAYER',result['allNonN2BrowsZeroArea'])
