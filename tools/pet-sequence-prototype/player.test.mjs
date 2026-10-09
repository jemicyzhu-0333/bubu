import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSequence, sampleFrame, sequenceTransform, createSequencePlayer } from './player.mjs';
const fixture = () => ({ width: 256, height: 256, anchor: [128, 220], referenceBounds: [38, 40, 180, 180],
  holdPhase: .5, loopMs: 950, frames: Array.from({ length: 8 }, (_, i) => ({ src: `${i}.png`, durationMs: 118.75 })) });
const image = () => ({ width: 256, height: 256 });

test('absolute elapsed sampling skips dropped frames, wraps and freezes a declared phase', () => {
  const manifest = validateSequence(fixture());
  assert.deepEqual([0, 118.75, 800, 950, 951, 95000].map(t => sampleFrame(manifest, t).index), [0, 1, 6, 0, 0, 0]);
  assert.equal(sampleFrame(manifest, -1).index, 7);
  for (const t of [0, 100, 1000, 100000]) assert.equal(sampleFrame(manifest, t, { reducedMotion: true }).index, 4);
  assert.throws(() => sampleFrame(manifest, NaN));
});

test('one reference transform preserves authored position and shape across every frame', async () => {
  const player = createSequencePlayer(fixture(), { loadImage: async () => image() });
  await player.prepare();
  const transform = sequenceTransform(player.manifest, { x: 110, y: 158.5, referenceHeight: 96 });
  const destinations = [];
  const context = { drawImage(_image, ...args) { destinations.push(args); } };
  for (let i = 0; i < 8; i++) assert.equal(player.draw(context, i * 118.75, transform).index, i);
  assert.ok(destinations.every(args => JSON.stringify(args) === JSON.stringify(destinations[0])));
  assert.equal(player.snapshot().decodedBytes, 2097152);
  player.dispose(); assert.equal(player.snapshot().decodedBytes, 0);
});

test('readiness is all-or-nothing, prepare is idempotent, and failed frames are reported', async () => {
  let requests = 0;
  const player = createSequencePlayer(fixture(), { loadImage: async src => {
    requests++; if (src === '2.png') throw new Error('missing source'); return image();
  } });
  assert.equal(player.draw({}, 0, {}).painted, false);
  await Promise.all([player.prepare(), player.prepare()]);
  assert.equal(requests, 8); assert.equal(player.snapshot().status, 'failed');
  assert.equal(player.snapshot().failures[0].index, 2);
  assert.equal(player.draw({}, 500, {}).painted, false);
  player.dispose();
});

test('dispose during decoding releases all late images and does not resurrect the player', async () => {
  const completions = [], released = [];
  const player = createSequencePlayer(fixture(), { loadImage: () => new Promise(resolve => completions.push(resolve)),
    releaseImage: decoded => released.push(decoded) });
  const pending = player.prepare(); player.dispose();
  completions.forEach(resolve => resolve(image())); await pending;
  assert.equal(released.length, 8); assert.equal(player.snapshot().frameCount, 0);
  assert.equal(player.snapshot().status, 'disposed'); assert.equal(player.snapshot().pending, 0);
});

test('duplicate slots, unequal dimensions, excessive memory and inconsistent duration fail closed', async () => {
  const duplicate = fixture(); duplicate.frames[1] = duplicate.frames[0];
  assert.throws(() => validateSequence(duplicate));
  assert.throws(() => validateSequence({ ...fixture(), width: 4096, height: 4096 }));
  assert.throws(() => validateSequence({ ...fixture(), loopMs: 1000 }));
  const player = createSequencePlayer(fixture(), { loadImage: async () => ({ width: 255, height: 256 }) });
  await player.prepare(); assert.equal(player.snapshot().failed, 8); assert.equal(player.snapshot().frameCount, 0);
  player.dispose();
});
