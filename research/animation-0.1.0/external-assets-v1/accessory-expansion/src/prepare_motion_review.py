import os
import json
from pathlib import Path
import runpy
args=runpy.run_path(str(Path(__file__).resolve().parents[2]/'shared/accessory-paths.py'))['paths'](True)
P=args.accessory
R=args.reference_root
(P/'review/combined-motion.json').unlink(missing_ok=True)
data = json.loads((P / 'review/trajectory-keyframes.json').read_text())
records = {k: json.loads((args.pointer_root / f'{k}/manifest.json').read_text()) for k in ['drag', 'longpress']}
assert all(d.get('frames') for d in records.values()), 'No actual pointer mesh frames: run actual-pointer-regression --windows-only or --full-export'
frames = []
for f in data['frames']:
    if not f['label'].endswith('-combined'):
        continue
    kind = f['label'].split('-')[0]
    d = records[kind]
    prior = min(d['frames'], key=lambda p: abs(p['time'] - f['time']))
    assert abs(prior['time'] - f['time']) < 1e-08
    faces = [{**d['topology'][m['name']], **m} for m in prior['meshes'] if m['name'].startswith('A_') and m['name'] != 'A_mochi_skin']
    assert len(faces) == 8
    frames.append({**f, 'meshes': f['meshes'] + faces})
assert frames, 'No combined motion frames generated'
(P / 'review/combined-motion.json').write_text(json.dumps({'sourceGLB': data['sourceGLB'], 'frames': frames}))
print('Actual existing face binary frames restored to', len(frames), 'motion review keys')
