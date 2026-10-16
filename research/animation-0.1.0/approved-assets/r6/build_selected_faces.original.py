import bpy,math,json,hashlib
from functools import lru_cache
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).parent;F=next(q/'bubu-3d-a-drag-readable-20261016/candidate-a05-rig-r4' for q in P.parents if (q/'bubu-3d-a-drag-readable-20261016/candidate-a05-rig-r4').is_dir())
bpy.ops.wm.open_mainfile(filepath=str(F/'bubu-a05-pivot-probe.blend'))
skin=bpy.data.objects['A_mochi_skin'];body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get());states=['01','04','05','07','08'];knots=[.125,.25,.375,.5,.625,.75,.875,1.];targets={};faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name=='A_mouth_ring']
def front(x,z):
 h,n,i,d=body.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6);assert h is not None,(x,z);return h.y

# Map the source disk into a rounded, filled stroke. The centre is inside
# the stroke kernel; the radial boundary is the union of round-ended segments.
STROKES={
 '04': ([(.100,0),(-.112,.088),(.100,0),(-.112,-.088)],.036,(.100,0)),
 '07': ([(.1375*s,.087*(1-s*s)-.025) for s in [(-1+2*i/32) for i in range(33)]],.042,(0,.062)),
 '08mouth': ([(.060*s,.685+.045*s*s) for s in [(-1+2*i/32) for i in range(33)]],.012,(0,.685))
}
def segment_distance(x,y,a,b):
 dx=b[0]-a[0];dy=b[1]-a[1];q=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
 return math.hypot(x-a[0]-q*dx,y-a[1]-q*dy)
@lru_cache(maxsize=100000)
def stroke_xy(shape,u,v):
 points,r,anchor=STROKES[shape];rho=min(1,math.hypot(u,v))
 if rho<1e-9:return anchor
 dx=u/math.hypot(u,v);dy=v/math.hypot(u,v);lo=0;hi=.5
 for _ in range(30):
  q=(lo+hi)/2;x=anchor[0]+q*dx;y=anchor[1]+q*dy
  inside=min(segment_distance(x,y,a,b) for a,b in zip(points[:-1],points[1:]))<=r
  if inside:lo=q
  else:hi=q
 return (anchor[0]+rho*lo*dx,anchor[1]+rho*lo*dy)

def ray_radius(dx,dz,anchor,inside):
 lo=0.;hi=.5
 for _ in range(32):
  r=(lo+hi)*.5
  if inside(anchor[0]+r*dx,anchor[1]+r*dz):lo=r
  else:hi=r
 return lo
@lru_cache(maxsize=100000)
def semantic_eye(st,u,v,t):
 closure=.5 if st=='04' else .625;phase=min(1,t/closure);k=phase*phase*(3-2*phase);rho=min(1,math.hypot(u,v));ax=.100*k if st=='04' else 0.;az=0. if st=='04' else .062*k;anchor=(ax,az)
 if rho<1e-9:return anchor
 # Changing angular coordinates while the aperture is broad keeps the same
 # radial ordering for the later line-to-stroke deformation.
 sx=.164+(1-.164)*phase;sz=.180+(1-.180)*phase;dx=u*sx;dz=v*sz;ll=math.hypot(dx,dz);dx/=ll;dz/=ll
 if st=='04':
  if t<=closure:
   w=.164*(1-k)+.142*k;h=.180*(1-k)+.036*k;centre=-.006*k
   def ellipse(x,z):return ((x-centre)/w)**2+(z/h)**2<=1
   r=ray_radius(dx,dz,anchor,ellipse)
   if phase>.6:
    q=(phase-.6)/.4;q=q*q*(3-2*q)
    def capsule(x,z):return segment_distance(x,z,(-.112,0),(.100,0))<=.036
    r=r*(1-q)+ray_radius(dx,dz,anchor,capsule)*q
  else:
   bend=(t-closure)/(1-closure);bend=bend*bend*(3-2*bend);height=.088*bend
   def bent_stroke(x,z):return min(segment_distance(x,z,(.100,0),(-.112,height)),segment_distance(x,z,(.100,0),(-.112,-height)))<=.036
   r=ray_radius(dx,dz,anchor,bent_stroke)
 else:
  w=.164*(1-k)+.1375*k;h=.180*(1-k)+.042*k
  def inside(x,z):
   q=x/w
   if abs(q)>1:return False
   ss=math.sqrt(max(0,1-q*q));mid=k*(-.025+.087*(1-q*q));return abs(z-mid)<=h*ss
  r=ray_radius(dx,dz,anchor,inside)
  if t>closure:
   k2=(t-closure)/(1-closure);k2=k2*k2*(3-2*k2);bx,bz=stroke_xy(st,dx,dz);r2=math.hypot(bx-ax,bz-az);r=r*(1-k2)+r2*k2

 return (ax+rho*r*dx,az+rho*r*dz)

