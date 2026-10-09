'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const guidance = require('../src/capabilities/guidance');
const { buildEnergyCurveView, capturePlanningEstimate } = require('../src/application/queries/energy-curve-view');
const { buildEnergyCurve } = require('../src/core/energy-curve');
const { defaultEnergyBaseline } = require('../src/content/energy-effects.mjs');
const { localDayKey, localDayStart, addDaysToKey } = require('../src/core/calendar');
const { createConsentEnergyHistoryWorkflow } = require('../src/application/workflows/consent-energy-history');
const { createCurrentEnergyReader } = require('../src/bootstrap/energy-reading');
const { createOrganizeInboxWorkflow } = require('../src/application/workflows/organize-inbox');
const { impulseInbox } = require('../src/capabilities/work');
const { planningFixture, repositoryFixture } = require('../test-support/planning-guidance-fixture');

const DAY = '2026-09-20', START = localDayStart(DAY), HOUR = 3600000;
const at = hour => START + hour * HOUR;
const latest = (hour, level) => ({ timestamp: at(hour), level, state: guidance.energyCheckIn.energyStateForLevel(level) });
const event = (hour, level) => ({ at: at(hour), level });
const view = (snapshot, now = at(15), dayKey = DAY) => buildEnergyCurveView({
  snapshot, settings: snapshot.settings, now, dayKey, workStartHour: 9
});
function stateWith(history, checkIn = null) {
  return { ...planningFixture(), energySelfReports: history, energyCheckIn: checkIn };
}
const core = (checkIns, now = at(15), dayKey = DAY) => buildEnergyCurve({
  dayKey, now, baseline: defaultEnergyBaseline({ workStartHour: 9 }), checkIns
});
function assertMatchesCore(actual, expected) {
  assert.deepEqual(actual.levels, expected.samples.map(sample => Math.round(sample.level)));
  assert.equal(actual.nowLevel, expected.nowLevel === null ? null : Math.round(expected.nowLevel));
  assert.equal(actual.confidence, expected.confidence);
}
function consented() {
  const initial = planningFixture();
  initial.settings.workStartHour = 9;
  const f = repositoryFixture(initial);
  f.setTime(at(-24));
  const consent = createConsentEnergyHistoryWorkflow(f);
  const ticket = consent.preview({ enabled: true, clearHistory: false });
  assert.equal(consent.confirm({ previewId: ticket.previewId }).ok, true);
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({ ...f,
    capturePlanningEstimate: (snapshot, timestamp) => capturePlanningEstimate({
      snapshot, settings: snapshot.settings, at: timestamp, dayKey: localDayKey(timestamp), workStartHour: 9
    }) });
  return { ...f, consent, command, record(hour, level) {
    f.setTime(at(hour));
    assert.equal(command.execute({ checkIn: latest(hour, level) }).ok, true);
  } };
}

test('two actual consented commands retain both anchors and all earlier query samples', () => {
  const f = consented(); f.record(9, 20);
  const before = view(f.snapshot(), at(9));
  f.record(14, 80);
  const snapshot = f.snapshot(), commits = f.commits(), after = view(snapshot);
  assert.equal(snapshot.energySelfReports.events.length, 2);
  assert.deepEqual(after.levels.slice(0, 56), before.levels.slice(0, 56));
  assert.equal(after.levels[36], 20); assert.equal(after.levels[56], 80);
  assertMatchesCore(after, core([event(9, 20), event(14, 80)]));
  const read = createCurrentEnergyReader({ readSnapshot: f.snapshot, getSettings: () => snapshot.settings,
    getPomodoro: () => null, now: () => at(15) });
  assert.equal(read().level, after.nowLevel);
  assert.deepEqual(f.snapshot(), snapshot); assert.equal(f.commits(), commits);
  assert.equal(snapshot.energySelfReports.events.every(item => item.estimate !== null), true);
});

