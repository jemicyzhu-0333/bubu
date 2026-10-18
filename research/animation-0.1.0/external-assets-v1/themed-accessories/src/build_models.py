import bpy, math, sys, bmesh
from pathlib import Path
P=Path(__file__).resolve().parents[1]
def reset():bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*c,1);s.inputs['Roughness'].default_value=.83;return m
def finish(o,name,m):
 o.name=name;o.data.materials.append(m)
 for p in o.data.polygons:p.use_smooth=True
 return o
def ell(name,pos,scale,m,rot=0):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=pos);o=finish(bpy.context.object,name,m);o.scale=scale;o.rotation_euler.y=rot;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);return o
def tube(name,points,r,m):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=4;s=c.splines.new('POLY');s.points.add(len(points)-1)
 for v,p in zip(s.points,points):v.co=(*p,1)
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(m);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return o
def export(name):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(P/'models'/f'{name}.glb'),export_format='GLB',use_selection=True)
def cap():
 reset();green=mat('moss green soft felt',(.25,.34,.09));dark=mat('forest underside',(.13,.21,.045));cream=mat('warm cream feather',(.95,.82,.56));stem=mat('feather warm shaft',(.54,.32,.12))
 # A hollow tapered soft crown behind the original ears, generous side depth.
 n=72;rings=24;vs=[];fs=[]
 for j in range(rings+1):
  t=j/rings;rx=.57*(1-t)**.72+.015;ry=.42*(1-t)**.74+.012
  for i in range(n):
   a=2*math.pi*i/n;vs.append((rx*math.cos(a)+.28*t*t,.10+ry*math.sin(a),1.60+.43*t-.12*t*t))
 for j in range(rings):
  for i in range(n):
   k=j*n+i;z=j*n+(i+1)%n;fs.append((k,z,z+n,k+n))
 mesh=bpy.data.meshes.new('cap crown');mesh.from_pydata(vs,[],fs);mesh.update();o=bpy.data.objects.new('cap_crown',mesh);bpy.context.collection.objects.link(o);finish(o,'cap_crown',green);s=o.modifiers.new('soft thickness','SOLIDIFY');s.thickness=.035
 tube('cap_brim',[(.59*math.cos(a),.10+.44*math.sin(a),1.61+.025*math.sin(a)) for a in [2*math.pi*i/120 for i in range(121)]],.045,dark)
 ell('cap_feather',(.44,.22,1.99),(.085,.035,.27),cream,.55)
 tube('cap_feather_shaft',[(.31+.26*t,.185,1.78+.43*t) for t in [i/30 for i in range(31)]],.009,stem)
 export('woodsman-cap')
def fin():
 reset();aqua=mat('continuous aqua fin membrane',(.12,.61,.68));rib=mat('deep teal fin ribs',(.025,.20,.25))
 points=[(-.13,.34),(-.32,.43),(-.43,.67),(-.34,.79),(-.21,.81),(-.16,.98),(0,1.08),(.16,.98),(.21,.81),(.34,.79),(.43,.67),(.32,.43),(.13,.34)]
 def tip(x):
  t=max(0,min(1,(-x-.27)/.16));return x-.65*t*t*(3-2*t)
 outline=[(tip(x),.71+.14*(z-.34)/.74-.34*(abs(x)/.43)**2,z-.04*(abs(x)/.43)**2) for x,z in smooth_loop(points)]
 pillow('fin_continuous_membrane',outline,.055,aqua)
 for side in [-1,1]:
  tube('fin_rib_'+str(side),[(side*.19*t,.73+.10*t+.035*math.sin(t*math.pi),.35+.53*t) for t in [j/30 for j in range(31)]],.020,rib)
 # Compact root intersects back skin deliberately; no visible shelf or disc.
 ell('fin_hidden_root',(0,.685,.37),(.12,.10,.075),rib)
 for o in bpy.data.objects:
  if o.type=='MESH':
   for v in o.data.vertices:v.co.z+=.30;v.co.y+=.065
   if o.name=='fin_continuous_membrane':
    half=len(o.data.vertices)//2
    for i in range(half):
     a=o.data.vertices[i].co;b=o.data.vertices[i+half].co
     mid=(a.y+b.y)/2;target=.85*math.sqrt(max(0,1-(a.x/1.02)**2))+.065
     delta=max(0,target-mid);a.y+=delta;b.y+=delta
   elif o.name.startswith('fin_rib'):
    for v in o.data.vertices:v.co.y=max(v.co.y,.85*math.sqrt(max(0,1-(v.co.x/1.02)**2))+.14)
   elif o.name=='fin_hidden_root':
    for v in o.data.vertices:v.co.y+=.035
 export('ocean-fin')
def smooth_loop(points,steps=8):
 out=[];n=len(points)
 for i in range(n):
  a,b,c,d=[points[(i+j)%n] for j in [-1,0,1,2]]
  for j in range(steps):
   t=j/steps;out.append(tuple(.5*((2*b[k])+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t) for k in range(len(b))))
 return out
