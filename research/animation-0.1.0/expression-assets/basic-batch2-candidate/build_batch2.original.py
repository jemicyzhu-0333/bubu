import bpy,math,json,hashlib,sys
from pathlib import Path
from functools import lru_cache
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent
sys.path.insert(0,str(P))
from closed_mouth_transition import close_then_shape
from round_stroke_geometry import swept_capsule
BASE=P.parent/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review'
STATES=['R0','A7','S2'];KNOTS=[i/8 for i in range(1,9)]

def sd(x,z,a,b):
 dx=b[0]-a[0];dz=b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));return math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)
def radius(dx,dz,anchor,inside):
 lo=0.;hi=.5
 for _ in range(30):
  q=(lo+hi)/2
  if inside(anchor[0]+dx*q,anchor[1]+dz*q):lo=q
  else:hi=q
 return lo
@lru_cache(maxsize=100000)
def stroke_xy(which,u,v):
 if which in ['sleep','friendly']:
  # Sweep a capsule along a quadratic centreline using tangent/normal vectors.
  # The prior vertical graph warp thinned steep U sides. This preserves normal
  # stroke width and round endpoint caps, with the original outer X/Z bounds.
  args=(.183,.025,-.093,.00706519455164431) if which=='sleep' else (.126,.0255,.642,.7439898664237167)
  return swept_capsule(u,v,*args)
 elif which=='transitionPill':pts=[(-.038,.695),(.038,.695)];r=.023;anchor=(0,.695)
 elif which=='short':pts=[(-.080,.695),(.080,.695)];r=.025;anchor=(0,.695)
 else:raise ValueError(which)
 rho=min(1,math.hypot(u,v))
 if rho<1e-9:return anchor
 dx=u/math.hypot(u,v);dz=v/math.hypot(u,v);q=radius(dx,dz,anchor,lambda x,z:min(sd(x,z,a,b) for a,b in zip(pts[:-1],pts[1:]))<=r)
 return anchor[0]+rho*q*dx,anchor[1]+rho*q*dz

def eye_xz(x,z,side,t):
 cx=side*.387;cz=1.021;u=max(-1,min(1,(x-cx)/.164));v=(z-cz)/.180;ss=math.sqrt(max(0,1-u*u));q=max(-1,min(1,v/ss)) if ss>1e-9 else 0
 phase=min(1,t/.625);k=phase*phase*(3-2*phase);w=.164*(1-k)+.183*k;cap=math.sqrt(max(0,.023**2-max(0,abs(.183*u)-.160)**2));h=.180*ss*(1-k)+cap*k;nx=cx+w*u;nz=cz-.043*k+h*q
 if t>.625:
  blend=(t-.625)/.375;blend=blend*blend*(3-2*blend);xx,zz=stroke_xy('sleep',u,v);nx=nx*(1-blend)+(cx+xx)*blend;nz=nz*(1-blend)+(cz+zz)*blend
 return nx,nz


def eye(st,side,x,y,z,t,highlight=False):
 if st!='A7':return Vector((x,y,z))
 cx=side*.387;cz=1.021
 if highlight:
  hx=cx-.05;hz=cz+.077;shrink=max(0,1-t/.625)**1.5;x=hx+(x-hx)*shrink;z=hz+(z-hz)*shrink
 u=(x-cx)/.164;v=(z-cz)/.180;nx,nz=eye_xz(x,z,side,t);dome=.013*((1-t)+t*.17);ny=front(nx,nz)-.0018-.002*t-dome*max(0,1-u*u-v*v)**1.3
 if highlight:
  rr=math.sqrt(((x-(cx-.05))/.041)**2+((z-(cz+.077))/.043)**2);ny-=.0010+.0007*math.sqrt(max(0,1-rr*rr))
 return Vector((nx,ny,nz))

def mouth(st,x,y,z,t):
 r=math.hypot(x,z-.695);a=math.atan2(z-.695,x);rr=max(0,min(1,(r-.026)/.023));u=math.cos(a);v=math.sin(a);rr=0. if rr<1e-4 else 1. if rr>1-1e-4 else rr
 final=stroke_xy('friendly' if st=='S2' else 'short',rr*u,rr*v);nx,nz=close_then_shape(rr,u,v,t,final,stroke_xy('transitionPill',u,v));ny=front(nx,nz)-.0025-.0015*math.sin(math.pi*rr);return Vector((nx,ny,nz))


def add_brows():return []

def build_scene(source,output,export=False):
 global body
 bpy.ops.wm.open_mainfile(filepath=str(source));skin=bpy.data.objects['A_mochi_skin'];body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get());faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name=='A_mouth_ring']
 for o in faces:
  side=-1 if o.name.endswith('_L') else 1
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
    for v,d in zip(o.data.vertices,key.data):d.co=mouth(st,*v.co,t) if o.name=='A_mouth_ring' else eye(st,side,*v.co,t,'highlight' in o.name)
    key.value=0
 brows=add_brows();root=bpy.data.objects['A_reference_root'];root['new_basic_faces']='R0/A7/S2 candidate, source directions accepted,3D not approved';root['gaze_status']='not implemented'
 if export:
  bpy.ops.object.select_all(action='DESELECT')
  for o in [root,bpy.data.objects['A_Rig05'],skin]+faces+brows:o.select_set(True)
  bpy.context.view_layer.objects.active=root;bpy.ops.export_scene.gltf(filepath=str(P/'bubu-a05-basic-batch2.glb'),export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_morph_normal=True,export_animations=False,export_extras=True,export_apply=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(output))

def front(x,z):
 hit=body.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6)[0];assert hit is not None,(x,z);return hit.y
build_scene(BASE/'bubu-a05-selected-faces.blend',P/'bubu-a05-basic-batch2.blend',True)
build_scene(BASE/'bubu-a05-selected-faces-look.blend',P/'bubu-a05-basic-batch2-look.blend')
(P/'asset-manifest.json').write_text(json.dumps({'sourceR6SHA256':hashlib.sha256((BASE/'bubu-a05-selected-faces.glb').read_bytes()).hexdigest(),'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch2.glb').read_bytes()).hexdigest(),'newStates':STATES,'newTargetsPerState':8,'browMeshes':[],'status':'3D candidate awaiting visual and attachment gates; no runtime','bodyRestChanged':False,'historicalR6TargetsIntendedUnchanged':True},indent=2))
