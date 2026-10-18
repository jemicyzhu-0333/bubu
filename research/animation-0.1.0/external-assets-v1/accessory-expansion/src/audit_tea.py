import os
import json, sys, importlib.util
from pathlib import Path
import numpy as np
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--cache-root',type=Path,required=True);parser.add_argument('--full',action='store_true');args=parser.parse_args()
P=args.cache_root.resolve()/'accessory';R=args.cache_root.resolve()
spec = importlib.util.spec_from_file_location('collision', Path(__file__).resolve().parents[2]/'shared/tea/triangle-collision.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
full = '--full' in sys.argv
d = json.loads((R / ('tea/reports/normal-30fps-compact.json' if full else 'tea/reports/keyframes-compact.json')).read_text())
sd = json.loads((P / 'review/combined-static.json').read_text())
static = sd['frames'][0]['meshes']
acc = [m for m in static if m['name'].startswith(('cape_', 'boots_', 'halo_'))]
inverse = np.linalg.inv(np.array(sd['sourceToWorld']).reshape(4, 4).T)
for m in acc:
    v = np.array(m['positions']).reshape(-1, 3)
    m['positions'] = (v @ inverse[:3, :3].T + inverse[:3, 3]).ravel().tolist()
capes = [m for m in acc if m['name'].startswith('cape_')]
colliders = [(m['name'], mod.Triangles(np.array(m['positions']).reshape(-1, 3), np.array(m['indices']).reshape(-1, 3))) for m in capes]
report = []
frames = []
for f in d['frames']:
    item = {'time': f['time'], 'phase': f['label'], 'intersections': {}}
    meshes = []
    for m0 in f['meshes']:
        m = {**d['sharedMeshes'].get(m0['name'], {}), **m0}
        if not m['name'].startswith('Bubu_foot-'):
            meshes.append(m)
        if m['name'].startswith(('Bubu_hand', 'Sip_')) and m.get('opacity', 1) > 0:
            v = np.array(m['positions']).reshape(-1, 3) if 'positions' in m else np.fromfile(m['positionsFile'], dtype='<f4').reshape(-1, 3)
            t = v[np.array(m['indices']).reshape(-1, 3)]
            for name, c in colliders:
                count = len(c.intersections(t))
                if count:
                    item['intersections'][m['name'] + '/' + name] = count
    report.append(item)
    if f['time'] in [0, 1.5, 2, 3.4, 4.8, 6.2, 7.5]:
        frames.append({**f, 'meshes': meshes + acc})
(P / ('reports/tea-collision-full.json' if full else 'reports/tea-collision.json')).write_text(json.dumps({'scope': 'Actual tea ' + str(len(d['frames'])) + ' sampled frames; triangle edge intersections, not continuous collision or cloth simulation', 'frames': report, 'allSampledClear': all((not r['intersections'] for r in report))}, indent=2))
(P / 'review/tea-combined.json').write_text(json.dumps({'sourceGLB': d['sourceGLB'], 'frames': frames}))
print(json.dumps(report, indent=2))