def pillow(name,outline,depth,m):
 # Rounded closed membrane with actual thickness, two cushion faces.
 cx=sum(p[0] for p in outline)/len(outline);cy=sum(p[1] for p in outline)/len(outline);cz=sum(p[2] for p in outline)/len(outline);n=len(outline);vs=[];fs=[]
 for side in [-1,1]:
  for j in range(7):
   t=(j+1)/7
   for x,y,z in outline:vs.append((cx+(x-cx)*t,cy+(y-cy)*t+side*depth*math.sqrt(max(0,1-t*t)) + side*.007,cz+(z-cz)*t))
  vs.append((cx,cy+side*depth+side*.007,cz))
 block=7*n+1
 for side in range(2):
  off=side*block
  for j in range(6):
   for i in range(n):
    a=off+j*n+i;b=off+j*n+(i+1)%n;fs.append((a,b,b+n,a+n))
  for i in range(n):fs.append((off+7*n,off+i,off+(i+1)%n))
 for i in range(n):fs.append((6*n+i,6*n+(i+1)%n,block+6*n+(i+1)%n,block+6*n+i))
 d=bpy.data.meshes.new(name);d.from_pydata(vs,[],fs);d.update();bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(d);bm.free();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);finish(o,name,m)
 return o
def wings():
 reset();membrane=mat('lavender soft membrane',(.48,.34,.66));rib=mat('rounded plum wing ribs',(.22,.12,.34))
 points=[(.61,.73),(.91,1.00),(1.17,.94),(1.41,.73),(1.48,.47),(1.30,.51),(1.23,.35),(1.06,.44),(.95,.33),(.82,.48),(.64,.47)]
 for side in [-1,1]:
  label='left' if side<0 else 'right';outline=[(side*(x-.08),.68+.05*(1.4-x),z+.08-.09*max(0,(x-.61)/.87)) for x,z in smooth_loop(points)]
  pillow('wings_'+label+'_membrane',outline,.045,membrane)
  tube('wings_'+label+'_rim',outline+[outline[0]],.023,rib)
  for k,(x,z) in enumerate([(1.23,.35),(.95,.33)]):
   tube('wings_'+label+'_rib'+str(k),[(side*(.83+(x-.91)*t),.74+.035*math.sin(t*math.pi),1.08+(z-1.0)*t-.09*max(0,(.91+(x-.91)*t-.61)/.87)) for t in [j/30 for j in range(31)]],.023,rib)
  ell('wings_'+label+'_root',(side*.54,.58,.80),(.16,.16,.14),rib)
 export('bat-wings')
def plum():
 reset();cloth=mat('deep plum soft cloth',(.13,.003,.045));edge=mat('plum soft folded edge',(.095,.002,.031));gold=mat('warm gold side clasp',(.95,.55,.07));bsdf=gold.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Metallic'].default_value=.25;bsdf.inputs['Roughness'].default_value=.30
 profile=[(.125,0),(.14,.32),(.17,.54),(.23,.69),(.32,.81),(.44,.90),(.60,.969),(.78,1.),(.98,.985),(1.16,.935),(1.35,.82)]
 def radius(z):
  for (a,b),(c,d) in zip(profile,profile[1:]):
   if a<=z<=c:return b+(d-b)*(z-a)/(c-a)
  return .97
 def point(a,t):
  top=1.16+.09*math.sin(a)**2;bottom=.195+.20*math.cos(a)**4+.014*math.cos(6*a)
  z=top*(1-t)+bottom*t;r=max(radius(z)+.055,.91+.04*t)+.026*math.cos(6*a)*t*t
  return (r*math.cos(a),r*.80*math.sin(a)+.19*math.exp(-((z-.43)/.21)**2)*math.sin(a)**8,z)
 N=120;M=22;vs=[];fs=[]
 for i in range(N+1):
  for j in range(M+1):
   t=j/M;corner=.98-.28*t+.035*abs(2*t-1)**8;a=corner+(math.pi-2*corner)*i/N;vs.append(point(a,t))
 for i in range(N):
  for j in range(M):
   k=i*(M+1)+j;fs.append((k,k+M+1,k+M+2,k+1))
 d=bpy.data.meshes.new('plum soft rear drape');d.from_pydata(vs,[],fs);d.update();o=bpy.data.objects.new('plum_cloth',d);bpy.context.collection.objects.link(o);finish(o,'plum_cloth',cloth);sol=o.modifiers.new('actual fabric thickness','SOLIDIFY');sol.thickness=.025
 tube('plum_soft_hem',[vs[i*(M+1)+M] for i in range(N+1)],.010,cloth)
 # Real folded band restricted to the back arc; no front chest bridge.
 bandvs=[];bandfs=[];A=120;B=10
 for i in range(A+1):
  a=1.00+(math.pi-2.00)*i/A;mid=1.16+.09*math.sin(a)**2
  for j in range(B+1):
   t=j/B;z=mid+.048-.105*t;r=radius(z)+.055+.010*math.sin(math.pi*t)
   bandvs.append((r*math.cos(a),r*.8*math.sin(a),z))
 for i in range(A):
  for j in range(B):
   k=i*(B+1)+j;q=k+B+1;bandfs.append((k,q,q+1,k+1))
 d=bpy.data.meshes.new('plum side-open folded band');d.from_pydata(bandvs,[],bandfs);d.update();o=bpy.data.objects.new('plum_rear_band',d);bpy.context.collection.objects.link(o);finish(o,'plum_rear_band',edge);sol=o.modifiers.new('folded cloth thickness','SOLIDIFY');sol.thickness=.026;bevel=o.modifiers.new('soft round band rim','BEVEL');bevel.width=.012;bevel.segments=3
 # Gold clasp on rear right shoulder, outside existing tea hand/prop corridor.
 a=1.04;z=1.16+.09*math.sin(a)**2;r=radius(z)+.06
 ell('plum_side_gold_clasp',(r*math.cos(a),r*.8*math.sin(a),z),(.047,.038,.047),gold)
 export('plum-cape')
if __name__=='__main__':
 if '--plum-only' in sys.argv:plum()
 else:cap();fin();wings();plum()
