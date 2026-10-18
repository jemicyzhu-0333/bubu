import os
import sys, json, struct, hashlib
from pathlib import Path
import numpy as np
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--foot-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True);args=parser.parse_args()
P=args.output_root.resolve();S=args.foot_root.resolve()
for d in ['models','reports']:(P/d).mkdir(parents=True,exist_ok=True)
doc = {'asset': {'version': '2.0', 'generator': 'bubu approved-foot shell builder'}, 'buffers': [], 'bufferViews': [], 'accessors': [], 'meshes': [], 'nodes': [], 'scenes': [{'nodes': [0, 1]}], 'scene': 0, 'materials': [{'name': 'lavender satin with mint soles', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.08, 'roughnessFactor': 0.48}}]}
binary = bytearray()
report = {}

def attr(a):
    a = np.ascontiguousarray(a)
    binary.extend(b'\x00' * (-len(binary) % 4))
    off = len(binary)
    binary.extend(a.tobytes())
    bv = len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': a.nbytes})
    n = len(doc['accessors'])
    v = {'bufferView': bv, 'componentType': {'f': 5126, 'u': {1: 5121, 2: 5123, 4: 5125}[a.dtype.itemsize]}[a.dtype.kind], 'count': len(a), 'type': {1: 'SCALAR', 3: 'VEC3', 4: 'VEC4'}[1 if a.ndim == 1 else a.shape[1]]}
    if a.ndim == 2 and a.shape[1] == 3:
        v.update(min=a.min(0).tolist(), max=a.max(0).tolist())
    doc['accessors'].append(v)
    return n
for side in ['left', 'right']:
    z = np.load(S / f'Bubu_foot-{side}.npz')
    p = z['POSITION'].copy()
    normal = z['NORMAL']
    colors = np.tile([0.48, 0.35, 0.68, 1.0], (len(p), 1)).astype('float32')
    colors[p[:, 1] < 0.045] = [0.57, 0.8, 0.65, 1]
    baseCount = len(p)
    cx = -0.4 if side == 'left' else 0.4
    center = np.array([cx, 0.105, 0.385])
    star = [center + [0, 0, 0.014]]
    for k in range(8):
        angle = k * np.pi / 4
        r = 0.055 if k % 2 == 0 else 0.022
        star.append(center + [np.sin(angle) * r, np.cos(angle) * r, 0])
    star = np.array(star, dtype='float32')
    surface = p[(p[:, 2] > 0.25) & (p[:, 1] < 0.16)]
    for sv in star:
        ni = np.argmin(((surface[:, :2] - sv[:2]) ** 2).sum(1))
        sv[2] = surface[ni, 2] + 0.004
    nearest = np.argmin(((p[:, None, :] - star[None, :, :]) ** 2).sum(2), axis=0)
    joint = np.concatenate([z['JOINTS_0'], z['JOINTS_0'][nearest]])
    weight = np.concatenate([z['WEIGHTS_0'], z['WEIGHTS_0'][nearest]])
    p = np.concatenate([p, star])
    normal = np.concatenate([normal, np.tile([0, 0, 1.0], (9, 1)).astype('float32')])
    colors = np.concatenate([colors, np.tile([0.95, 0.86, 0.58, 1.0], (9, 1)).astype('float32')])
    triangles = np.concatenate([z['triangles'], np.array([[baseCount, baseCount + 1 + k, baseCount + 1 + (k + 1) % 8] for k in range(8)])])
    attrs = {'POSITION': p, 'NORMAL': normal, 'COLOR_0': colors, 'JOINTS_0': joint, 'WEIGHTS_0': weight}
    idx = len(doc['meshes'])
    name = 'boots_' + side
    doc['meshes'].append({'name': name, 'primitives': [{'attributes': {k: attr(v) for k, v in attrs.items()}, 'indices': attr(triangles.astype('uint32').ravel()), 'material': 0}]})
    doc['nodes'].append({'name': name, 'mesh': idx})
    report[side] = {'sourceFoot': f'Bubu_foot-{side}', 'vertices': len(p), 'offset': 0.0, 'groundClamp': float(p[:, 1].min()), 'weightsPreserved': True, 'status': 'native foot shell plus star detail; visual review pending'}
binary.extend(b'\x00' * (-len(binary) % 4))
doc['buffers'] = [{'byteLength': len(binary)}]
j = json.dumps(doc, separators=(',', ':')).encode()
j += b' ' * (-len(j) % 4)
out = struct.pack('<4sII', b'glTF', 2, 28 + len(j) + len(binary)) + struct.pack('<II', len(j), 1313821514) + j + struct.pack('<II', len(binary), 5130562) + binary
(P / 'models/06-boots.glb').write_bytes(out)
(P / 'reports/boots-build.json').write_text(json.dumps(report, indent=2))
