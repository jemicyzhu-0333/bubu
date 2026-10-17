import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;sys.path.insert(0,str(P));from compose_gold import GROUPS,STATE_ORDER,FACE
ROOT=P.parent;data={};base={};source_meta={}
for key,(glb,states,prefix) in GROUPS.items():
 blend=glb.with_suffix('.blend');bpy.ops.wm.open_mainfile(filepath=str(blend));source_meta[key]={'file':str(blend),'sha256':hashlib.sha256(blend.read_bytes()).hexdigest()}
 for name in FACE:
  o=bpy.data.objects.get(name)
  if o is None:continue
  b=np.empty(len(o.data.vertices)*3,dtype=np.float32);o.data.shape_keys.key_blocks['Basis'].data.foreach_get('co',b);b=b.reshape(-1,3)
  if name in base:assert np.array_equal(base[name],b),(key,name,'Basis mismatch')
  else:base[name]=b
  for state in states:
   for k in range(1,9):
    n=f'{prefix}{state}_{k:02}';shape=o.data.shape_keys.key_blocks.get(n)
    if shape is None:continue
    a=np.empty(b.size,dtype=np.float32);shape.data.foreach_get('co',a);data[(state,name,k)]=a.reshape(-1,3)
source=GROUPS['batch3'][0].with_suffix('.blend');look=source.with_name(source.stem+'-look.blend');stats={}
for label,path in [('source',source),('look',look)]:
 bpy.ops.wm.open_mainfile(filepath=str(path));checks={}
 for name in FACE:
  o=bpy.data.objects[name];b=np.empty(len(o.data.vertices)*3,dtype=np.float32);o.data.shape_keys.key_blocks['Basis'].data.foreach_get('co',b);assert np.array_equal(b.reshape(-1,3),base[name]);
  for shape in list(o.data.shape_keys.key_blocks)[::-1]:
   if shape.name!='Basis':o.shape_key_remove(shape)
  checks[name]={'basisVertices':len(o.data.vertices),'targets':0,'explicitZeroFill':[]}
  for state in STATE_ORDER:
   prefix='Face' if state in ['01','04','07','08'] else'Basic'
   for k in range(1,9):
    n=f'{prefix}{state}_{k:02}';shape=o.shape_key_add(name=n);a=data.get((state,name,k),base[name]);shape.data.foreach_set('co',a.ravel());shape.value=0;checks[name]['targets']+=1
    if (state,name,k) not in data:checks[name]['explicitZeroFill'].append(n)
  o.data.update()
 root=bpy.data.objects['A_reference_root'];root['library_status']='18-slot static expressions accepted by user2026-10-17; runtime separately gated';root['gaze_status']='not implemented';bpy.context.view_layer.update()
 out=P/('bubu-expression-library-v1.blend' if label=='source' else'bubu-expression-library-v1-look.blend');bpy.ops.wm.save_as_mainfile(filepath=str(out));stats[label]={'file':out.name,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'checks':checks}
(P/'AUTHORING-MERGE-AUDIT.json').write_text(json.dumps({'sources':source_meta,'outputs':stats,'allSourceShapeCoordinatesExact':True,'allSharedBasisExact':True,'zeroFillOnlyForMissingLayers':True},indent=2));print('AUTHORING_MERGE_EXACT')
