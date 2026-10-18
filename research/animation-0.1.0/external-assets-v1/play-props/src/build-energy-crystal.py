import bpy,json
from pathlib import Path
r=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
# Irregular elongated crystal, not a token/coin. All edges receive a physical soft bevel.
rim=[(-.105,.12,0),(-.09,.30,0),(0,.43,0),(.105,.31,0),(.12,.15,0),(.01,0,0)]
verts=rim+[(.005,.235,.10),(-.005,.20,-.08)]
faces=[]
for i in range(6):j=(i+1)%6;faces.extend([(i,j,6),(j,i,7)])
me=bpy.data.meshes.new('Energy_crystal');me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new('Energy_crystal',me);bpy.context.collection.objects.link(ob);bpy.context.view_layer.objects.active=ob;ob.select_set(True)
for name in ['gold','pale_gold','amber','sunlight']:me.materials.append(bpy.data.materials.new(name))
for i,p in enumerate(me.polygons):p.material_index=[0,2,1,0,0,1,1,0,2,2,0,3][i]
# Recalculate outward orientation and soften corners without increasing object size.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
mod=ob.modifiers.new('Soft_physical_bevel','BEVEL');mod.width=.008;mod.segments=3;mod.affect='EDGES';bpy.ops.object.modifier_apply(modifier=mod.name)
me.calc_loop_triangles();parts=[]
for material in range(4):
 pos=[];normals=[]
 for tri in me.loop_triangles:
  if me.polygons[tri.polygon_index].material_index!=material:continue
  for vi in tri.vertices:pos.extend(me.vertices[vi].co);normals.extend(tri.normal)
 parts.append({'positions':pos,'normals':normals})
(r/'src/energy-crystal-data.mjs').write_text('export const crystalParts='+json.dumps(parts,separators=(',',':'))+';\n')
print('CRYSTAL_TRIANGLES',sum(len(p['positions'])//9 for p in parts))
