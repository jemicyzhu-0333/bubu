"""Conservative endpoint exclusion certificate, not a motion/garment admission.

For exact root/grip anchors every rigid hand orientation is a twist about their
axis. Cover that circle by 2-degree cells. An interior material pin with distance
D from the closed hand surface cannot exit if all boundary motion is < D.

If BOTH anchors may move by epsilon, the target axis differs by at most 2 epsilon.
Its length L is invariant, hence sin(swing/2) <= epsilon/L. Relative to some exact
anchor twist, every hand vertex moves by at most epsilon + 2 R epsilon/L, where
R bounds distance from the root. Add the angular cell bound and numerical margin.
This includes arbitrary rotations and translations within the stated endpoint
anchor balls. It does not constrain or prove anything about larger refits.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation

FOUNDATION = Path(__file__).resolve().parents[1]
RESEARCH = FOUNDATION.parent
BUNDLE = FOUNDATION / 'integration/diagnostics/contact-contract-20261019'
ANGLE_STEP_DEG = 2.0
ANCHOR_TOLERANCE = 0.01
NUMERICAL_MARGIN = 1e-6


def winding(point, triangles):
    vectors = triangles - point
    lengths = np.linalg.norm(vectors, axis=2)
    a, b, c = vectors[:, 0], vectors[:, 1], vectors[:, 2]
    numerator = (a * np.cross(b, c)).sum(1)
    denominator = (lengths.prod(1) + (a*b).sum(1)*lengths[:, 2]
                   + (b*c).sum(1)*lengths[:, 0] + (c*a).sum(1)*lengths[:, 1])
    return np.arctan2(numerator, denominator).sum() / (2*np.pi)


def surface_distance(point, triangles):
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    ab, ac, ap = b-a, c-a, point-a
    d00, d01, d11 = (ab*ab).sum(1), (ab*ac).sum(1), (ac*ac).sum(1)
    d20, d21 = (ap*ab).sum(1), (ap*ac).sum(1)
    den = d00*d11-d01*d01
    u = np.divide(d11*d20-d01*d21, den, out=np.zeros_like(den), where=abs(den)>1e-20)
    v = np.divide(d00*d21-d01*d20, den, out=np.zeros_like(den), where=abs(den)>1e-20)
    distance = np.linalg.norm(ap-u[:, None]*ab-v[:, None]*ac, axis=1)
    distance[(u<0)|(v<0)|(u+v>1)|(abs(den)<1e-20)] = np.inf
    for x, y in [(a, b), (b, c), (c, a)]:
        edge = y-x
        norm = (edge*edge).sum(1)
        t = np.clip(np.divide(((point-x)*edge).sum(1), norm,
                             out=np.zeros_like(norm), where=norm>1e-20), 0, 1)
        distance = np.minimum(distance, np.linalg.norm(point-x-t[:, None]*edge, axis=1))
    return float(distance.min())


def verify_closed(vertices, indices):
    _, inverse = np.unique(vertices, axis=0, return_inverse=True)
    triangles = inverse[indices]
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    assert np.all(edges[:, 0] != edges[:, 1]), 'Degenerate topology'
    _, inverse, counts = np.unique(np.sort(edges, axis=1), axis=0, return_inverse=True, return_counts=True)
    assert np.all(counts == 2), 'Hand must be closed'
    signs = np.bincount(inverse, weights=np.where(edges[:, 0] < edges[:, 1], 1, -1))
    assert np.all(signs == 0), 'Hand winding must be consistent'


def run():
    inputs = {}
    def read(path):
        data = path.read_bytes()
        inputs[str(path.relative_to(RESEARCH))] = hashlib.sha256(data).hexdigest()
        return data
    data = json.loads(read(BUNDLE/'inputs/tea-keyframes.json'))
    motion = json.loads(read(BUNDLE/'motion.json'))
    config = json.loads(read(RESEARCH/'original-parts-hybrid-v1/tea/inputs/rigid-config.json'))
    coarse = json.loads(read(BUNDLE/'inputs/cape-coarse.json'))
    pins = np.array(coarse['positions']).reshape(-1, 3)[coarse['pins']]
    rows = []
    for time in [1.5, 3.4]:
        for short, name in [('handL', 'Bubu_hand-left'), ('handR', 'Bubu_hand-right')]:
            frame = next(f for f in data['frames'] if f['time'] == time)
            mesh = next(m for m in frame['meshes'] if m['name'] == name)
            positions = np.frombuffer(read(BUNDLE/mesh['positionsFile']), dtype='<f4').reshape(-1, 3).astype(float)
            indices = np.array(data['sharedMeshes'][name]['indices']).reshape(-1, 3)
            verify_closed(positions, indices)
            triangles = positions[indices]
            matrix = np.array(next(m for m in motion if m['time'] == time)['matrices'][short]).reshape(4, 4).T
            root = matrix[:3, :3]@config['hands'][short]['root']+matrix[:3, 3]
            grip = matrix[:3, :3]@config['hands'][short]['gripSource']+matrix[:3, 3]
            axis = grip-root
            length = np.linalg.norm(axis)
            assert length > 2*ANCHOR_TOLERANCE
            axis /= length
            radius = float(np.linalg.norm(positions-root, axis=1).max())
            near_indices = np.flatnonzero(np.linalg.norm(pins-root, axis=1) <= radius+ANCHOR_TOLERANCE)
            angular_bound = 2*radius*np.sin(np.deg2rad(ANGLE_STEP_DEG/2)/2)
            anchor_bound = ANCHOR_TOLERANCE*(1+2*radius/length)
            bound = angular_bound+anchor_bound+NUMERICAL_MARGIN
            cells = []
            for angle in np.arange(-180, 180, ANGLE_STEP_DEG):
                rotation = Rotation.from_rotvec(axis*np.deg2rad(angle)).as_matrix()
                local_pins = (pins[near_indices]-root)@rotation+root
                witnesses = [(surface_distance(point, triangles), int(coarse['pins'][index]))
                             for point, index in zip(local_pins, near_indices)
                             if abs(winding(point, triangles)) > 0.5]
                depth, particle = max(witnesses, default=(0., None))
                cells.append({'centerDegrees': float(angle), 'pinParticle': particle,
                              'depth': depth, 'certifiedMargin': float(depth-bound)})
            rows.append({'time': time, 'hand': name, 'radius': radius,
                         'rootGripDistance': float(length), 'angleCellMotionBound': float(angular_bound),
                         'anchorMotionBound': float(anchor_bound), 'closedConsistentTopology': True,
                         'minimumCertifiedMargin': min(c['certifiedMargin'] for c in cells),
                         'allTwistsExcluded': all(c['certifiedMargin'] > 0 for c in cells), 'cells': cells})
    return {'schema': 'bubu-endpoint-exclusion/1', 'productionAccepted': False,
            'scope': 'Frozen round5 cape pins; hold/sip endpoints; rigid unchanged hands; both root and source grip within tolerance balls of existing endpoint targets',
            'anchorTolerance': ANCHOR_TOLERANCE, 'angularCellDegrees': ANGLE_STEP_DEG,
            'numericalMargin': NUMERICAL_MARGIN, 'inputs': inputs, 'rows': rows,
            'fixedAttachmentFeasible': False if all(r['allTwistsExcluded'] for r in rows) else None,
            'limits': ['Not a certificate for greater anchor displacement, garment deformation, or another garment.',
                       'No compatibility, real-time cloth, visual or native acceptance is granted.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(RESEARCH):
        parser.error('Output must be outside research sources')
    report = run()
    report['scriptSHA256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({'output': str(output), 'fixedAttachmentFeasible': report['fixedAttachmentFeasible'],
                      'margins': [r['minimumCertifiedMargin'] for r in report['rows']]}))
    sys.exit(0 if report['fixedAttachmentFeasible'] is False else 1)
