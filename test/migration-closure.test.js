'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { companion, guidance, preferences } = require('../src/capabilities');
const providers = require('../src/core/llm');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const { createPetFrameContext } = require('../src/surfaces/pet/frame-context.mjs');
const { createPetScene } = require('../src/surfaces/pet/scene.mjs');
const { createApplyGuidanceProposalWorkflow, createPopoverStateQuery } = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { localDayKey } = require('../src/core/calendar');
const { SKINS } = require('../src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = require('../src/pet-content');

test('work schedule rules require explicit data and preserve work-hour and TTL boundaries', () => {
  const settings = { ...preferences.DEFAULT_SETTINGS, workStartHour: 10, workEndHour: 21, adhocTtlMode: 'hours', adhocTtlHours: 2 };
  const at = new Date(2026, 8, 12, 10).getTime();
  assert.equal(preferences.workSchedule.isWorkTime(settings, at), true);
  assert.equal(preferences.workSchedule.isWorkTime(settings, new Date(2026, 8, 12, 21).getTime()), false);
  assert.equal(Date.parse(preferences.workSchedule.computeAutoExpiry(at, settings)), at + 7200000);
  assert.deepEqual(preferences.workSchedule.getWorkHours({ workStartHour: 99, workEndHour: 1 }), { start: 22, end: 23 });
});

function previewHarness(overrides = {}) {
  let tasks = [{ id: 'target', title: '写报告', description: '', steps: [] }];
  let release;
  let networkCalls = 0;
  const store = new ProposalStore({ now: () => 1000, idFactory: () => 'proposal-1' });
  const previews = guidance.proposalPreview.createProposalPreview({
    getSettings: () => ({ aiBreakdownEnabled: true, aiModel: 'test-model', aiBaseUrl: 'https://example.invalid/v1' }),
    readTasks: () => structuredClone(tasks),
    credentialStore: { status: () => ({ configured: true }), get: () => 'test' },
    providers: { ...providers, createApiClient: () => ({ id: 'api' }), runWithFallback: async () => {
      networkCalls += 1;
      return new Promise(resolve => { release = () => resolve({
        proposal: guidance.localProposal.deterministicBreakdownProposal({ title: '写报告' }),
        provider: 'api', fallback: false, reason: null
      }); });
    } },
    proposalStore: store, presentExpression: () => 'expression', cancelExpression() {}, scheduleWaiting() {},
    now: () => 1000, requestTtlMs: 180000, trace: { enabled: false, result() {} }, negotiation: new Map(),
    ...overrides
  });
  return { previews, store, change: next => { tasks = next; }, release: () => release(), calls: () => networkCalls };
}

test('AI preview rejects missing targets before I/O and changed targets before storing intent', async () => {
  const harness = previewHarness();
  assert.equal((await harness.previews.previewBreakdownProposal({ taskId: 'missing', title: '写报告' })).reason, 'task-not-found');
  assert.equal(harness.calls(), 0);
  const pending = harness.previews.previewBreakdownProposal({ taskId: 'target', title: '写报告' });
  harness.change([{ id: 'target', title: '不同任务内容', steps: [] }]);
  harness.release();
  assert.equal((await pending).reason, 'proposal-target-changed');
  assert.equal(harness.store.size, 0);
});

test('AI preview retains the existing proposal contract when identity remains fresh', async () => {
  const harness = previewHarness();
  const pending = harness.previews.previewBreakdownProposal({ taskId: 'target', title: '写报告' });
  harness.release();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.ok(result.steps.length > 0);
  assert.equal(harness.store.get(result.proposalId).context.taskId, 'target');
});

test('presentation failures cannot hide a successfully generated and stored proposal', async () => {
  const harness = previewHarness({ presentExpression: () => { throw new Error('window closed'); }, cancelExpression: () => { throw new Error('window closed'); } });
  const pending = harness.previews.previewBreakdownProposal({ taskId: 'target', title: '写报告' });
  harness.release();
  assert.equal((await pending).ok, true);
  assert.equal(harness.store.size, 1);
});

function unstickHarness(overrides = {}) {
  const sent = [];
  return {
    sent,
    ...previewHarness({
      providers: {
        ...providers,
        createApiClient: () => ({ id: 'api' }),
        runWithFallback: async (_client, _fallback, task, payload) => {
          sent.push({ task, payload });
          return {
            proposal: guidance.localProposal.deterministicUnstickProposal({ title: payload.title, steps: payload.steps }),
            provider: 'api', fallback: false, reason: null
          };
        }
      },
      ...overrides
    })
  };
}

test('unstick advice is generated without occupying a proposal slot nobody will ever accept', async () => {
  const harness = unstickHarness();
  const result = await harness.previews.suggestUnstick({ taskId: 'target', note: '卡在：太大了' });
  assert.equal(result.ok, true);
  assert.ok(result.nextAction, 'advice without a next action is not advice');
  assert.equal(result.proposalId, undefined, 'there is no accept step, so there is no id to hand back');
  assert.equal(harness.store.size, 0, 'a stored entry here would sit until it expired');
});

test('unstick reads the task it was asked about instead of trusting what it was handed', async () => {
  const harness = unstickHarness();
  await harness.previews.suggestUnstick({ taskId: 'target', title: '别的标题', steps: ['别的步骤'], note: null });
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].task, 'unstick');
  assert.equal(harness.sent[0].payload.title, '写报告', 'the renderer does not get to choose what leaves the machine');
  assert.deepEqual(harness.sent[0].payload.steps, []);
  assert.equal(harness.sent[0].payload.note, null);
  // 卡了多久是一次专注会话的事实，这一层读不到它：字段已经删掉，不是留一个永远为 null 的。
  assert.equal('stuckDurationMinutes' in harness.sent[0].payload, false);
});