test('a retained late report yesterday survives a new report today without rewriting yesterday', () => {
  const f = consented(); f.record(-1, 80);
  const yesterday = addDaysToKey(DAY, -1), before = view(f.snapshot(), at(0), yesterday);
  assert.equal(before.levels[92], 80);
  f.record(9, 20);
  const snapshot = f.snapshot(), after = view(snapshot, at(10), yesterday);
  assert.deepEqual(after.levels, before.levels);
  assert.equal(after.levels[92], 80);
  assertMatchesCore(view(snapshot, at(10)), core([event(-1, 80), event(9, 20)], at(10)));
});

test('missing, null and malformed history safely use only a finite legacy latest without inventing inputs', () => {
  const checkIn = latest(9, 20), expected = view(stateWith(undefined, checkIn));
  for (const history of [undefined, null, 'bad', [], {}, { events: null }, { events: 'bad' },
    { events: [null, {}, [], 'bad', { at: '9', level: 20 }, { at: at(9), level: '20' },
      { at: NaN, level: 20 }, { at: Infinity, level: 20 }, { at: at(9), level: NaN },
      { at: at(9), level: Infinity }, { timestamp: at(9), level: 80 }] }]) {
    const snapshot = stateWith(history, checkIn), saved = structuredClone(snapshot);
    assert.deepEqual(view(snapshot), expected); assert.deepEqual(snapshot, saved);
  }
  assertMatchesCore(view(stateWith(null, null)), core([]));
});

test('timestamp collisions use the last history value and then valid latest, without double correction', () => {
  const history = { events: [event(14, 65), event(9, 20), event(9, 35), event(14, 65)] };
  const snapshot = stateWith(history, latest(14, 80)), saved = structuredClone(snapshot);
  assertMatchesCore(view(snapshot), core([event(9, 35), event(14, 80)]));
  assertMatchesCore(view(stateWith(history, null)), core([event(9, 35), event(14, 65)]));
  assertMatchesCore(view(stateWith(history, { timestamp: at(14), level: NaN })), core([event(9, 35), event(14, 65)]));
  assert.deepEqual(snapshot, saved);
});

test('unordered retained reports are sorted without mutating the original array or event objects', () => {
  const events = [event(14, 80), event(9, 20), event(11, 35)].map(Object.freeze);
  const history = Object.freeze({ consentEnabled: false, events: Object.freeze(events) });
  const snapshot = stateWith(history), saved = structuredClone(snapshot);
  const sorted = stateWith({ events: [event(9, 20), event(11, 35), event(14, 80)] });
  assert.deepEqual(view(snapshot), view(sorted));
  assertMatchesCore(view(snapshot), core(sorted.energySelfReports.events));
  assert.deepEqual(snapshot, saved); assert.equal(snapshot.energySelfReports.events, events);
});

test('finite query time excludes future history and latest from samples and confidence, and includes exact now', () => {
  const snapshot = stateWith({ events: [event(9, 20), event(11, 80)] }, latest(12, 65));
  assertMatchesCore(view(snapshot, at(10)), core([event(9, 20)], at(10)));
  for (const futureOnly of [stateWith({ events: [event(11, 80)] }), stateWith(null, latest(11, 80))]) {
    assertMatchesCore(view(futureOnly, at(10)), core([], at(10)));
    assert.equal(view(futureOnly, at(10)).confidence, 'low');
  }
  assertMatchesCore(view(stateWith({ events: [event(10, 20)] }, latest(10, 80)), at(10)), core([event(10, 80)], at(10)));
});

test('zero and negative finite query times are actual cutoffs; no wall clock substitutes for injected now', () => {
  const oldNow = Date.now;
  Date.now = () => { throw new Error('unexpected wall clock'); };
  try {
    for (const now of [-1, 0]) {
      const dayKey = localDayKey(now);
      const snapshot = stateWith({ events: [{ at: now, level: 20 }, { at: now + 1, level: 80 }] }, { timestamp: now + 1, level: 80 });
      assertMatchesCore(view(snapshot, now, dayKey), core([{ at: now, level: 20 }], now, dayKey));
    }
    for (const now of [null, NaN, Infinity, -Infinity]) {
      assertMatchesCore(view(stateWith({ events: [event(9, 20)] }, latest(14, 80)), now), core([event(9, 20), event(14, 80)], now));
    }
  } finally { Date.now = oldNow; }
});

