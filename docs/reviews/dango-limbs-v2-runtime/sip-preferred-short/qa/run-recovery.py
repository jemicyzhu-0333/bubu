"""Reproduce original-source recovery geometry in 17 bounded, serial workers."""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
if not args.repo.is_absolute() or not args.out.is_absolute():
    parser.error('--repo and --out must be absolute paths')
repo, out = args.repo.resolve(), args.out.resolve()
if out == repo or repo in out.parents:
    parser.error('Place generated audit outputs outside the repository')
out.mkdir(parents=True, exist_ok=True)
script = Path(__file__).resolve().with_name('audit.mjs')
rows = []
completed = []
for start in range(0, 257, 16):
    end = min(start + 15, 256)
    subprocess.run([
        'node', '--expose-gc', str(script), f'--repo={repo}', f'--out={out}',
        '--recovery', '--full',
    ], env={**os.environ, 'AUDIT_START': str(start), 'AUDIT_END': str(end)}, check=True)
    batch = json.loads((out / f'recovery-batch-{start}-{end}.json').read_text())
    if len(batch['rows']) != (end - start + 1) * 4:
        raise RuntimeError(f'Incomplete recovery batch {start}..{end}')
    rows.extend(batch['rows'])
    completed.append({'start': start, 'end': end})
if len(rows) != 1028 or len({r['t'] for r in rows}) != 257:
    raise RuntimeError('Recovery sweep did not cover exactly 257 unique phases')
flat = [{**m, 't': r['t'], 'dpr': r['dpr'], 'side': side}
        for r in rows for side, m in r['unfadedGeometry']['sides'].items()]
summary = {
    'recoverySamples': 257,
    'rasterSamples': len(rows),
    'maxUnfadedContactGap': max(m['contact']['boxGapDevicePx'] for m in flat),
    'rootOutsideBodyPixels': sum(m['rootOutsideBodyPixels'] for m in flat),
    'rootBelow240Pixels': sum(m['rootBodyAlphaBelow240Pixels'] for m in flat),
    'faceOverlapPixels': sum(m['faceOverlapPixels'] for m in flat),
    'failingRootSamples': [{k: m[k] for k in ['t', 'dpr', 'side', 'rootOutsideBodyPixels']}
                           for m in flat if m['rootOutsideBodyPixels']],
}
(out / 'recovery-full-report.json').write_text(json.dumps({
    'status': 'Original-source handoff geometry; genuine opacity and unfaded geometry checked separately',
    'baseline': json.loads((out / 'baseline-manifest.json').read_text()),
    'inputHashes': json.loads((out / 'input-hashes.json').read_text()),
    'batches': completed, 'summary': summary, 'rows': rows,
}, indent=2) + '\n')
print(json.dumps(summary))
