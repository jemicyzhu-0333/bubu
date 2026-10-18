import bpy, math, json
from pathlib import Path
P = Path(__file__).resolve().parents[1]

def material(name, c, rough=0.6, metal=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*c, 1)
    m.use_nodes = True
    s = m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value = (*c, 1)
    s.inputs['Roughness'].default_value = rough
    s.inputs['Metallic'].default_value = metal
    return m

def finish(o, name, m):
    o.name = name
    o.data.materials.append(m)
    for f in o.data.polygons:
        f.use_smooth = True
    return o

def export(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(P / 'models' / f'{name}.glb'), export_format='GLB', use_selection=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
gold = material('halo warm satin gold', (0.88, 0.56, 0.12), 0.32, 0.3)
bpy.ops.mesh.primitive_torus_add(major_radius=0.62, minor_radius=0.045, major_segments=96, minor_segments=16, location=(0, 0, 2.04))
o = finish(bpy.context.object, 'halo_ring', gold)
o.scale.y = 0.8
o.rotation_euler.x = 0.16
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
export('05-halo')
bpy.ops.wm.read_factory_settings(use_empty=True)
lavender = material('cape soft lavender', (0.48, 0.36, 0.65), 0.9)
mint = material('cape pale mint piping', (0.57, 0.79, 0.66), 0.85)
ivory = material('cape ivory clasp', (0.9, 0.85, 0.63), 0.5)
profile = [(0.125, 0), (0.14, 0.32), (0.17, 0.54), (0.23, 0.69), (0.32, 0.81), (0.44, 0.9), (0.6, 0.969), (0.78, 1.0), (0.98, 0.985), (1.16, 0.935)]

def radius(z):
    for (a, b), (c, d) in zip(profile, profile[1:]):
        if a <= z <= c:
            return b + (d - b) * (z - a) / (c - a)
    return 0.97

def point(a, t):
    back = (math.sin(a) + 1) / 2
    top = 0.98 - 0.045 * math.sin(a) ** 2 - 0.035 * abs(math.cos(a)) ** 8
    bottom = 0.235 + 0.06 * math.cos(4 * a) + 0.015 * math.cos(8 * a)
    z = top * (1 - t) + bottom * t
    r = radius(z) + 0.045 + 0.25 * t + 0.055 * math.sin(a * 8) * math.sin(t * math.pi) + 0.035 * math.sin(a * 8) * t
    return (r * math.cos(a), r * 0.8 * math.sin(a), z)
N = 120
M = 14
vs = []
fs = []
for i in range(N + 1):
    for j in range(M + 1):
        corner = 0.5 + 0.1 * abs(2 * j / M - 1) ** 8
        a = corner + (math.pi - 2 * corner) * i / N
        vs.append(point(a, j / M))
for i in range(N):
    for j in range(M):
        k = i * (M + 1) + j
        fs.append((k, k + M + 1, k + M + 2, k + 1))
d = bpy.data.meshes.new('cape shell')
d.from_pydata(vs, [], fs)
d.update()
o = bpy.data.objects.new('cape_cloth', d)
bpy.context.collection.objects.link(o)
finish(o, 'cape_cloth', lavender)
s = o.modifiers.new('cloth thickness', 'SOLIDIFY')
s.thickness = 0.018

def tube(name, points, rad, mat):
    c = bpy.data.curves.new(name, 'CURVE')
    c.dimensions = '3D'
    c.bevel_depth = rad
    c.bevel_resolution = 3
    p = c.splines.new('POLY')
    p.points.add(len(points) - 1)
    for v, co in zip(p.points, points):
        v.co = (*co, 1)
    o = bpy.data.objects.new(name, c)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
for j, label in [(0, 'back_edge'), (M, 'hem')]:
    tube('cape_' + label, [vs[i * (M + 1) + j] for i in range(N + 1)], 0.014, mint)
for i in [0, N]:
    tube('cape_edge_' + str(i), [vs[i * (M + 1) + j] for j in range(M + 1)], 0.014, mint)
export('07-cape')
