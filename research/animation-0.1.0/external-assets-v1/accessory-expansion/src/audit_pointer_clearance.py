import os
import json, importlib.util
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation
import runpy
args=runpy.run_path(str(Path(__file__).resolve().parents[2]/'shared/accessory-paths.py'))['paths'](True)
P=args.accessory
R=args.reference_root
spec = importlib.util.spec_from_file_location('collision', args.package / 'shared/tea/triangle-collision.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
sd = json.loads((P / 'review/combined-static.json').read_text())
base = np.array(sd['sourceToWorld']).reshape(4, 4).T
inv = np.linalg.inv(base)
colliders = []
for m in sd['frames'][0]['meshes']:
    if not m['name'].startswith(('cape_', 'halo_')):
        continue
    v = np.array(m['positions']).reshape(-1, 3)
    v = v @ inv[:3, :3].T + inv[:3, 3]
    colliders.append((m['name'], mod.Triangles(v, np.array(m['indices']).reshape(-1, 3))))
assert colliders, 'Missing actual cape/halo colliders'
report = {}
(P/'reports/pointer-clearance.json').unlink(missing_ok=True)
for kind in ['drag', 'longpress']:
    d = json.loads((args.pointer_root / f'{kind}/manifest.json').read_text())
    records = json.loads((args.pointer_root / f'{kind}/trajectory.json').read_text())
    assert d.get('frames') and records, 'No actual pointer mesh frames: run actual-pointer-regression --windows-only or --full-export; numeric-only evidence cannot prove clearance'
    rows = []
    for frame in d['frames']:
        r = min(records, key=lambda r: abs(r['time'] - frame['time']))
        assert abs(r['time'] - frame['time']) < 1e-07
        pose = np.eye(4)
        pose[:3, :3] = Rotation.from_quat(r['body']['pivot']).as_matrix()
        pose[:3, 3] = r['body']['root']
        inverse = np.linalg.inv(pose @ base)
        hits = {}
        hands = [m for m in frame['meshes'] if m['name'].startswith('Bubu_hand')]
        assert len(hands)==2, 'Both actual original hand meshes required'
        for m in frame['meshes']:
            if not m['name'].startswith('Bubu_hand'):
                continue
            positions=Path(m['positionsFile'])
            if not positions.is_absolute(): positions=args.pointer_root/kind/positions
            v = np.fromfile(positions, dtype='<f4').reshape(-1, 3)
            assert len(v)>0 and np.isfinite(v).all(), 'Empty/nonfinite hand mesh'
            v = v @ inverse[:3, :3].T + inverse[:3, 3]
            t = v[np.array(d['topology'][m['name']]['indices']).reshape(-1, 3)]
            for name, c in colliders:
                count = len(c.intersections(t))
                if count:
                    hits[m['name'] + '/' + name] = count
        rows.append({'time': frame['time'], 'intersections': hits})
    report[kind] = {'sampledFrames': len(rows), 'allSampledClear': all((not r['intersections'] for r in rows)), 'hits': [r for r in rows if r['intersections']]}
(P / 'reports/pointer-clearance.json').write_text(json.dumps({'scope': 'Actual previously exported pointer-host mesh frames; world-to-source transform; triangle edge intersections, no continuous cloth simulation', 'scenarios': report}, indent=2))
print(report)
