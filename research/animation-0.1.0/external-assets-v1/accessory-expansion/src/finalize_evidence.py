import hashlib
import json
from pathlib import Path
P = Path(__file__).resolve().parents[1]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
models = {p.name: sha(p) for p in sorted((P / 'models').glob('*.glb'))}
foot = json.loads((P / 'reports/footwear-full-vertex-audit.json').read_text())
assert foot['testedBootsSHA256'] == models['06-boots.glb']
assert all(s['allFootVerticesChecked'] and s['maxShoeOffset'] == 0 for s in foot['scenarios'].values())
tea = json.loads((P / 'reports/tea-collision-full.json').read_text())
assert len(tea['frames']) == 271 and tea['allSampledClear']
pointer = json.loads((P / 'reports/pointer-clearance.json').read_text())
assert all(s['allSampledClear'] for s in pointer['scenarios'].values())
summary = {
    'status': 'research-host-installable; final user batch acceptance pending',
    'models': models,
    'originalFootVertexChecks': {'drag': 271, 'longpress': 1891, 'maxWorldCoordinateDifference': 0, 'minimumRelativeGround': -1.1102230246251565e-16, 'groundTolerance': 1e-6, 'starVerticesIncludedInGroundCheck': True},
    'triangleCollisionSamples': {'drag': 142, 'longpress': 218, 'tea': 271, 'intersections': 0, 'notContinuousCollision': True},
    'teaCoordinateProof': 'reports/tea-coordinate-proof.json',
    'lifecycleProof': 'reports/lifecycle-edge-cases.json',
    'visualReview': {'rootStaticApproved': ['halo', 'boots', 'cape'], 'size': '99 CSS main-body width and 2x, light/dark composites', 'combinedMotionKeys': 6, 'combinedTeaKeys': 7},
    'remaining': ['production wardrobe integration', 'other wardrobe combinations', 'browser WebGL', 'native desktop', 'original semantic effects dispatch', 'final user batch acceptance'],
    'scope': 'Only original migration items 05–07. No new action design, remote push or publication.',
    'scripts': {p.name: sha(p) for p in sorted((P / 'src').glob('*')) if p.is_file() and p.name not in ['format_local.py', 'build_models-previous.py']},
}
(P / 'reports/FINAL-EVIDENCE.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
allow = ['PROVENANCE.json', 'README.md', 'attach-manifest.json', 'reports/FINAL-EVIDENCE.json']
allow += [str(p.relative_to(P)) for p in sorted((P / 'models').glob('*.glb'))]
allow += [str(p.relative_to(P)) for p in sorted((P / 'references').glob('*')) if p.is_file()]
allow += [str(p.relative_to(P)) for p in sorted((P / 'src').glob('*')) if p.is_file() and p.name not in ['format_local.py', 'build_models-previous.py']]
for name in ['model-integrity.json', 'footwear-full-vertex-audit.json', 'host-audit.json', 'lifecycle-edge-cases.json', 'tea-collision-full.json', 'tea-coordinate-proof.json', 'pointer-clearance.json', 'native-size-review.json']:
    allow.append('reports/' + name)
for item in ['halo', 'boots', 'cape']:
    for suffix in ['actual-fourviews', 'isolated-fourviews', '99css-light', '99css-dark']:
        allow.append(f'review/{item}-{suffix}.png')
for file in ['combined-actual-fourviews.png', 'combined-99css-light.png', 'combined-99css-dark.png', 'combined-motion-sheet.png', 'tea-combined-sheet.png']:
    allow.append('review/' + file)
allow = sorted(set(allow))
assert all((P / p).is_file() for p in allow)
(P / 'CANDIDATE-ALLOWLIST.txt').write_text('\n'.join(allow) + '\n')
(P / 'CANDIDATE-SHA256SUMS').write_text('\n'.join(sha(P / p) + '  ' + p for p in allow) + '\n')
print(json.dumps({'files': len(allow), 'bytes': sum((P / p).stat().st_size for p in allow), 'models': models}, indent=2))
