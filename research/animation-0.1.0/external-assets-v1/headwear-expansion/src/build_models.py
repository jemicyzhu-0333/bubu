import bpy,math,json
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parents[1]
def reset():bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(n,c):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*c,1);s.inputs['Roughness'].default_value=.48;return m
def finish(o,n,m):
 o.name=n;o.data.materials.append(m)
 for f in o.data.polygons:f.use_smooth=True
 return o
def ball(n,loc,scale,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=loc);o=finish(bpy.context.object,n,m);o.scale=scale;return o
def mesh(n,vs,fs,m):
 d=bpy.data.meshes.new(n);d.from_pydata(vs,[],fs);d.update();o=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(o);finish(o,n,m);return o
def tube(n,pts,r,m):
 c=bpy.data.curves.new(n,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('POLY');s.points.add(len(pts)-1)
 for p,co in zip(s.points,pts):p.co=(*co,1)
 o=bpy.data.objects.new(n,c);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def export(n):
 for o in bpy.context.scene.objects:
  o.location.z-=.04
  o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(P/'models'/f'{n}.glb'),export_format='GLB',use_selection=True)
def leaf(n,m,vein):
 vs=[];fs=[];N=40;M=16
 for i in range(N+1):
  t=i/N;x=-.43+.78*t;w=.25*math.sin(math.pi*t)**.8
  for j in range(M+1):
   u=2*j/M-1;y=w*u;z=1.73+.095*math.sin(math.pi*t)+.07*u*u*math.sin(math.pi*t);vs.append((x,.02+.06*math.sin(math.pi*t)+.02*u*u,1.86+.8*y+.08*x))
 for i in range(N):
  for j in range(M):k=i*(M+1)+j;fs.append((k,k+1,k+M+2,k+M+1))
 o=mesh(n,vs,fs,m);s=o.modifiers.new('soft leaf thickness','SOLIDIFY');s.thickness=.02;b=o.modifiers.new('soft edge','BEVEL');b.width=.012;b.segments=3
 tube(n+'_vein',[(-.43+.78*i/40,.01+.06*math.sin(math.pi*i/40),1.86+.08*(-.43+.78*i/40)) for i in range(41)],.008,vein)
reset();green=mat('jade leaf',(.18,.36,.09));vein=mat('pale leaf vein',(.55,.67,.27));leaf('forest_leaf',green,vein);tube('forest_petiole',[(.32+.13*i/20,.02,1.88-.20*(i/20)**2) for i in range(21)],.022,mat('brown petiole',(.23,.13,.055)));
export('08-forest-leaf')
reset();pink=mat('cream pink petals',(.98,.62,.65));gold=mat('warm yellow stamens',(.98,.65,.16));green=mat('muted mint leaves',(.34,.53,.36))
# Flower in tilted frontal plane: use custom five notched convex petal shells.
center=Vector((0,-.13,1.82));right=Vector((1,0,0));up=Vector((0,.50,.866));normal=Vector((0,-.866,.50))
for k in range(5):
 a=math.pi/2+2*math.pi*k/5;rad=right*math.cos(a)+up*math.sin(a);tangent=-right*math.sin(a)+up*math.cos(a);vs=[tuple(center+normal*.055)];N=48
 for i in range(N):
  t=2*math.pi*i/N;length=.16+.17*math.cos(t);length-=.035*math.exp(-(t%(2*math.pi))**2/.04);width=.12*math.sin(t);vs.append(tuple(center+rad*length+tangent*width+normal*(.018+.025*math.cos(t))))
 fs=[(0,i+1,(i+1)%N+1) for i in range(N)];o=mesh('sakura_petal_'+str(k),vs,fs,pink);s=o.modifiers.new('petal volume','SOLIDIFY');s.thickness=.035;b=o.modifiers.new('round edge','BEVEL');b.width=.012;b.segments=3
for k in range(7):
 a=k*2*math.pi/6;pos=center+normal*.08+(right*math.cos(a)+up*math.sin(a))*(.045 if k<6 else 0);ball('sakura_stamen_'+str(k),pos,(.026,.026,.028),gold)
for x in [-.19,.19]:
 o=ball('sakura_leaf_'+str(x),(x,.005,1.79),(.16,.055,.07),green);o.rotation_euler.y=-.5 if x<0 else .5
export('09-sakura-flower')
reset();gold=mat('butter gold moon',(.95,.73,.28));lav=mat('lavender mount',(.43,.32,.49));ball('moon_mount',(0,0,1.68),(.10,.07,.025),lav)
# Crescent as smoothly beveled closed curved polygon in XZ, open on right.
N=64;outer=[];inner=[]
for i in range(N+1):
 a=math.radians(60)+math.radians(240)*i/N;outer.append((.25*math.cos(a),0,1.98+.25*math.sin(a)))
for i in range(N+1):
 t=i/N;inner.append((.125-.16*math.sin(math.pi*t),0,1.98-.2165+.433*t))