test('disabling capture retains readable events; explicit clear preserves only legacy latest and never backfills', () => {
  const f = consented(); f.record(9, 20); f.record(14, 80);
  const before = f.snapshot(), beforeView = view(before);
  const disable = f.consent.preview({ enabled: false, clearHistory: false });
  assert.equal(f.consent.confirm({ previewId: disable.previewId }).ok, true);
  assert.deepEqual(view(f.snapshot()), beforeView);
  f.record(15, 65);
  assert.deepEqual(f.snapshot().energySelfReports.events, before.energySelfReports.events, 'disabled command cannot collect another event');
  const clear = f.consent.preview({ enabled: false, clearHistory: true });
  assert.equal(clear.deletionCount, 2); assert.equal(clear.deletesLegacyLatestCheckIn, false);
  assert.equal(f.consent.confirm({ previewId: clear.previewId }).ok, true);
  const cleared = f.snapshot(), commits = f.commits();
  assert.deepEqual(cleared.energySelfReports.events, []); assert.deepEqual(cleared.energyCheckIn, latest(15, 65));
  assertMatchesCore(view(cleared), core([event(15, 65)]));
  assert.notEqual(view(cleared).levels[36], beforeView.levels[36], 'missing history is not an immutable historical snapshot');
  assert.deepEqual(f.snapshot(), cleared); assert.equal(f.commits(), commits);
});

test('explicit adjustment preserves history but repeated and outward-bound observations remain zero writes', () => {
  const f = consented(); f.record(9, 20); f.setTime(at(14));
  const adjustment = guidance.adjustEnergy.createAdjustEnergyCommand({ ...f, currentLevelFor: () => 90 });
  const before = f.snapshot(), commits = f.commits();
  assert.equal(adjustment.execute({ direction: 'higher' }).changed, false);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.commits(), commits);
  assert.equal(adjustment.execute({ direction: 'same' }).changed, true);
  assert.equal(adjustment.execute({ direction: 'same' }).changed, false);
  assert.equal(f.commits(), commits + 1);
  assertMatchesCore(view(f.snapshot()), core([event(9, 20), event(14, 90)]));
});

test('default-off real check-ins remain latest-only and cannot reconstruct absent historical reports', () => {
  const f = repositoryFixture(planningFixture());
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand(f);
  f.setTime(at(9)); command.execute({ checkIn: latest(9, 20) });
  const first = view(f.snapshot(), at(9));
  f.setTime(at(14)); command.execute({ checkIn: latest(14, 80) });
  const saved = f.snapshot();
  assert.equal(saved.energySelfReports.consentEnabled, false);
  assert.deepEqual(saved.energySelfReports.events, []);
  assertMatchesCore(view(saved), core([event(14, 80)]));
  assert.notEqual(view(saved).levels[36], first.levels[36]);
});

test('actual inbox state confirmation can update legacy latest but cannot capture self-report history', () => {
  const f = consented(); f.record(9, 20); f.setTime(at(10));
  const history = f.snapshot().energySelfReports;
  f.mutate(state => {
    state.impulses = [];
    impulseInbox.captureImpulse(state, { text: 'Synthetic state', createdAt: at(10) }, { createId: () => 'synthetic-inbox' });
  });
  const workflow = createOrganizeInboxWorkflow({ ...f, profiles: {} });
  assert.equal(workflow.execute({ id: 'synthetic-inbox', action: 'state', category: 'state', level: 65 }).ok, true);
  const saved = f.snapshot();
  assert.deepEqual(saved.energySelfReports, history);
  assert.deepEqual(saved.energyCheckIn, latest(10, 65));
  assertMatchesCore(view(saved), core([event(9, 20), event(10, 65)]));
});