test('unstick refuses a target that vanished before the request and one that changed during it', async () => {
  const missing = unstickHarness();
  assert.equal((await missing.previews.suggestUnstick({ taskId: 'gone' })).reason, 'task-not-found');
  assert.equal(missing.sent.length, 0, 'a refusal must cost nothing');

  let release = null;
  const changed = unstickHarness({
    providers: {
      ...providers,
      createApiClient: () => ({ id: 'api' }),
      runWithFallback: () => new Promise(resolve => { release = () => resolve({
        proposal: guidance.localProposal.deterministicUnstickProposal({ title: '写报告' }),
        provider: 'api', fallback: false, reason: null
      }); })
    }
  });
  const pending = changed.previews.suggestUnstick({ taskId: 'target' });
  changed.change([{ id: 'target', title: '换了内容', steps: [] }]);
  release();
  assert.equal((await pending).reason, 'proposal-target-changed');
});

test('unstick without a selected task still answers, because being stuck predates picking a task', async () => {
  const harness = unstickHarness();
  const result = await harness.previews.suggestUnstick({});
  assert.equal(result.ok, true);
  assert.equal(harness.sent[0].payload.title, null);
  assert.ok(result.nextAction);
});

test('frame snapshots are deeply read-only, detached from controller arrays and reuse immutable content', () => {
  const state = { sceneParticles: [{ x: 1, life: 10 }], state: 'idle' };
  const content = { SCENES: { day: { emitters: [] } } };
  const input = { state, content, now: 10, dt: 16, wallNow: 1000, policy: { calmVisual: true }, stage: { width: 220 } };
  const frame = createPetFrameContext(input);
  assert.throws(() => { frame.state.sceneParticles[0].x = 2; }, TypeError);
  state.sceneParticles[0].x = 4;
  assert.equal(frame.state.sceneParticles[0].x, 1);
  assert.equal(createPetFrameContext(input).content, frame.content);
  assert.throws(() => createPetFrameContext({ ...input, dt: NaN }), /frame clocks/);
});

test('scene limits return results without writing controller-owned particles', () => {
  const scene = createPetScene({ context: {}, art: {}, maxParticles: 1 });
  const particles = Object.freeze([Object.freeze({ life: 2 }), Object.freeze({ life: 3 })]);
  assert.deepEqual(scene.limitParticles(particles), [particles[1]]);
  scene.resetParticles();
  assert.equal(particles.length, 2);
});

test('accepting a guidance proposal invokes one canonical workflow and isolates post-commit feedback failure', () => {
  const calls = [];
  const workflow = createApplyGuidanceProposalWorkflow({
    proposalStore: { get: () => ({ context: { kind: 'breakdown', taskId: 'target' } }) },
    updateWorkItemWorkflow: { execute: input => { calls.push(input); return { ok: true }; } },
    createWorkItemCommand: { execute: () => { throw new Error('unexpected second writer'); } },
    consumeBreakdownProposal: () => { throw new Error('presentation unavailable'); }
  });
  assert.equal(workflow.execute({ proposalId: 'proposal', targetTaskId: 'other' }).reason, 'proposal-target-mismatch');
  assert.equal(calls.length, 0);
  assert.equal(workflow.execute({ proposalId: 'proposal', targetTaskId: 'target', steps: [{ title: 'Step' }], scope: 'current' }).ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].patch.steps, [{ op: 'add', title: 'Step' }]);
});