pts=outer+inner;vs=[(x,y+d,z) for d in [-.045,.045] for x,y,z in pts];L=len(pts);fs=[tuple(range(L-1,-1,-1)),tuple(range(L,2*L))]+[(i,(i+1)%L,(i+1)%L+L,i+L) for i in range(L)];o=mesh('moon_crescent',[(x,y,z-.035) for x,y,z in vs],fs,gold);b=o.modifiers.new('soft moon bevel','BEVEL');b.width=.025;b.segments=4;export('10-moon-crescent')
reset();orange=mat('flame orange',(.98,.28,.035));yellow=mat('flame warm center',(.98,.72,.20))
def flame(n,c,w,h,depth,m,curl):
 vs=[];fs=[];N=48;M=32
 for j in range(M+1):
  t=j/M;rad=w*math.sin(math.pi*t)**.8*(1-.5*t);cx=c[0]+curl*t*t;z=c[2]+h*t
  for i in range(N):
   a=2*math.pi*i/N;vs.append((cx+rad*math.cos(a),c[1]+rad*depth*math.sin(a),z))
 for j in range(M):
  for i in range(N):k=j*N+i;l=j*N+(i+1)%N;fs.append((k,l,l+N,k+N))
 mesh(n,vs,fs,m)
ball('flame_mount',(0,0,1.68),(.25,.13,.035),orange)
flame('flame_center',(0,0,1.69),.20,.60,.52,orange,.075)
flame('flame_left',(-.17,0,1.69),.10,.36,.65,orange,-.035)
flame('flame_right',(.17,0,1.69),.10,.38,.65,orange,.025)
flame('flame_yellow',(0,-.105,1.69),.125,.34,.40,yellow,.045);export('11-flame-tip')
reset();gold=mat('crown antique gold',(.77,.47,.12));mint=mat('crown muted mint',(.45,.65,.42));lav=mat('crown lavender jewel',(.52,.30,.68));N=160;vs=[];fs=[]
for i in range(N):
 a=2*math.pi*i/N;peak=((math.cos(5*(a+math.pi/2))+1)/2)**2;z=1.86+.15*peak
 for rad,h in [(.29,1.68),(.32,z),(.29,z),(.26,1.68)]:vs.append((rad*math.cos(a),rad*math.sin(a),h))
for i in range(N):
 for j in range(4):fs.append((i*4+j,((i+1)%N)*4+j,((i+1)%N)*4+(j+1)%4,i*4+(j+1)%4))
o=mesh('crown_band',vs,fs,gold);b=o.modifiers.new('rolled edges','BEVEL');b.width=.009;b.segments=3
for k in range(5):
 a=-math.pi/2+2*math.pi*k/5;ball('crown_tip_'+str(k),(.32*math.cos(a),.32*math.sin(a),2.01),(.035,.035,.035),gold)
tube('crown_mint_trim',[(.29*math.cos(i*2*math.pi/100),.29*math.sin(i*2*math.pi/100),1.70) for i in range(101)],.025,mint);ball('crown_jewel',(0,-.313,1.82),(.057,.025,.065),lav);export('12-crown')
reset();lav=mat('antenna lavender base',(.48,.30,.68));silver=mat('antenna satin silver',(.65,.69,.70));mint=mat('antenna mint sphere',(.30,.82,.58));dark=mat('antenna teal stripe',(.015,.20,.17));ball('antenna_base',(0,0,1.69),(.17,.13,.07),lav);tube('antenna_stalk',[(.06*(i/40)**2,0,1.72+.29*i/40) for i in range(41)],.028,silver);ball('antenna_tip',(.06,0,2.07),(.12,.12,.12),mint);tube('antenna_stripe',[(.06+.1205*math.cos(i*2*math.pi/96),.1205*math.sin(i*2*math.pi/96),2.07) for i in range(97)],.012,dark);export('13-robot-antenna')
reset();orange=mat('pumpkin soft orange',(.92,.27,.035));rim=mat('burnt orange rim',(.56,.14,.025));sage=mat('pumpkin sage stem',(.18,.28,.12));ball('pumpkin_rim',(0,0,1.69),(.31,.27,.045),rim)
# One continuous soft lobed beret, not separated orange balls.
vs=[];fs=[];N=120;M=40
for j in range(M+1):
 t=math.pi*j/M
 for i in range(N):
  a=2*math.pi*i/N;r=.36*math.sin(t)*(1+.055*math.cos(6*a));vs.append((r*math.cos(a),r*.86*math.sin(a),1.78+.12*math.cos(t)))
for j in range(M):
 for i in range(N):k=j*N+i;l=j*N+(i+1)%N;fs.append((k,l,l+N,k+N))
mesh('pumpkin_beret',vs,fs,orange);tube('pumpkin_stem',[(.06*(i/30)**2,0,1.87+.16*i/30) for i in range(31)],.027,sage);o=ball('pumpkin_leaf',(.12,-.02,1.93),(.115,.06,.025),sage);o.rotation_euler.y=-.25;export('17-pumpkin-beret')
