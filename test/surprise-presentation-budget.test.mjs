import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPetPlayer } from '../src/core/pet-player.mjs';
import { createPresentationDirector, PRIORITY_BY_SOURCE } from '../src/core/pet-presentation.mjs';
import { EASTER_EGGS } from '../src/content/behaviors.mjs';
const require = createRequire(import.meta.url);
const { SurpriseDirector } = require('../src/core/surprise-director');
const { defaultCompanionState } = require('../src/core/companion-state');
const { adaptLegacyPetContent } = require('../src/core/content-pack');
const { cueEligibility, selectSurprise } = require('../src/core/surprise-rules');
const { isTimingSession } = require('../src/capabilities/execution/domain/session-state');
const manifest = adaptLegacyPetContent({ EASTER_EGGS });
const dayKey = timestamp => new Date(timestamp).toISOString().slice(0, 10);

function harness() {
  let state = defaultCompanionState(), now = Date.UTC(2026, 9, 12, 20, 42), seq = 0;
  const deliveries = [], timers = [];
  const director = new SurpriseDirector({ manifest, loadState: () => state,
    saveState: next => { state = structuredClone(next); }, clock: { now: () => now, dayKey },
    rng: () => 0, idFactory: () => `decision-${++seq}`,
    deliver: envelope => deliveries.push(envelope),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  return { director, deliveries, timers, state: () => state, setState: next => { state = next; },
    now: () => now, setNow: next => { now = next; } };
}

test('focus, break and paused session bases do not issue cues or reserve their budgets', () => {
  for (const [status, expressionId] of [['focus', 'work.focus'], ['quick-start', 'work.focus'],
    ['break', 'work.rest'], ['paused', 'work.pause']]) {
    const h = harness();
    const presentation = createPresentationDirector();
    presentation.setBase({ expressionId, source: 'session' });
    assert.ok(presentation.current().priority > PRIORITY_BY_SOURCE.cue);
    const result = h.director.tick({ visible: true, sessionActive: isTimingSession({ status }), activityMode: 'balanced' });
    assert.equal(result.issued, false);
    assert.equal(h.deliveries.length, 0);
    assert.equal(h.state().surprise.attentionSpent + h.state().surprise.ambientSpent, 0);
  }
});

test('renderer priority rejection releases an unstarted reservation once and keeps attempt cooldown', () => {
  const h = harness();
  const issued = h.director.tick({ visible: true, activityMode: 'balanced' });
  assert.equal(h.state().surprise.attentionSpent, 1);
  const player = createPetPlayer({ manifest, envelopeClock: { now: h.now },
    acknowledge: ack => h.director.acknowledge(ack), onStart: () => assert.fail('blocked cue started') });
  assert.equal(player.presentCue(issued.envelope, { presentationBlocked: true }).reason, 'presentation-priority');
  assert.equal(h.state().surprise.attentionSpent, 0);
  player.presentCue(issued.envelope, { presentationBlocked: true });
  h.director.acknowledge({ decisionId: issued.envelope.decisionId, status: 'rejected' });
  assert.equal(h.state().surprise.attentionSpent, 0);
  assert.equal(h.state().surprise.recent.length, 1);
  assert.equal(h.director.tick({ visible: true }).issued, false);
  assert.equal(h.state().surprise.lastGlobalAt, h.now());
});

test('started cancellation is charged; received cancellation, TTL and restart release only unstarted reservations', () => {
  for (const terminal of ['cancelled', 'rejected', 'ttl', 'restart']) {
    for (const started of [false, true]) {
      const h = harness(), { envelope } = h.director.tick({ visible: true });
      const ack = status => h.director.acknowledge({ decisionId: envelope.decisionId, status });
      ack('received');
      if (started) ack('started');
      if (terminal === 'restart') h.director.recoverAfterRestart();
      else if (terminal === 'ttl') { h.setNow(envelope.expiresAt); h.timers.at(-1)(); }
      else ack(terminal);
      assert.equal(h.state().surprise.attentionSpent, started ? 1 : 0, `${terminal}/${started}`);
      assert.equal(h.state().surprise.pending, null);
      assert.equal(h.state().surprise.recent.length, 1);
    }
  }
});

test('late rejection cannot refund a newer budget day, and duplicate/out-of-order ACK never changes charge', () => {
  const h = harness();
  h.setNow(Date.UTC(2026, 9, 12, 23, 59, 59));
  const { envelope } = h.director.tick({ visible: true });
  h.setNow(Date.UTC(2026, 9, 13, 0, 0, 1));
  const rolled = selectSurprise({ companion: h.state(), manifest,
    clock: { now: h.now, dayKey }, rng: () => 0 }).state;
  rolled.surprise.attentionSpent = 4;
  h.setState(rolled);
  h.director.acknowledge({ decisionId: envelope.decisionId, status: 'rejected' });
  assert.equal(h.state().surprise.attentionSpent, 4);
  h.director.acknowledge({ decisionId: envelope.decisionId, status: 'started' });
  assert.equal(h.state().surprise.attentionSpent, 4);
});

test('recent repeat protection expires for one, two and five cue pools without bypassing hard gates or cooldown', () => {
  for (const count of [1, 2, 5, 6]) {
    const cues = manifest.cues.slice(0, count), h = harness(), state = h.state();
    state.surprise.recent = cues.map((cue, i) => ({ decisionId: `old-${i}`, cueId: cue.id,
      familyId: cue.familyId, finishedAt: h.now() - 86_400_000, outcome: 'completed' }));
    const selected = selectSurprise({ companion: state, manifest: { cues },
      context: { visible: true }, clock: { now: h.now, dayKey }, rng: () => 0 });
    assert.ok(selected.cue);
    assert.equal(cueEligibility(cues[0], selected.state, { dnd: true }, h.now()), 'dnd');
    selected.state.surprise.recent.at(0).finishedAt = h.now() - 100;
    assert.equal(cueEligibility(cues[0], selected.state, {}, h.now()), 'cue-cooldown');
  }
});

test('a session beginning mid-cue cancels it through the existing player protocol', () => {
  const h = harness(), { envelope } = h.director.tick({ visible: true });
  const player = createPetPlayer({ manifest, envelopeClock: { now: h.now },
    acknowledge: ack => h.director.acknowledge(ack) });
  assert.equal(player.presentCue(envelope).ok, true);
  assert.equal(h.director.updateContext({ visible: true, sessionActive: true }).reason, 'session');
  assert.equal(player.presentCue(h.deliveries.at(-1)).cancelled, true);
  assert.equal(player.snapshot(), null);
});
