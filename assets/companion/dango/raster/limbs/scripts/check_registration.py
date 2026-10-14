#!/usr/bin/env python3
"""Independent fixed-shoulder/source-alpha validation; no runtime renderer imports."""
from pathlib import Path
from PIL import Image
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = 'socket/front-right-registration.json'
# Canonical source identity accepted before this registration-only revision.
CANONICAL_FRONT_SHA = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9'


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sample_alpha(root, body, world):
    source = Image.open(root / body['src']).convert('RGBA')
    rect = body['rect']
    def at(point):
        u = math.floor((point[0] - rect[0]) * source.width / rect[2])
        v = math.floor((point[1] - rect[1]) * source.height / rect[3])
        return (source.getpixel((u, v))[3]
                if 0 <= u < source.width and 0 <= v < source.height else 0)
    return source, at


def expected_coverage(root, socket):
    # Deliberately independent of rebuild.coverage: scan all 625 output pixels,
    # including all padding, and use canonical source alpha as the sole oracle.
    _, at = sample_alpha(root, socket['sourceBody'], socket['worldRoot'])
    image = Image.new('RGBA', socket['size'])
    rect = socket['usefulLocalRect']
    for y in range(image.height):
        for x in range(image.width):
            if rect[0] <= x < rect[2] and rect[1] <= y < rect[3]:
                world = [socket['worldRoot'][0] - socket['root'][0] + x + .5,
                         socket['worldRoot'][1] - socket['root'][1] + y + .5]
                if at(world):
                    image.putpixel((x, y), (255, 255, 255, 255))
    return image


