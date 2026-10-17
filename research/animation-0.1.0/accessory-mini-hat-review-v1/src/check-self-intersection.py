import bpy,bmesh,json,itertools
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
P=Path(__file__).resolve().parents[1]/'work';P.mkdir(exist_ok=True);R=P.parent.parent;bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(R/'accessories-v1/02-sunhat/sunhat.glb'));report=[]
def hit(vs,a,b):
 aa=[vs[k]for k in a];bb=[vs[k]for k in b]
 for t,o in [(aa,bb),(bb,aa)]:
  for i in range(3):
   p=t[i];d=t[(i+1)%3]-p;length=d.length
   if length<1e-9:continue
   q=intersect_ray_tri(*o,d.normalized(),p,True)
   if q is not None and 1e-6<(q-p).dot(d.normalized())<length-1e-6:return True
 return False
for o in bpy.data.objects:
 if o.type!='MESH':continue
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table();vs=[v.co.copy()for v in bm.verts];faces=[[v.index for v in f.verts]for f in bm.faces];tree=BVHTree.FromPolygons(vs,faces,all_triangles=True);pairs=set(tuple(sorted(p))for p in tree.overlap(tree)if p[0]!=p[1]);tested=0;bad=[]
 for a,b in pairs:
  if set(faces[a])&set(faces[b]):continue
  tested+=1
  if hit(vs,faces[a],faces[b]):bad.append([a,b])
 report.append({'mesh':o.name,'nonAdjacentBVHCandidates':tested,'strictInteriorSegmentTriangleHits':len(bad),'examples':bad[:10]});bm.free()
(P/'mini-hat-self-intersection.json').write_text(json.dumps(report,indent=2));print(report);assert not any(r['strictInteriorSegmentTriangleHits']for r in report)
