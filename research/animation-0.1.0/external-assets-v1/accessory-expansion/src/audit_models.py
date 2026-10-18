import os
import sys, json, hashlib
from pathlib import Path
import numpy as np
import runpy
args=runpy.run_path(str(Path(__file__).resolve().parents[2]/'shared/accessory-paths.py'))['paths'](False)
P=args.accessory
R=args.reference_root
sys.path.insert(0, str(R / 'research/animation-0.1.0/original-parts-hybrid-v1/geometry/tools'))
from split_glb import GLB
report = {}
for file in sorted((args.package / 'accessory-expansion/models').glob('*.glb')):
    g = GLB(file)
    meshes = []
    for i, m in enumerate(g.doc['meshes']):
        for j, _ in enumerate(m['primitives']):
            primitive, a, tri = g.primitive(i, j)
            v = a['POSITION']
            area = np.linalg.norm(np.cross(v[tri[:, 1]] - v[tri[:, 0]], v[tri[:, 2]] - v[tri[:, 0]]), axis=1) / 2
            assert np.isfinite(v).all()
            assert np.isfinite(a['NORMAL']).all()
            assert len(tri) > 0
            meshes.append({'name': m['name'], 'vertices': len(v), 'triangles': len(tri), 'degenerateTriangles': int((area < 1e-12).sum()), 'bounds': [v.min(0).tolist(), v.max(0).tolist()], 'nativeWeights': all((k in a for k in ['JOINTS_0', 'WEIGHTS_0'])), 'materialIndex': primitive.get('material')})
    report[file.name] = {'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size, 'meshes': meshes, 'materials': g.doc.get('materials', [])}
(P / 'reports/model-integrity.json').write_text(json.dumps(report, indent=2))
print({k: sum((x['degenerateTriangles'] for x in v['meshes'])) for k, v in report.items()})
