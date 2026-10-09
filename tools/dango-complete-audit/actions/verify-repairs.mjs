import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve('dist/dango-complete-audit/actions/repairs'), entries = [];
for (const name of fs.readdirSync(root).filter(value => value.startsWith('final-')).sort()) {
  const dir = path.join(root, name), record = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8'));
  const file = path.join(dir, record.clip);
  const decoded = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  if (decoded.status !== 0) throw new Error(`${name}: ${decoded.stderr}`);
  const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=nb_frames,r_frame_rate,duration', '-of', 'json', file], { encoding: 'utf8' });
  const stream = JSON.parse(probe.stdout).streams[0];
  if (Number(stream.nb_frames) !== record.frameCount || Math.abs(Number(stream.duration) - record.durationMs / 1000) > 1 / 30) throw new Error(`${name}: normal-speed mismatch`);
  const frames = [];
  for (const progress of [.15, .5, .85]) {
    const destination = `composite-${progress}.png`;
    const sampled = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-ss', String(progress * record.durationMs / 1000), '-i', file,
      '-frames:v', '1', '-y', path.join(dir, destination)], { encoding: 'utf8' });
    if (sampled.status !== 0) throw new Error(`${name}: frame extraction failed`);
    frames.push({ progress, file: destination });
  }
  entries.push({ id: record.id, view: record.videoView, facing: record.videoFacing, directory: name,
    clip: record.clip, durationMs: record.durationMs, frameCount: record.frameCount, decoded: true,
    videoSha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), checks: record.checks, frames, sourceHashes: record.sourceHashes });
}
if (entries.length !== 6) throw new Error(`Expected six final repair clips, found ${entries.length}`);
fs.writeFileSync(path.join(root, 'ledger.json'), JSON.stringify({ entries }, null, 2));
console.log(JSON.stringify({ clips: entries.length, frames: entries.reduce((sum, value) => sum + value.frameCount, 0), decoded: true }));
