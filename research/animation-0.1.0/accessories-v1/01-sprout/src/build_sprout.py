"""Reference-driven sprout, independent accessory geometry. Blender 4.3+."""
import bpy, bmesh, math, json, sys, argparse, hashlib
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parents[1]
ROOT=P.parents[1]
def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=.69
 return m

def tube(name,points,radius,mat):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=16;c.bevel_depth=radius;c.bevel_resolution=3;c.use_fill_caps=True
 s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for b,p in zip(s.bezier_points,points):b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(mat);return o

def build():
 green=material('sprout leaf satin green',(.30,.57,.065));stem=material('sprout stem green',(.22,.43,.045));vein=material('sprout subtle vein',(.25,.48,.055))
 objects=[tube('sprout_stem',[(0,0,-.04),(0,0,.12),(.005,.005,.24)],.028,stem)]
 for side in [-1,1]:
  verts=[];faces=[];N=48;M=24
  for surface in [-1,1]:
   for i in range(N+1):
    t=i/N;w=.15*math.sin(math.pi*t)**.55;th=.018*math.sin(math.pi*t)**.55
    for j in range(M+1):
     u=-1+2*j/M
     x=side*(.01+.49*t-.52*w*u);z=.18+(.28 if side<0 else .32)*t+.85*w*u
     y=.045*math.sin(math.pi*t)+.065*u*u*math.sin(math.pi*t)+surface*th*math.sqrt(max(0,1-u*u))
     verts.append((x,y,z))
  layer=(N+1)*(M+1)
  for k in range(2):
   for i in range(N):
    for j in range(M):
     a=k*layer+i*(M+1)+j;face=(a,a+1,a+M+2,a+M+1);faces.append(face if k else face[::-1])
  for i in range(N):
   for j in [0,M]:
    a=i*(M+1)+j;b=(i+1)*(M+1)+j;faces.append((a,b,b+layer,a+layer))
  for i in [0,N]:
   for j in range(M):
    a=i*(M+1)+j;faces.append((a,a+layer,a+1+layer,a+1))
  mesh=bpy.data.meshes.new('curved sealed leaf');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('sprout_leaf_'+str(side),mesh);bpy.context.collection.objects.link(o);mesh.materials.append(green)
  for f in mesh.polygons:f.use_smooth=True
  o.rotation_euler.z=math.radians(side*28)
  objects.append(o)
  pts=[]
  for t in [.10,.25,.45,.65,.83,.93]:pts.append((side*(.01+.49*t),.045*math.sin(math.pi*t)-.018*math.sin(math.pi*t)**.55-.002,.18+(.28 if side<0 else .32)*t))
  v=tube('sprout_vein_'+str(side),pts,.004,vein);v.rotation_euler.z=math.radians(side*28);objects.append(v)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=.028, location=(0,0,-.04))
 cap=bpy.context.object;cap.name='sprout_round_root';cap.data.materials.append(stem)
 for f in cap.data.polygons:f.use_smooth=True
 objects.append(cap)
 return objects

if __name__=='__main__':
 bpy.ops.wm.read_factory_settings(use_empty=True);objects=build()
 for o in objects:
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
  o.select_set(False)
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(P/'sprout.glb'),export_format='GLB',use_selection=True,export_yup=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(P/'sprout.blend'))
 print('SPROUT_BUILT')