def eye_xy(st,side,x,z,t):
 cx=side*.387;cz=1.021;u=(x-cx)/.164;v=(z-cz)/.180
 if st=='01':nx=cx+.164*u*1.02;nz=cz+.002+.180*v*1.03
 elif st=='04':
  xx,zz=stroke_xy('04',-side*u,v);nx=cx-side*xx;nz=cz+zz
 elif st=='05':
  ss=math.sqrt(max(0,1-u*u));q=max(-1,min(1,v/ss)) if ss>1e-7 else 0;inner=-side*u;corner=max(0,min(1,(abs(u)-.75)/.15));corner=corner*corner*(3-2*corner);lo=(-.137+.034*(1-u*u)-.010*inner)*(ss**(.12+.23*corner));hi=.180*ss;nx=x;nz=cz+(hi+lo)/2+(hi-lo)/2*q
 elif st=='07':
  xx,zz=stroke_xy('07',u,v);nx=cx+xx;nz=cz+zz
 elif st=='08':
  ss=math.sqrt(max(0,1-u*u));q=max(-1,min(1,v/ss)) if ss>1e-7 else 0;inner=-side*u;hi=(.095+.025*inner)*(ss**.15);lo=-.180*ss;nx=x;nz=cz+(hi+lo)/2+(hi-lo)/2*q
 if st in ['04','07']:
  if t>=1:return (nx,nz)
  if t<=0:return (x,z)
  xx,zz=semantic_eye(st,-side*u if st=='04' else u,v,t)
  return (cx-side*xx,cz+zz) if st=='04' else (cx+xx,cz+zz)
 return ((1-t)*x+t*nx,(1-t)*z+t*nz)

def eye(st,side,x,z,t,highlight=False):
 cx=side*.387;cz=1.021
 if highlight and st in ['04','07']:
  # Shrink material highlight around its source centre before the same lid warp.
  hcx=cx-.050;hcz=cz+.077;closure=.5 if st=='04' else .625;shrink=max(0,1-t/closure)**1.5;x=hcx+(x-hcx)*shrink;z=hcz+(z-hcz)*shrink
 u=(x-cx)/.164;v=(z-cz)/.180;nx,nz=eye_xy(st,side,x,z,t);q=u*u+v*v;dome=.013*((1-t)+t*(.17 if st in ['04','07'] else .75));ny=front(nx,nz)-.0015-(.0020*t if st=='07' else 0)-dome*max(0,1-q)**1.3
 # Internal depth support prevents linear chords cutting the skin between knots.
 # Rendered .25/.5/.75 and the approved endpoint remain exactly unchanged.
 if st=='04' and any(abs(t-k)<1e-8 for k in [.375,.625,.875]):ny-=.001
 if highlight:
  rr=math.sqrt(((x-(cx-.05))/.041)**2+((z-(cz+.077))/.043)**2);ny-=.0010+.0007*math.sqrt(max(0,1-rr*rr))
 return Vector((nx,ny,nz))

@lru_cache(maxsize=20000)
def pocket_radius(dx,dz,width,top,centre,depth,corner):
 def inside(x,z):
  if abs(x)>width or z>top:return False
  bottom=centre-depth*math.sqrt(max(0,1-(x/width)**2))
  if z<bottom:return False
  if z>top-corner and abs(x)>width-corner:
   return (abs(x)-(width-corner))**2+(z-(top-corner))**2<=corner*corner
  return True
 return ray_radius(dx,dz,(0,centre),inside)

