"""Compact acceptance from external evidence; never copy bulk traces into the repository."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--repo', required=True)
parser.add_argument('--out', required=True, help='Existing external full-production evidence directory')
parser.add_argument('--parity', help='Optional bounded generic-limb/failure parity.json')
parser.add_argument('--lifecycle', help='Existing lifecycle report.json, including prior completed evidence')
args = parser.parse_args()
root, out = Path(args.repo).resolve(), Path(args.out).resolve()
if out == root or root in out.parents:
    raise RuntimeError('Evidence and generated summary must remain outside the repository')
names = ['bare-dpr1-facing1-full', 'bare-dpr1.25-facing-1-full', 'bare-dpr1.5-facing1-full',
         'bare-dpr2-facing-1-full', 'boots-dpr1-facing1-full', 'boots-dpr2-facing-1-full',
         'heavy-dpr2-facing1-full', 'heavy-dpr2-facing-1-calm']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
result = {'schema': 'workout-immutable-geometry-acceptance-v1',
          'scope': 'Integrated production selector/artist/createPetRenderer with local image-port injection; phase matrix leaves generic limbs null. Lifecycle loads real generic limbs and walk adapter. Offscreen Skia, not native desktop acceptance.',
          'matrix': [], 'failures': []}
for name in names:
    file = out / name / 'report.json'
    report = json.loads(file.read_text())
    rows = report['frames']
    assert len(rows) == 510 and [r['frame'] for r in rows] == list(range(510)), name
    assert not report['failures'], (name, report['failures'])
    assert not report.get('smoke', False), name
    assert all(r['bodyIdentical'] and r['draws'] and r['legacyDraws'] for r in rows), name
    assert all(len(r['hands']) == 2 for r in rows), name
    boots = isinstance(report['inputs']['outfit'], list) and 'milestone.boots' in report['inputs']['outfit']
    baseline = 'boot-' if boots else 'foot-'
    hands = [r['hands'][s] for r in rows for s in ['left', 'right']]
    max_error = max(abs(h['soleGeometry']['delta']) for h in hands)
    tolerance = report.get('soleToleranceDevicePixels', 0)
    assert max_error <= tolerance and tolerance == (0.0001 if boots else 0), (name, max_error, tolerance)
    assert all(h['soleGeometry']['legacyBaselineDelta'] == 0 and h['interiorLeak'] == 0 for h in hands), name
    assert all(h['changedPixels'] > 0 for h in hands), name
    pixels = {}
    for side in ['left', 'right']:
        hand = [r['hands'][side] for r in rows]
        foot = [r['boots' if boots else 'feet'][baseline + side] for r in rows]
        assert all(h['changedPixels'] > 0 for h in foot), name
        pixels[side] = {
            'handPositiveAlphaBottoms': sorted({h['bottomBoundaryExclusive'] for h in hand}),
            'baselinePositiveAlphaBottoms': sorted({h['bottomBoundaryExclusive'] for h in foot}),
            'handMajorityAlphaBottoms': sorted({h['majorityBottomBoundaryExclusive'] for h in hand}),
            'baselineMajorityAlphaBottoms': sorted({h['majorityBottomBoundaryExclusive'] for h in foot}),
            'positiveAlphaMismatchFrames': sum(h['bottomBoundaryExclusive'] != f['bottomBoundaryExclusive'] for h, f in zip(hand, foot)),
            'majorityAlphaMismatchFrames': sum(h['majorityBottomBoundaryExclusive'] != f['majorityBottomBoundaryExclusive'] for h, f in zip(hand, foot)),
            'majorityAlphaMismatchFrameIds': [r['frame'] for r, h, f in zip(rows, hand, foot) if h['majorityBottomBoundaryExclusive'] != f['majorityBottomBoundaryExclusive']],
            'maxPositiveAlphaBoundaryDeltaPixels': max(abs(h['bottomBoundaryExclusive'] - f['bottomBoundaryExclusive']) for h, f in zip(hand, foot)),
            'maxMajorityAlphaBoundaryDeltaPixels': max(abs(h['majorityBottomBoundaryExclusive'] - f['majorityBottomBoundaryExclusive']) for h, f in zip(hand, foot)),
            'minimumHandContributingPixels': min(h['changedPixels'] for h in hand),
            'minimumBaselineContributingPixels': min(h['changedPixels'] for h in foot)}
    exits = report['exits']
    assert [e['now'] for e in exits] == [8500, 8600, 9000], name
    assert all(not e['sourceMetadataPresent'] and all(v == 0 for v in e['sourceDiffs'].values()) for e in exits), name
    samples = report.get('resourceSamples', [])
    result['matrix'].append({'id': name, 'inputs': report['inputs'], 'frames': len(rows),
        'bodyIdenticalFrames': len(rows), 'sourceContributionProofs': len(rows) * 4,
        'soleToleranceDevicePixels': tolerance, 'maxHandBaselineSoleDelta': max_error,
        'maxActualLegacyBaselineSoleDelta': 0,
        'handSoleRange': [min(h['soleGeometry']['y'] for h in hands), max(h['soleGeometry']['y'] for h in hands)],
        'opaqueBodyChangedPixelsMax': max(h.get('opaqueBodyChangedPixels', 0) for h in hands),
        'opaqueBodyMaxDelta': max(h.get('opaqueBodyMaxDelta', 0) for h in hands),
        'pixelBoundaries': pixels, 'exitChecks': len(exits), 'failures': 0,
        'resourceObservation': {'samples': len(samples), 'peakSampledRSSBytes': max((s['rss'] for s in samples), default=None),
            'first': samples[0] if samples else None, 'last': samples[-1] if samples else None},
        'rawReportSHA256': sha(file), 'evidenceFile': name + '/report.json',
        'evidenceVersion': report.get('auditVersion', 'prior verified structuredClone+exact-geometry audit; reused without rerun')})
result['totals'] = {'groups': len(result['matrix']), 'frames': sum(g['frames'] for g in result['matrix']),
                    'sourceContributionProofs': sum(g['sourceContributionProofs'] for g in result['matrix']),
                    'exitChecks': sum(g['exitChecks'] for g in result['matrix']), 'failures': 0}
fractional = out / 'fractional-ground/report.json'
if fractional.exists():
    report = json.loads(fractional.read_text())
    result['fractionalGroundDiagnostic'] = {'summary': report['summary'], 'rawReportSHA256': sha(fractional),
        'scope': 'Independent prior 510-frame DPR1.25/- diagnostic; unchanged shared baseline movement and alpha-threshold differences remain disclosed.'}
if args.lifecycle:
    file = Path(args.lifecycle)
    report = json.loads(file.read_text())
    assert not report['failures']
    lifecycle_hashes = file.parent / 'production-input-hashes.json'
    if lifecycle_hashes.exists():
        assert all(sha(root / p) == h for p, h in json.loads(lifecycle_hashes.read_text()).items()), 'Lifecycle production inputs changed'
    result['lifecycle'] = {'scope': report['scope'], 'dpr': report['dpr'], 'rawReportSHA256': sha(file),
        'scenarios': [{k: v for k, v in s.items() if k not in ['rows', 'events']} for s in report['scenarios']],
        'totals': report.get('totals', {key: sum(s[key] for s in report['scenarios']) for key in
            ['frames', 'actionFrames', 'sourceFrames', 'atomicFrames', 'contributionProofs', 'legacyNoContributionFrames', 'idleFrames', 'fallbackFrames', 'zeroOpacitySourceFrames']}),
        'executionNotes': report.get('executionNotes', []), 'failures': 0}
if args.parity:
    file = Path(args.parity)
    parity = json.loads(file.read_text())
    assert not parity['failures']
    assert len(parity['comparisons']) == 8 and len(parity['failedComparisons']) == 8
    assert all(c['identical'] for c in parity['comparisons'] + parity['failedComparisons'])
    result['genericLimbParity'] = {'scope': parity['scope'], 'rawReportSHA256': sha(file),
        'comparisons': parity['comparisons'], 'failedComparisons': parity['failedComparisons'],
        'failedSourceCounters': {mode: parity['variants']['failed']['cacheStats'][mode]['source']['failed']
            for mode in ['failedLeft', 'failedRight']}, 'failures': 0}
execution = out / 'execution-summary.json'
if execution.exists():
    result['execution'] = json.loads(execution.read_text())
paths = ['src/surfaces/pet/controller.mjs', 'src/surfaces/pet/renderer.mjs',
    'src/surfaces/pet/interaction-playback.mjs', 'src/surfaces/pet/action-playback.mjs',
    'src/capabilities/companion/presentation/dango-raster-art.mjs',
    'src/capabilities/companion/presentation/dango-source-contact-pose.mjs',
    'src/capabilities/companion/presentation/dango-workout-contact-pose.mjs',
    'src/capabilities/companion/presentation/dango-raster-actions.mjs',
    'src/capabilities/companion/presentation/dango-raster-paws.mjs',
    'src/capabilities/companion/presentation/dango-raster-appearance.mjs',
    'assets/companion/dango/raster/dango.raster.mjs',
    'assets/companion/dango/raster/action-contact/workout-front-support-v4/left-8x.png',
    'assets/companion/dango/raster/action-contact/workout-front-support-v4/right-8x.png']
source = 'assets/companion/dango/raster/sources/action-contact/workout-front-support-v4/'
paths += [source + name for name in ['generated-v1.png', 'canonical-reference.png', 'prompt.txt', 'provenance.json', 'rebuild.py', 'quantization-audit.json']]
result['productionInputSHA256'] = {p: sha(root / p) for p in paths}
result['interpretation'] = [
    'Bare source sole versus original-foot final CTM is exact zero at each frame; absolute stage ground can still move with the unchanged renderer baseline.',
    'Boot source sole versus final original-boot CTM uses 0.0001 device px for existing 0.8-scale float32 arithmetic. Actual-versus-legacy original sole is exact zero in every group.',
    'Positive-alpha and alpha>=128 boundaries are separate measurements; neither is a universal all-DPR pixel-lock claim.',
    'Resource samples describe this offscreen harness only. Stable sampled production cache counters do not establish absence of native memory leaks.'
]
(out / 'compact-summary.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result['totals']))
