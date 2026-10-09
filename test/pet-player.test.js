'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetPlayer, appendParticles } = require('../src/core/pet-player.mjs');

const manifest = { cues: [
  { id: 'cue.low', familyId: 'family-a', priority: 1, variants: [
    { id: 'default', animationId: 'workout', message: 'move', durationMs: 1000, static: false },
    { id: 'static', animationId: 'static-pose', message: 'still', durationMs: 1000, static: true }
  ] },
  { id: 'cue.high', familyId: 'family-b', priority: 9, variants: [
    { id: 'default', animationId: 'meditate', message: 'high', durationMs: 1000, static: false },
    { id: 'static', animationId: 'static-pose', message: 'high still', durationMs: 1000, static: true }
  ] }
] };

function envelope(cueId, familyId, decisionId = `decision-${cueId}`) {
  return { version: 1, decisionId, cueId, familyId, issuedAt: 0, expiresAt: 10_000, variant: 'default' };
}

function harness() {
  let wallNow = 100;
  let playbackNow = 100;
  const acknowledgements = [];
  const cancellations = [];
  const starts = [];
  const player = createPetPlayer({
    manifest,
    envelopeClock: { now: () => wallNow },
    playbackClock: { now: () => playbackNow },
    acknowledge: ack => acknowledgements.push(ack),
    onStart: cue => starts.push(cue),
    onCancel: (cue, reason) => cancellations.push([cue.cue.id, reason])
  });
  return {
    player,
    acknowledgements,
    cancellations,
    starts,
    setNow(value) { wallNow = value; playbackNow = value; },
    setWallNow(value) { wallNow = value; },
    setPlaybackNow(value) { playbackNow = value; }
  };
}

test('player accepts only manifest IDs and locally downgrades motion', () => {
  const h = harness();
  const played = h.player.presentCue(envelope('cue.low', 'family-a'), { reduceMotion: true });
  assert.equal(played.ok, true);
  assert.equal(played.variant.id, 'static');
  assert.deepEqual(h.acknowledgements.map(item => item.status), ['received', 'started']);
  assert.equal(h.player.presentCue(envelope('cue.unknown', 'family-a', 'decision-unknown')).reason, 'unknown-cue');
  assert.equal(h.acknowledgements.at(-1).status, 'rejected');
});

test('player rejects a queued or late cue while DND is active', () => {
  const h = harness();
  const blocked = h.player.presentCue(envelope('cue.low', 'family-a'), { dnd: true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'dnd');
  assert.equal(h.player.snapshot(), null);
  assert.deepEqual(h.acknowledgements, [{ decisionId: 'decision-cue.low', status: 'rejected' }]);
});

test('player closes local lifecycle and presentation races before starting a cue', () => {
  const contexts = [
    [{ visible: false }, 'not-visible'],
    [{ menuOpen: true }, 'menu-open'],
    [{ dragging: true }, 'dragging'],
    [{ lowStimulation: true }, 'low-stimulation'],
    [{ presentationBlocked: true }, 'presentation-priority']
  ];
  for (const [context, reason] of contexts) {
    const h = harness();
    const result = h.player.presentCue(envelope('cue.low', 'family-a'), context);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(h.player.snapshot(), null);
    assert.equal(h.acknowledgements.at(-1).status, 'rejected');
  }
});

test('higher priority cues preempt while lower priority cues are rejected', () => {
  const h = harness();
  h.player.presentCue(envelope('cue.low', 'family-a'));
  h.player.presentCue(envelope('cue.high', 'family-b'));
  assert.deepEqual(h.cancellations, [['cue.low', 'preempted']]);
  assert.equal(h.player.snapshot().cueId, 'cue.high');
  const lower = h.player.presentCue(envelope('cue.low', 'family-a', 'decision-low-2'));
  assert.equal(lower.reason, 'lower-priority');
});

test('policy cancellation accepts only the fixed local control envelope', () => {
  const h = harness();
  h.player.presentCue(envelope('cue.low', 'family-a'));
  assert.equal(h.player.presentCue({
    version: 1, decisionId: 'decision-cue.low', cancel: true, reason: 'https://example.com'
  }).reason, 'invalid-cancellation');
  assert.equal(h.player.snapshot().cueId, 'cue.low');
  assert.equal(h.player.presentCue({
    version: 1, decisionId: 'decision-cue.low', cancel: true, reason: 'dnd'
  }).cancelled, true);
  assert.equal(h.player.snapshot(), null);
  assert.equal(h.acknowledgements.at(-1).status, 'cancelled');
});

test('duration is elapsed-time based rather than frame-count based', () => {
  const h = harness();
  h.player.presentCue(envelope('cue.low', 'family-a'));
  h.setNow(350);
  assert.equal(h.player.progress(), 0.25);
  h.setNow(850);
  assert.equal(h.player.progress(), 0.75);
  assert.equal(h.player.update(), false);
  h.setNow(1100);
  assert.equal(h.player.update(), true);
  assert.equal(h.acknowledgements.at(-1).status, 'completed');
});

test('a render-clock update closes the same lifecycle exactly once', () => {
  const h = harness();
  const delivered = envelope('cue.low', 'family-a');
  h.player.presentCue(delivered);
  h.setPlaybackNow(1100);
  assert.equal(h.player.update(), true);
  assert.equal(h.player.update(), false);
  assert.equal(h.player.snapshot(), null);
  assert.deepEqual(h.acknowledgements.map(item => item.status), ['received', 'started', 'completed']);

  // An at-least-once delivery can already be queued when the completed ACK
  // crosses processes. It must repeat the terminal ACK, never replay content.
  assert.deepEqual(h.player.presentCue(delivered), {
    ok: true, duplicate: true, terminal: true, status: 'completed'
  });
  assert.equal(h.starts.length, 1);
  assert.equal(h.player.snapshot(), null);
  assert.equal(h.acknowledgements.at(-1).status, 'completed');
});

test('cancelled and rejected decision IDs remain terminal on delayed redelivery', () => {
  const cancelled = harness();
  const cancelledEnvelope = envelope('cue.low', 'family-a');
  cancelled.player.presentCue(cancelledEnvelope);
  cancelled.player.cancelCurrent('interaction');
  assert.equal(cancelled.player.presentCue(cancelledEnvelope).status, 'cancelled');
  assert.equal(cancelled.starts.length, 1);
  assert.equal(cancelled.player.snapshot(), null);

  const rejected = harness();
  const rejectedEnvelope = envelope('cue.low', 'family-a');
  assert.equal(rejected.player.presentCue(rejectedEnvelope, { dnd: true }).reason, 'dnd');
  assert.equal(rejected.player.presentCue(rejectedEnvelope).status, 'rejected');
  assert.equal(rejected.starts.length, 0);
  assert.equal(rejected.player.snapshot(), null);
});

test('wall-clock jumps do not advance or rewind playback', () => {
  const h = harness();
  h.player.presentCue(envelope('cue.low', 'family-a'));
  h.setPlaybackNow(350);
  h.setWallNow(9_999);
  assert.equal(h.player.progress(), 0.25);
  assert.equal(h.player.update(), false);
  h.setWallNow(-50_000);
  assert.equal(h.player.progress(), 0.25);
});

test('particle buffers have a hard newest-first retention cap', () => {
  const particles = Array.from({ length: 20 }, (_, index) => ({ index }));
  assert.deepEqual(appendParticles([], particles, 5).map(item => item.index), [15, 16, 17, 18, 19]);
  assert.equal(appendParticles([], particles, 0).length, 0);
});
