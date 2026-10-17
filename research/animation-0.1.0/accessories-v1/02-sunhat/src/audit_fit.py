"""Actual mini-hat mesh/head fit and exposed ears. No old full-head ellipsoid assumptions."""
import bpy,json,sys,argparse,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1];ap=argparse.ArgumentParser();ap.add_argument('--body',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=a.body)
body=bpy.data.objects['A_mochi_skin'];old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(P/'sunhat.glb'));hats=[o for o in bpy.data.objects if o not in old and o.type=='MESH']
for o in hats:o.location.z+=1.62766
bpy.context.view_layer.update()
def tree(objects):
 verts=[];polys=[]
 for o in objects:
  offset=len(verts);verts.extend([o.matrix_world@v.co for v in o.data.vertices]);polys.extend([[offset+i for i in f.vertices] for f in o.data.polygons])
 return BVHTree.FromPolygons(verts,polys)
skin=tree([body]);hat=tree(hats);hatParts={o.name:tree([o]) for o in hats};ear=[body.matrix_world@v.co for v in body.data.vertices if abs(v.co.x)>.30 and v.co.z>1.66];samples=[]
for angle in [0,-45,45,-90,90,-135,135,180]:
 for elev in [-6,0,6]:
  aa=math.radians(angle);ee=math.radians(elev);direction=Vector((math.sin(aa)*math.cos(ee),-math.cos(aa)*math.cos(ee),math.sin(ee)));visible=occluded=crest=crestOccluded=tip=tipOccluded=0;tipMeshes={}
  horizontal=Vector((math.cos(aa),math.sin(aa),0));vertical=horizontal.cross(direction).normalized();vertical=-vertical if vertical.z<0 else vertical
  bins={}
  for v in body.data.vertices:
   p=body.matrix_world@v.co;k=round(p.dot(horizontal)/.015);bins[k]=max(bins.get(k,-999),p.dot(vertical))
  for p in ear:
   if skin.ray_cast(p+direction*1e-4,direction,5)[0] is not None:continue
   visible+=1
   blocked=hat.ray_cast(p+direction*1e-4,direction,5)[0] is not None
   if blocked:occluded+=1
   if p.z>1.76:
    tip+=1
    if blocked:
     tipOccluded+=1
     for name,part in hatParts.items():
      if part.ray_cast(p+direction*1e-4,direction,5)[0] is not None:tipMeshes[name]=tipMeshes.get(name,0)+1
   if p.dot(vertical)>=bins[round(p.dot(horizontal)/.015)]-.006:
    crest+=1
    if blocked:crestOccluded+=1
  samples.append({'yaw':angle,'elevation':elev,'bodyVisibleEarVertices':visible,'hatOccludedEarVertices':occluded,'visibleTipVertices':tip,'occludedTipVertices':tipOccluded,'tipOccluders':tipMeshes,'visibleEarCrestVertices':crest,'hatOccludedEarCrestVertices':crestOccluded})
penetrations=[];minimum=999;maxSignedDepth=0
for o in hats:
 for v in o.data.vertices:
  p=o.matrix_world@v.co;q,n,f,d=skin.find_nearest(p);minimum=min(minimum,d);maxSignedDepth=max(maxSignedDepth,-(p-q).dot(n))
  if (p-q).dot(n)<-.002:penetrations.append({'mesh':o.name,'depth':-(p-q).dot(n),'point':list(p)})
headInside=[]
for v in body.data.vertices:
 p=body.matrix_world@v.co
 if p.z<1.60 or abs(p.x)>.40 or abs(p.y)>.40:continue
 for name,part in hatParts.items():
  q,n,f,d=part.find_nearest(p)
  if d<=.002:continue
  direction=Vector((.932,.271,.241)).normalized();origin=p.copy();hits=0
  for _ in range(32):
   hit=part.ray_cast(origin,direction,5)[0]
   if hit is None:break
   hits+=1;origin=hit+direction*1e-5
  if hits%2:headInside.append({'vertex':v.index,'mesh':name,'depth':d})
result={'headVerticesInsideHatMaterialBeyondTolerance':len(headInside),'headInsideExamples':headInside[:8],'earRegion' :'abs(x)>.30 and z>1.66 on unchanged D2 skin; body-hidden vertices excluded','earVertexCount':len(ear),'samples':samples,'hatVerticesInsideSkinBeyond2mm':len(penetrations),'maximumPenetrationBeyondTolerance':max((v['depth'] for v in penetrations),default=0),'maximumSignedDepthIncludingContact':maxSignedDepth,'contactTolerance':.002,'examples':penetrations[:8],'minimumHatSkinDistance':minimum,'contourDefinition':'Upper body silhouette sampled at .015 horizontal bins, within .006 vertical tolerance; only unchanged ear-region vertices and body-visible points. Full inner-ear surface occlusion is reported separately, not equated to silhouette loss.', 'scope':'Actual final GLB against undeformed approved head; 24 ear view/elevation samples, discrete ray visibility, signed nearest mesh fit. Body/head is rigid under bounded adapter; no full-head enclosure.'}
(P/'review/fit-audit.json').write_text(json.dumps(result,indent=2));print(result);assert not penetrations;assert not headInside;assert not any(x['occludedTipVertices'] for x in samples if x['yaw'] in [0,-45,45,-135,135,180] and x['elevation']==0)