def validate(root=ROOT):
    manifest = read(root / 'limbs.json')
    sockets = read(root / 'socket/sockets.json')['frames']
    frames = read(root / 'sources/rebuild-recipe.json')['frames']
    contract = read(root / CONTRACT)
    canonical = read(root / contract['sourceReference'])['views']['front']
    assert contract['sourceBody'] == canonical['body'], 'canonical body descriptor'
    assert canonical['body']['sha256'] == CANONICAL_FRONT_SHA, 'canonical body identity'
    assert sha(root / canonical['body']['src']) == CANONICAL_FRONT_SHA, 'canonical body hash'
    anchor = canonical['anchors']['shoulder-right']
    anchor = [anchor['x'], anchor['y']]
    assert anchor == [58.6, 39.712821], 'canonical source anchor'
    assert contract['sourceBodyAnchor'] == anchor, 'source anchor contract'
    assert contract['scope'] == {'kind': 'shoulder', 'view': 'front', 'side': 'r',
                                 'actions': 'all', 'perActionOffsets': False,
                                 'perFrameOffsets': False, 'angleDependentOffsets': False}
    assert contract['priorWorldRoot'] == [61.5, 45.5], 'historical root'
    # Nearest center on the retained one-unit lattice, with no action parameter.
    expected_root = [math.floor(anchor[0]) + .5, contract['priorWorldRoot'][1]]
    assert contract['worldRoot'] == expected_root, 'registered root'
    assert contract['xQuantization'] == {'method': 'nearest-pixel-center', 'gridStep': 1,
                                         'gridOffset': .5, 'input': 58.6,
                                         'output': 58.5, 'error': -.1}
    assert contract['runtimeReady'] is False and contract['hostAcceptsContract'] is None
    assert manifest['extensions']['runtimeReady'] is False
    assert manifest['extensions']['fixedShoulderRegistration'] == CONTRACT
    assert manifest['sockets'] == sockets, 'manifest/socket agreement'
    changed = next(s for s in sockets if (s['kind'], s['view'], s['side'])
                   == ('shoulder', 'front', 'r'))
    assert [s for s in sockets if s is not changed] == contract['unchangedSockets'], 'other sockets changed'
    recipe_patch = next(f for f in frames if f['src'] == changed['src'])
    assert recipe_patch == changed, 'socket recipe agreement'
    cov = next(f for f in frames if f['src'] == changed['coverageStencil'])
    for record in (changed, cov):
        assert record['worldRoot'] == expected_root, 'registered root'
        assert record['sourceBodyAnchor'] == anchor, 'source anchor'
        assert record['sourceBody'] == canonical['body'], 'source body'
        assert record['registrationContract'] == CONTRACT
        assert all(abs(record['anchorOffset'][k] - (expected_root[k] - anchor[k])) < 1e-8
                   for k in (0, 1)), 'registered offset'
        assert record['size'] == [25, 25] and record['root'] == [12.5, 12.5]
        assert record['usefulLocalRect'] == [2, 2, 23, 23]
    source, at = sample_alpha(root, canonical['body'], expected_root)
    assert hashlib.sha256(source.getchannel('A').tobytes()).hexdigest() == contract['coverage']['sourceAlphaSha256']
    # The older bodyAlphaSha256 is the historical 108x86, origin(16,10) body
    # raster hash, not the source-alpha hash and not a coverage-stencil hash.
    raster = bytes(at([x - 16 + .5, y - 10 + .5]) for y in range(86) for x in range(108))
    assert hashlib.sha256(raster).hexdigest() == changed['bodyAlphaSha256'], 'registered body alpha'
    for socket in sockets:
        assert sha(root / socket['sourceBody']['src']) == socket['sourceBody']['sha256'], 'socket source hash'
        expected = expected_coverage(root, socket)
        actual = Image.open(root / socket['coverageStencil']).convert('RGBA')
        assert actual.size == expected.size and actual.tobytes() == expected.tobytes(), 'source-alpha coverage'
        large = Image.open(root / socket['coverageProduction']).convert('RGBA')
        assert large.size == (200, 200)
        assert large.tobytes() == expected.resize((200, 200), Image.Resampling.NEAREST).tobytes(), 'coverage 8x'
    assert cov['sha256'] == changed['coverageSha256'] == sha(root / cov['src']), 'coverage hash'
    for key in ('src', 'productionSrc'):
        assert Image.open(root / changed[key]).getbbox() is None, 'transparent socket patch'
    pivot = Image.new('RGBA', (25, 25)); pivot.putpixel((12, 12), (255, 0, 0, 255))
    assert Image.open(root / changed['pivot']).tobytes() == pivot.tobytes(), 'local pivot'
    prior = contract['priorGoals']
    assert sha(root / prior['src']) == prior['sha256'], 'historical goal identity'
    old_goals = read(root / prior['src'])['poses']
    goals = read(root / 'validation/fixed-shoulder-targets.json')['poses']
    assert len(old_goals) == len(goals) == 40
    by_key = {(g['pose'], g['view'], g['side']): g for g in goals}
    for old, goal in zip(old_goals, goals):
        assert [goal[k] for k in ('pose', 'view', 'side', 'requestedWrist')] == [old[k] for k in ('pose', 'view', 'side', 'requestedWrist')], 'original target moved'
        if goal['view'] == 'front' and goal['side'] == 'right':
            assert goal['fixedShoulder'] == expected_root
        else:
            assert goal == old, 'unaffected goal changed'
        error = [goal['actualWrist'][k] - goal['requestedWrist'][k] for k in (0, 1)]
        assert error == goal['wristErrorVector']
        assert abs(math.hypot(*error) - goal['wristErrorMagnitude']) < 1e-8
    for rig in read(root / 'validation/visual/rig-solutions.json')['poses']:
        current = by_key[rig['pose'], rig['view'], rig['side']]
        for key in ('fixedShoulder', 'requestedWrist', 'actualWrist', 'elbow', 'upperAngle', 'foreAngle', 'wristErrorVector', 'wristErrorMagnitude'):
            assert rig[key] == current[key], ('rig solution agreement', key)
    for preview in read(root / 'validation/visual/registration.json'):
        for rig in preview['rig']:
            current = by_key[rig['pose'], rig['view'], rig['side']]
            for key in ('fixedShoulder', 'requestedWrist', 'actualWrist', 'elbow', 'upperAngle', 'foreAngle'):
                assert rig[key] == current[key], ('preview registration agreement', key)
    return {'sockets': len(sockets), 'coveragePixelsChecked': len(sockets) * 625,
            'fixedGoals': len(goals), 'registeredRoot': expected_root,
            'maxWristError': max(g['wristErrorMagnitude'] for g in goals),
            'runtimeReady': False}


if __name__ == '__main__':
    print(json.dumps(validate(), indent=2))