test('popover projection derives domain data from one detached snapshot and does not mutate it', () => {
  const now = new Date(2026, 8, 12, 12).getTime();
  const state = normalizePersistedState({}, { now });
  const before = structuredClone(state);
  let reads = 0;
  const query = createPopoverStateQuery({
    readSnapshot: () => { reads += 1; return state; }, readRevision: () => 3,
    readSession: () => state.focusSession,
    clock: { now: () => now, dayKey: timestamp => localDayKey(timestamp) }, skins: SKINS, foods: FOODS,
    appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: 8
  });
  const result = query.execute();
  assert.equal(reads, 1);
  assert.equal(result.serverNow, now);
  assert.equal(result.recommendations.generatedAt, now);
  assert.equal(result.revision, 3);
  assert.equal(result.focusMinutes.min, 5);
  assert.deepEqual(state, before);
});

test('the per-day energy curve answers for any day and marks "now" only on the day it falls in', () => {
  // Section 11b. timeline:getDay asks for one arbitrary day, so this entry point cannot
  // assume "today" anywhere. A history curve that carries a nowMinute would point at a
  // moment that never happened on that day.
  const now = new Date(2026, 8, 12, 10, 30).getTime();
  const state = normalizePersistedState({}, { now });
  const query = createPopoverStateQuery({
    readSnapshot: () => state, readRevision: () => 1, readSession: () => state.focusSession,
    clock: { now: () => now, dayKey: timestamp => localDayKey(timestamp) },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: 8
  });

  const today = query.energyCurveForDay('2026-09-12');
  assert.equal(today.dayKey, '2026-09-12');
  assert.equal(today.levels.length, 96);
  assert.equal(today.sampleMinutes, 15);
  assert.equal(today.nowMinute, 630);
  // The same shape the header strip already draws, so one painter can serve both.
  for (const level of today.levels) assert.equal(Number.isInteger(level), true);

  const past = query.energyCurveForDay('2026-09-10');
  assert.equal(past.dayKey, '2026-09-10');
  assert.equal(past.levels.length, 96);
  assert.equal(past.nowMinute, null);
  assert.equal(past.trend, null);
  assert.deepEqual(past.windows, []);

  // The baseline has to follow this person's work hours, not a hardcoded 9am, or a night
  // shift reads as "you are always tired". 06:00 vs 12:00 must not be the same curve.
  const early = { ...state, settings: { ...state.settings, workStartHour: 6 } };
  const earlyQuery = createPopoverStateQuery({
    readSnapshot: () => early, readRevision: () => 1, readSession: () => early.focusSession,
    clock: { now: () => now, dayKey: timestamp => localDayKey(timestamp) },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: 8
  });
  assert.notDeepEqual(earlyQuery.energyCurveForDay('2026-09-12').levels, today.levels);

  // Switch off means no curve at all — not a flat one, which would still be a claim.
  const off = { ...state, settings: { ...state.settings, energyCurveEnabled: false } };
  const offQuery = createPopoverStateQuery({
    readSnapshot: () => off, readRevision: () => 1, readSession: () => off.focusSession,
    clock: { now: () => now, dayKey: timestamp => localDayKey(timestamp) },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: 8
  });
  assert.equal(offQuery.energyCurveForDay('2026-09-12'), null);
  assert.equal(query.energyCurveForDay(''), null);
});

test('the wardrobe projection agrees with the capability and ships ids rather than a second catalog', () => {
  const now = new Date(2026, 8, 12, 12).getTime();
  const state = normalizePersistedState({ level: 9, unlockedSkins: ['pink', 'forest'], currentSkin: 'forest' }, { now });
  const query = createPopoverStateQuery({
    readSnapshot: () => state, readRevision: () => 1, readSession: () => state.focusSession,
    clock: { now: () => now, dayKey: timestamp => localDayKey(timestamp) },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: 8
  });
  const { appearance } = query.execute();
  const selection = companion.appearanceSelection.selectAppearance({
    items: PET_APPEARANCE_ITEMS, level: state.level, unlockedSkins: state.unlockedSkins,
    currentSkin: state.currentSkin, equipped: state.companion.appearance.equipped
  });
  assert.deepEqual(Object.keys(appearance).sort(), ['choices', 'wornIds', 'wornIdsBySkin']);
  assert.deepEqual(appearance.wornIds, selection.worn.map(item => item.id));
  assert.deepEqual(appearance.choices, selection.choices);
  assert.deepEqual(appearance.wornIdsBySkin.forest, appearance.wornIds);
  assert.ok(appearance.wornIdsBySkin.usagi.every(id => id.startsWith('usagi.')));
  // 面板画预览用的是渲染进程已有的那份目录，所以投影里只能出现 id，不能整包配饰跟着每次 delta 复制一遍。
  for (const id of appearance.wornIds) assert.equal(typeof id, 'string');
});