def mouth(st,x,z,t):
 r=math.hypot(x,z-.695);a=math.atan2(z-.695,x)
 if st=='01':nx=x*1.55;nz=.689+(z-.695)*1.55
 elif st=='04':
  rr=max(0,min(1,(r-.026)/.023));u=math.cos(a);v=math.sin(a);core=.091;rad=.022;xi=core*u;xo=(core+rad)*u;xc=max(-core,min(core,xo));zi=.695+.021*(1-math.cos(2*math.pi*xi/core))/2;zo=.695+.021*(1-math.cos(2*math.pi*xc/core))/2+math.copysign(math.sqrt(max(0,rad*rad-max(0,abs(xo)-core)**2)),v);nx=xi+(xo-xi)*rr;nz=zi+(zo-zi)*rr
 elif st=='05':nx=x*2.00;nz=.690+1.04*(z-.695)
 elif st=='07':
  rr=max(0,min(1,(r-.026)/.023));dx=math.cos(a);dz=math.sin(a);inner=pocket_radius(dx,dz,.0625,.818,.790,.051,.009);outer=pocket_radius(dx,dz,.0925,.845,.790,.080,.014);rad=inner+(outer-inner)*rr;nx=rad*dx;nz=.790+rad*dz
 elif st=='08':
  rr=max(0,min(1,(r-.026)/.023));u=math.cos(a);v=math.sin(a);ang=math.pi*u/2;tx=.054*math.cos(ang);tz=.035*math.sin(ang);ll=math.hypot(tx,tz);tx/=ll;tz/=ll;nx=.054*math.sin(ang)+.0215*rr*(u*tx-v*tz);nz=.725-.035*math.cos(ang)+.0215*rr*(u*tz+v*tx)
 nx=(1-t)*x+t*nx;nz=(1-t)*z+t*nz;rr=max(0,min(1,(r-.026)/.023));ny=front(nx,nz)-.0025-.0015*math.sin(math.pi*rr);return Vector((nx,ny,nz))
for o in faces:
 side=-1 if o.name.endswith('_L') else 1
 for st in states:
  for ki,t in enumerate(knots,1):
   name=f'Face{st}_{ki:02}';k=o.shape_key_add(name=name);coords=[]
   for v,d in zip(o.data.vertices,k.data):
    x,y,z=v.co;co=mouth(st,x,z,t) if o.name=='A_mouth_ring' else eye(st,side,x,z,t,'highlight' in o.name);d.co=co;coords.append(tuple(co))
   k.value=0;targets[(o.name,name)]=coords
 o['selected_face_contract']='Selected01/04/05/07/08 piecewise conformal morphs; zero=exact approved05. Use selected_face_utils weights, not additive full states.'
root=bpy.data.objects['A_reference_root'];root['rig_revision']='r6-source-corrected-static-candidate';root['selected_face_reference']='User selected01/04/05/07/08 from expression-board-01, image hash6f42bec6. Body unchanged.'
model=[root,bpy.data.objects['A_Rig05'],skin]+faces;bpy.ops.object.select_all(action='DESELECT')
for o in model:o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(P/'bubu-a05-selected-faces.glb'),export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_morph_normal=True,export_animations=False,export_extras=True,export_apply=False)
bpy.ops.wm.save_as_mainfile(filepath=str(P/'bubu-a05-selected-faces.blend'))
bpy.ops.wm.open_mainfile(filepath=str(F/'bubu-a05-pivot-probe-look.blend'))
for (ob,name),vs in targets.items():
 o=bpy.data.objects[ob];k=o.shape_key_add(name=name)
 for v,co in zip(k.data,vs):v.co=co
 k.value=0
bpy.data.objects['A_reference_root']['rig_revision']='r6-source-corrected-static-candidate';bpy.ops.wm.save_as_mainfile(filepath=str(P/'bubu-a05-selected-faces-look.blend'))
manifest={'baseRigSHA256':hashlib.sha256((F/'bubu-a05-pivot-probe.glb').read_bytes()).hexdigest(),'assetSHA256':hashlib.sha256((P/'bubu-a05-selected-faces.glb').read_bytes()).hexdigest(),'states':states,'knots':[0]+knots,'sourceConceptSHA256':'6f42bec698df81a01f885243d5271b4030f6bdd15023d32864ce0e1730927769','bodyRestChanged':False,'status':'candidate, visual/attachment gate pending','stateDescriptions':{'01':'reference-size round eyes and larger round O','04':'source-weight rounded chevrons and solid double-arch tense mouth','05':'raised lower eyelids and horizontally open tense mouth','07':'thick round smile arches and raised pocket-shaped open mouth','08':'outward-downward upper lids with round lower eye volume and U smile'}};(P/'face-manifest.json').write_text(json.dumps(manifest,indent=2));print('BUILT',manifest['assetSHA256'])
