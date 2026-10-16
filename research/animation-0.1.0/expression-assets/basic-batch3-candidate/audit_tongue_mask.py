import bpy,sys,json,hashlib,math,os,numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from scipy.spatial import ConvexHull
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=os.environ.get('SOURCE_BLEND',str(P/'bubu-a05-basic-batch3.blend')));body=BVHTree.FromObject(bpy.data.objects['A_mochi_skin'],bpy.context.evaluated_depsgraph_get());tongue=bpy.data.objects['A_tongue'];mouth=bpy.data.objects['A_mouth_ring'];r={'assetSHA256':hashlib.sha256(Path(os.environ.get('ASSET_GLB',str(P/'bubu-a05-basic-batch3.glb'))).read_bytes()).hexdigest(),'samples':{},'scope':'Actual evaluated tongue vertices AND triangle centres; projection inside actual black-mouth mesh, finite black border, body/mouth depth, and view-dependent behind-skin occlusion. This is not a deep anatomical oral cavity.'}
for i in range(65):
 t=i/64;apply_basic('N3',t);dep=bpy.context.evaluated_depsgraph_get();te=tongue.evaluated_get(dep);tm=te.to_mesh();tm.calc_loop_triangles();area=sum(tri.area for tri in tm.loop_triangles);row={'surfaceArea':area,'visible':area>1e-12}
 if area>1e-12:
  points=[v.co.copy() for v in tm.vertices]+[sum((tm.vertices[j].co for j in tri.vertices),Vector())/3 for tri in tm.loop_triangles];mb=BVHTree.FromObject(mouth,dep);tb=BVHTree.FromObject(tongue,dep);me=mouth.evaluated_get(dep);mm=me.to_mesh();vv=np.array([[v.co.x,v.co.z] for v in mm.vertices]);hull=ConvexHull(vv);poly=vv[hull.vertices];a=poly;b=np.roll(poly,-1,axis=0);edge=b-a;l2=np.sum(edge*edge,axis=1);margins=[];depth=[];missing=0;bodygap=[];badInside=0
  for p in points:
   pp=np.array([p.x,p.z]);ab=pp-a;tt=np.clip(np.sum(ab*edge,axis=1)/l2,0,1);dist=np.sqrt(np.sum((ab-edge*tt[:,None])**2,axis=1));margins.append(float(dist.min()));badInside+=bool(np.any(hull.equations[:,:2]@pp+hull.equations[:,2]>1e-7));hit=mb.ray_cast(Vector((p.x,-3,p.z)),Vector((0,1,0)),6)[0];missing+=hit is None
   if hit is not None:depth.append(hit.y-p.y)
   hitbody=body.ray_cast(Vector((p.x,-3,p.z)),Vector((0,1,0)),6)[0];bodygap.append(hitbody.y-p.y)
  row.update({'sampleCount':len(points),'outsideOuterContour':badInside,'missingBlackSurface':missing,'minimumBlackBorder':min(margins),'minimumMouthBehindTongueDepth':min(depth),'maximumMouthBehindTongueDepth':max(depth),'minimumBodyClearance':min(bodygap),'views':{}})
  # Orthographic cameras use a constant ray direction. A tongue sample is
  # relevant only when not occluded by body or black mouth in that direction.
  for name,yaw in [('front',0),('quarter',-52),('opposite',52),('side',-85)]:
   aa=math.radians(yaw);direction=Vector((-math.sin(aa),math.cos(aa),0));visible=0;outsideMask=0;occluded=0;selfoccluded=0;selfMiss=0
   for p in points:
    origin=p-direction*3;hb=body.ray_cast(origin,direction,6);hm=mb.ray_cast(origin,direction,6)
    if hb[0] is not None and hb[3]<3-1e-5 or hm[0] is not None and hm[3]<3-1e-5:occluded+=1;continue
    ht=tb.ray_cast(origin,direction,6)
    if ht[0] is not None and ht[3]<3-1e-5:selfoccluded+=1;continue
    if ht[0] is None:selfMiss+=1;continue
    visible+=1
    if hm[0] is None:outsideMask+=1
   row['views'][name]={'actualFirstHitVisibleSamples':visible,'selfOccludedSamples':selfoccluded,'boundaryRayMissSamples':selfMiss,'bodyOrMouthOccludedSamples':occluded,'visibleWithoutBlackMouthBehind':outsideMask}
  me.to_mesh_clear()
 te.to_mesh_clear();r['samples'][str(t)]=row
r['tongueZeroThroughHalf']=all(not row['visible'] for t,row in r['samples'].items() if float(t)<=.5)
r['pass']=r['tongueZeroThroughHalf'] and all((not row['visible']) or (row['outsideOuterContour']==0 and row['missingBlackSurface']==0 and row['minimumBlackBorder']>.001 and row['minimumMouthBehindTongueDepth']>=-1e-6 and row['minimumBodyClearance']>0 and all(v['visibleWithoutBlackMouthBehind']==0 for v in row['views'].values())) for row in r['samples'].values())
(P/os.environ.get('AUDIT_OUT','tongue-mask-audit.json')).write_text(json.dumps(r,indent=2));print('TONGUE_MASK',r['pass'],flush=True)
