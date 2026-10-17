import bpy,bmesh,json
from pathlib import Path
P=Path(__file__).resolve().parents[1];bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(P/'satchel.glb'));report=[]
for o in bpy.data.objects:
 if o.type!='MESH':continue
 bm=bmesh.new();bm.from_mesh(o.data);raw=len(bm.verts);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
 report.append({'name':o.name,'rawGLTFVertices':raw,'auditWeldTolerance':1e-6,'vertices':len(bm.verts),'faces':len(bm.faces),'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'degenerateFaces':sum(f.calc_area()<1e-12 for f in bm.faces)})
 bm.free()
(P/'review/mesh-audit.json').write_text(json.dumps(report,indent=2));print(report)
assert all(not r['boundaryEdges'] and not r['nonManifoldEdges'] and not r['degenerateFaces'] for r in report)
