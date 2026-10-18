"""Render actual CPU-deformed Three.js geometry; not browser/WebGL evidence.
Input JSON {frames:[exportSceneFrame(...)], sourceGLB:absolute path}.
Fixed camera, same material source, no separate animation or face reconstruction.
"""
import bpy, json, sys, argparse, math, array
from pathlib import Path
from mathutils import Vector
p = argparse.ArgumentParser()
p.add_argument('--input', required=True)
p.add_argument('--out', required=True)
p.add_argument('--size', type=int, default=384)
p.add_argument('--samples', type=int, default=16)
p.add_argument('--angle', type=float, default=0)
p.add_argument('--elevation', type=float, default=0)
p.add_argument('--span', type=float, default=5.0)
p.add_argument('--target-y', type=float, default=1.05)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
data = json.loads(Path(a.input).read_text())
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=data['sourceGLB'])
materials = {o.name: list(o.data.materials) for o in bpy.data.objects if o.type == 'MESH'}
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.use_denoising = False
scene.cycles.samples = a.samples
scene.cycles.seed = 0
scene.world = bpy.data.worlds.new('World')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
for name, loc, power, size in [('key', (-3, -4, 6), 450, 5), ('fill', (4, -2, 3), 180, 4), ('rim', (0, 3, 5), 220, 3)]:
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.shape = 'DISK'
    d.size = size
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 1)) - o.location).to_track_quat('-Z', 'Y').to_euler()
camd = bpy.data.cameras.new('Camera')
cam = bpy.data.objects.new('Camera', camd)
scene.collection.objects.link(cam)
cam.location = (8 * math.sin(math.radians(a.angle)), -8 * math.cos(math.radians(a.angle)), a.target_y + 8 * math.sin(math.radians(a.elevation)))
cam.rotation_euler = (Vector((0, 0, a.target_y)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
camd.type = 'ORTHO'
camd.ortho_scale = a.span
scene.camera = cam
scene.render.resolution_x = a.size
scene.render.resolution_y = a.size
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
objects = {}
for i, frame in enumerate(data['frames']):
    for local in frame['meshes']:
        m = {**data.get('sharedMeshes', {}).get(local['name'], {}), **local}
        if m.get('diffuseColorsFile'):
            raw = array.array('f')
            raw.frombytes(Path(m['diffuseColorsFile']).read_bytes())
            m['diffuseColors'] = [value for k in range(0, len(raw), 3) for value in (*raw[k:k + 3], 1)]
        pos = m.get('positions')
        if pos is None:
            pos = array.array('f')
            pos.frombytes(Path(m['positionsFile']).read_bytes())
        vertices = [(pos[k], -pos[k + 2], pos[k + 1]) for k in range(0, len(pos), 3)]
        if m['name'] not in objects:
            mesh = bpy.data.meshes.new(m['name'])
            idx = m['indices']
            mesh.from_pydata(vertices, [], [idx[k:k + 3] for k in range(0, len(idx), 3)])
            mesh.update()
            o = bpy.data.objects.new(m['name'], mesh)
            scene.collection.objects.link(o)
            objects[m['name']] = o
            for mat in materials.get(m['name'], materials.get('A_mochi_skin', []) if m['name'].startswith('Bubu_') else []):
                mesh.materials.append(mat.copy() if m.get('diffuseColors') else mat)
            if not mesh.materials:
                mat = bpy.data.materials.new(m['name'] + '-material')
                mat.use_nodes = True
                bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'))
                rgb = m.get('materialColor', [0.8, 0.8, 0.8])
                bsdf.inputs['Base Color'].default_value = (*rgb[:3], 1)
                bsdf.inputs['Roughness'].default_value = 0.55
                if m.get('materialEmission'):
                    bsdf.inputs['Emission Color'].default_value=(*m['materialEmission'],1)
                    bsdf.inputs['Emission Strength'].default_value=m.get('emissiveIntensity',0)
                mesh.materials.append(mat)
            if m.get('colors'):
                colors = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
                for k, c in enumerate(colors.data):
                    c.color = m['colors'][k * 4:k * 4 + 4]
                if m['name'].startswith('boots_'):
                    mat = mesh.materials[0]
                    attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
                    attr.layer_name = 'Color'
                    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'))
                    mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
            for poly in mesh.polygons:
                poly.use_smooth = True
        else:
            mesh = objects[m['name']].data
            for v, co in zip(mesh.vertices, vertices):
                v.co = co
            mesh.update()
        if m.get('normalsFile'):
            normals = array.array('f')
            normals.frombytes(Path(m['normalsFile']).read_bytes())
            mesh.normals_split_custom_set_from_vertices([(normals[k], -normals[k + 2], normals[k + 1]) for k in range(0, len(normals), 3)])
        objects[m['name']].hide_render = m.get('opacity', 1) <= 0
        if m['name'].startswith('Sip_'):
            for mat in mesh.materials:
                bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if bsdf:
                    bsdf.inputs['Alpha'].default_value = m.get('opacity', 1)
        if m.get('diffuseColors'):
            mesh = objects[m['name']].data
            color = mesh.color_attributes.get('ActualDiffuse') or mesh.color_attributes.new(name='ActualDiffuse', type='FLOAT_COLOR', domain='POINT')
            for k, c in enumerate(color.data):
                c.color = m['diffuseColors'][k * 4:k * 4 + 4]
            for mat in mesh.materials:
                nodes = mat.node_tree.nodes
                links = mat.node_tree.links
                attr = nodes.get('ActualDiffuse')
                if attr is None:
                    attr = nodes.new('ShaderNodeVertexColor')
                    attr.name = 'ActualDiffuse'
                    attr.layer_name = 'ActualDiffuse'
                    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'))
                    links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    scene.render.filepath = str(out / f'{i:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('ACTUAL_FRAME', i, frame['time'], frame.get('label', ''), flush=True)
(out / 'render-manifest.json').write_text(json.dumps({'scope': 'Blender CPU rendering of actual Three.js world-deformed meshes; WebGL/OS unverified', 'sourceGLB': data['sourceGLB'], 'fixedCamera': [0, -8, 1.5], 'span': a.span, 'frames': [{'index': i, 'time': f['time'], 'label': f.get('label', '')} for i, f in enumerate(data['frames'])]}, indent=2))
