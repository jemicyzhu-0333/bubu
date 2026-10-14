#!/usr/bin/env python3
"""Re-solve only the revised fixed socket; preserve all original world-space goals.

Offline policy: nearest wrist, then smallest exposed segment-alpha union, then
body-covered centerline, bend and angle order. This is not the runtime policy.
"""
from pathlib import Path
from PIL import Image
import argparse
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
HISTORY = 'sources/evidence/shoulder-registration-v1/'


def read(path):
    return json.loads(path.read_text())


def body_sampler(root, descriptor):
    path = root / descriptor['src']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == descriptor['sha256']
    source = Image.open(path).convert('RGBA')
    rect = descriptor['rect']
    def inside(point):
        # Test canonical raster pixel containing this point, not a new body shift.
        x, y = [math.floor(z) + .5 for z in point]
        u = math.floor((x - rect[0]) * source.width / rect[2])
        v = math.floor((y - rect[1]) * source.height / rect[3])
        return (0 <= u < source.width and 0 <= v < source.height
                and source.getpixel((u, v))[3] > 0)
    return inside


def solve(root, original, socket):
    vectors = original['segmentFrames']
    frames = read(root / 'sources/rebuild-recipe.json')['frames']
    by_angle = {(f['semantic']['segment'], f['angle']): f for f in frames
                if f['semantic']['kind'] == 'segment'}
    inside = body_sampler(root, socket['sourceBody'])
    points = {}
    for (kind, angle), frame in by_angle.items():
        image = Image.open(root / frame['src']).convert('RGBA')
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        pivot = [image.width - frame['root'][0], frame['root'][1]]
        points[kind, (180 - angle) % 360] = [
            (x + .5 - pivot[0], y + .5 - pivot[1])
            for y in range(image.height) for x in range(image.width)
            if image.getpixel((x, y))[3]]
    result = json.loads(json.dumps(original))
    for target in result['poses']:
        if target['view'] != 'front' or target['side'] != 'right':
            continue
        shoulder, goal = socket['worldRoot'], target['requestedWrist']
        candidates = []
        for upper in vectors:
            for fore in vectors:
                bend = abs((upper['angle'] - fore['angle'] + 180) % 360 - 180)
                if bend > 150:
                    continue
                elbow = [shoulder[k] + upper['delta'][k] for k in (0, 1)]
                wrist = [elbow[k] + fore['delta'][k] for k in (0, 1)]
                error = math.dist(wrist, goal)
                buried = sum(inside([a[k] + (b[k] - a[k]) * j / 8 for k in (0, 1)])
                             for a, b in [(shoulder, elbow), (elbow, wrist)]
                             for j in range(9))
                candidates.append((error, -buried, bend, upper['angle'],
                                   fore['angle'], elbow, wrist))
        def exposed(candidate):
            union = set()
            for kind, world, angle in [('upper', shoulder, candidate[3]),
                                       ('fore', candidate[5], candidate[4])]:
                union.update((world[0] + x, world[1] + y)
                             for x, y in points[kind, angle])
            return sum(not inside(pixel) for pixel in union)
        nearest = min(c[0] for c in candidates)
        ties = [c for c in candidates if abs(c[0] - nearest) < 1e-8]
        best = min(ties, key=lambda c: (exposed(c), c[1], c[2], c[3], c[4]))
        target.update(fixedShoulder=list(shoulder), actualWrist=best[6],
                      wristErrorVector=[best[6][k] - goal[k] for k in (0, 1)],
                      wristErrorMagnitude=best[0], upperAngle=best[3],
                      foreAngle=best[4], elbow=best[5], bend=best[2],
                      centerlineSamplesWithinBody=-best[1],
                      exposedSegmentPixelsBeforeSocketClipping=exposed(best))
    result['registrationContract'] = 'socket/front-right-registration.json'
    result['limitations'] = ('Original world-space goals and all other socket registrations are preserved. '
                            'Only front/right solutions are recomputed using current exported segments. '
                            'No prop or body moves to absorb the discrete wrist error. '
                            'These offline solutions do not certify physical contact or runtime admission.')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    socket = next(s for s in read(ROOT / 'socket/sockets.json')['frames']
                  if (s['kind'], s['view'], s['side']) == ('shoulder', 'front', 'r'))
    outputs = [('previous-fixed-shoulder-targets.json', 'validation/fixed-shoulder-targets.json'),
               ('previous-visual/rig-solutions.json', 'validation/visual/rig-solutions.json')]
    for source, destination in outputs:
        result = solve(ROOT, read(ROOT / HISTORY / source), socket)
        if args.verify:
            assert result == read(ROOT / destination), destination
        else:
            (ROOT / destination).write_text(json.dumps(result, indent=2) + '\n')
    goals = read(ROOT / 'validation/fixed-shoulder-targets.json')['poses']
    worst = max(goals, key=lambda p: p['wristErrorMagnitude'])
    print(json.dumps({'goals': len(goals), 'recomputed': 10,
                      'worst': {k: worst[k] for k in ['pose', 'view', 'side', 'wristErrorMagnitude']},
                      'canonicalCup': [{k: p[k] for k in ['side', 'requestedWrist', 'actualWrist', 'wristErrorMagnitude']}
                                       for p in goals if p['pose'] == 'hold-canonical-cup'],
                      'verified': args.verify}, indent=2))


if __name__ == '__main__':
    main()
