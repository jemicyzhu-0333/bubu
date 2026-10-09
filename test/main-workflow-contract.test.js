'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWorkBoundaryReminder } = require('../src/bootstrap/work-boundary-reminder');
const execution = require('../src/capabilities/execution');
const {
  createIdleSession,
  startFocus
} = execution.focusSession;
const { completionBenefits } = require('../src/capabilities/companion');
const { addDaysToKey, compareDayKeys } = require('../src/core/calendar');
const {
  createRewardEvent,
  createRewardLedger,
  recordReward,
  taskCompletionRewardId,
  stepCompletionRewardId
} = require('../src/core/reward-ledger');
const { normalizeCompanionState } = require('../src/core/companion-state');
const relationshipProjection = require('../src/capabilities/companion').relationshipProjection;

const ROOT = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
const petSource = fs.readdirSync(path.join(ROOT, 'src/surfaces/pet')).filter(file => file.endsWith('.mjs'))
  .map(file => fs.readFileSync(path.join(ROOT, 'src/surfaces/pet', file), 'utf8')).join('\n');
const petMenuSource = fs.readFileSync(path.join(ROOT, 'src/surfaces/pet/menu.mjs'), 'utf8');
const petHtml = fs.readFileSync(path.join(ROOT, 'src/renderer/pet.html'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function loadFunctions(source, names, sandbox = {}) {
  const environment = { ...sandbox };
  if (environment.store && typeof environment.store.snapshot !== 'function') {
    environment.store.snapshot = () => environment.store.store;
  }
  environment.materializeDueReviews ||= () => [];
  // refreshAggregatedMemories sits above runDailyReset on purpose: the slice
  // below must stay free of Date.now. It is therefore outside the loaded source.
  environment.refreshAggregatedMemories ||= () => undefined;
  const context = vm.createContext(environment);
  const exportsExpression = names.map(name => `${name}: typeof ${name} === 'function' ? ${name} : null`).join(',');
  new vm.Script(`${source}\nglobalThis.__tested = { ${exportsExpression} };`).runInContext(context);
  for (const name of names) assert.equal(typeof context.__tested[name], 'function', `${name} must load from production source`);
  return { context, ...context.__tested };
}

test('the local-day scheduler is only a thin adapter over its application workflow', () => {
  const outcomes = [
    { ok: true, mode: 'advance', dayKey: '2026-08-29', archivedCount: 3 },
    { ok: false, reason: 'day-already-reset' },
    { ok: false, reason: 'reset-marker-ahead' }
  ];
  const source = sourceBetween(mainSource, 'function runDailyReset(', '\n\n// ============ 到点收工提醒');
  const { runDailyReset } = loadFunctions(source, ['runDailyReset'], {
    runDailyResetWorkflow: { execute: () => outcomes.shift() }
  });

  // Repeating the day and rolling the clock back are ordinary outcomes, so the
  // adapter reports nothing archived rather than treating them as failures.
  assert.equal(runDailyReset(), 3);
  assert.equal(runDailyReset(), 0);
  assert.equal(runDailyReset(), 0);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|clonePersistedState|pushStateChange|showNotification|refreshSeriesOccurrences|expireDueTasks/
  );
});

test('companion care is no longer written by main-process helper functions', () => {
  assert.doesNotMatch(mainSource, /function (?:applySatiationDecay|regenerateFoodDaily|resetDailyFeedXpIfNeeded)\(/);
  assert.doesNotMatch(mainSource, /function setPetData\(/);
  assert.doesNotMatch(mainSource, /maintainCompanionCare|applySatiationDecay|coffeeBonusUntil/);
});

test('the task-expiry scheduler is only a thin adapter over its application workflow', () => {
  const calls = [];
  const source = sourceBetween(mainSource, 'function expireDueTasks(', '\n// schema 8 的迁移器');
  const { expireDueTasks } = loadFunctions(source, ['expireDueTasks'], {
    expireWorkItemsWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, expiredCount: input.notify ? 2 : 1 };
      }
    }
  });

  assert.equal(expireDueTasks({ notify: false }), 1);
  assert.equal(expireDueTasks(), 2);
  assert.deepEqual(calls.map(call => ({ ...call })), [{ notify: false }, { notify: true }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|taskStartBlockReason|pushStateChange|showPrivateTaskNotification/
  );
});

test('the reservation watcher keeps only the DND gate and delegates the write', () => {
  const calls = [];
  const outcomes = [
    { ok: true, activatedCount: 2 },
    { ok: false, reason: 'state-revision-conflict' }
  ];
  const source = sourceBetween(
    mainSource,
    'function activateScheduledTasks(',
    '\n\n// ============ PERSISTED FOCUS SESSION'
  );
  let dnd = true;
  const { activateScheduledTasks } = loadFunctions(source, ['activateScheduledTasks'], {
    getSettings: () => ({ dnd }),
    activateScheduledWorkCommand: {
      execute: input => {
        calls.push({ ...input });
        return outcomes.shift();
      }
    }
  });

  // Silence must not consume the reservation: nothing is written while DND is on,
  // so the tick after it clears can still wake the same tasks.
  assert.equal(activateScheduledTasks(1_000), 0);
  assert.deepEqual(calls, []);

  dnd = false;
  assert.equal(activateScheduledTasks(2_000), 2);
  // A lost revision race is an ordinary outcome for a background tick.
  assert.equal(activateScheduledTasks(3_000), 0);
  assert.deepEqual(calls, [{ now: 2_000 }, { now: 3_000 }]);
  assert.doesNotMatch(
    source,
    /store\.|pushStateChange|showPrivateTaskNotification/
  );
});

test('native task notifications expose only aggregate state, never task-authored text', () => {
  const notices = [];
  const { createPrivateTaskNotifications } = require('../src/bootstrap/task-notifications');
  const showPrivateTaskNotification = createPrivateTaskNotifications(notice => { notices.push({ ...notice }); return notice; });
  assert.match(mainSource, /const showPrivateTaskNotification = createPrivateTaskNotifications\(/);

  showPrivateTaskNotification('expired', 2);
  showPrivateTaskNotification('scheduled', 3);
  showPrivateTaskNotification('recurrence-ready');
  showPrivateTaskNotification('unknown', 99);

  assert.deepEqual(notices, [
    // Deadlines and due times stay native notifications even while the pet is hidden.
    {
      title: '⌛ 2 个任务到期',
      body: '打开 I’m ADHDer 查看并选择顺延或归档。'
    },
    {
      title: '⏰ 3 个预约已到时间',
      body: '打开 I’m ADHDer 查看预约内容。'
    },
    {
      delivery: 'companion',
      title: '下一次已经排好',
      body: '打开 I’m ADHDer 查看下一次安排。'
    }
  ]);

  const expiry = sourceBetween(
    mainSource,
    'function publishExpiredWorkItems(',
    '\n\n// 预约到点也只报数量'
  );
  const localDay = sourceBetween(
    mainSource,
    'function publishLocalDayReset(',
    '\n\nfunction publishCompletedWorkItem('
  );
  const scheduled = sourceBetween(
    mainSource,
    'function publishActivatedScheduledWork(',
    '\n\nfunction publishLocalDayReset('
  );
  const completion = sourceBetween(mainSource, "registerIpc('tasks:complete',", '\n\n// 跳过一次重复');
  const completionPublisher = sourceBetween(
    mainSource,
    'function publishCompletedWorkItem(',
    '\n\nfunction pauseActiveSessionForInterruption('
  );
  assert.match(expiry, /showPrivateTaskNotification\('expired', fact\.expiredTaskIds\.length\)/);
  assert.match(scheduled, /showPrivateTaskNotification\('scheduled', fact\.activatedTaskIds\.length\)/);
  assert.match(completion, /completeWorkItemWorkflow\.execute\(\{ taskId: id, confirmUnfinishedSteps \}\)/);
  assert.match(completionPublisher, /growthPublisher\.completeTask\(fact\)/);
  assert.match(mainSource, /notifyRecurrence: \(\) => showPrivateTaskNotification\('recurrence-ready'\)/);
  assert.doesNotMatch(expiry, /showNotification\(|\.push\(t\.title\)/);
  // The gentle-archive notice reports a count and stays silent when nothing
  // moved, so a shared or locked screen never shows what was tidied away.
  assert.match(localDay, /if \(fact\.archivedTaskIds\.length > 0\)/);
  assert.match(localDay, /\$\{fact\.archivedTaskIds\.length\} 个长期未处理的到期任务已移到归档/);
  assert.doesNotMatch(localDay, /task\.title|task\.description|archivedTaskIds\.map|\.join\(/);
  assert.doesNotMatch(scheduled, /showNotification\(|task\.title|task\.description/);
  assert.doesNotMatch(completionPublisher, /task\.title|task\.description/);
});

test('background bookkeeping never rewrites completed or skipped task history', () => {
  const dailyTidySource = fs.readFileSync(
    path.join(ROOT, 'src/capabilities/work/domain/daily-tidy.js'),
    'utf8'
  );
  assert.match(dailyTidySource, /if \(!task \|\| !task\.deadline \|\| task\.done \|\| task\.skippedAt\) continue;/);
  assert.match(dailyTidySource, /if \(!task \|\| task\.done \|\| task\.skippedAt \|\| !task\.expiresAt\) continue;/);
  const scheduleActivationSource = fs.readFileSync(
    path.join(ROOT, 'src/capabilities/work/domain/schedule-activation.js'),
    'utf8'
  );
  assert.match(
    scheduleActivationSource,
    /if \(!task \|\| task\.done \|\| task\.skippedAt \|\| task\.expired \|\| task\.scheduleNotifiedAt\) continue;/
  );
  assert.doesNotMatch(mainSource, /task\.scheduleNotifiedAt\s*=/);
  assert.equal((mainSource.match(/task\.avoidanceCount\s*=/g) || []).length, 0);
  assert.equal((mainSource.match(/task\.lastAvoidedAt\s*=/g) || []).length, 0);
  assert.match(mainSource, /registerNudgeActions\(\{/);
  assert.match(mainSource, /recordTaskAvoidance: input => recordTaskAvoidanceWorkflow\.execute\(input\)/);
});

test('pet getters use pure sampled projections without starting care maintenance', () => {
  const { createPetQueries } = require('../src/bootstrap/pet-queries');
  const calls = [], sample = { feedState: { satiation: 55 } };
  const queries = createPetQueries({
    readSample: () => { calls.push('sample'); return sample; },
    projectState: value => { assert.equal(value, sample); calls.push('project'); return { paused: true }; }, foods: {} });
  assert.deepEqual(queries.getState(), { paused: true });
  assert.deepEqual(calls, ['sample', 'project']); calls.length = 0;
  assert.deepEqual(queries.getFeedState(), { satiation: 55, foods: {} });
  assert.deepEqual(calls, ['sample']);
  assert.doesNotMatch(mainSource, /maintainCompanionCare|dailyFood:|FOOD_REGEN_DAILY/);
  assert.match(mainSource, /recordCompanionInteractionWorkflow\.execute\(\{ interactionId \}\)/);
});

test('pet feeding IPC delegates the exact closed receipt identity to the atomic workflow', () => {
  const { createCompanionFeeding } = require('../src/bootstrap/companion-feeding');
  const { createUnitOfWork } = require('../src/application');
  const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
  let state = normalizePersistedState({}), revision = 0;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit: candidate => { state = structuredClone(candidate); revision++; return structuredClone(state); } };
  const handlers = new Map(), dirty = [];
  createCompanionFeeding({ unitOfWork: createUnitOfWork({ repository }), clock: { now: () => 1000 },
    foods: require('../src/pet-content').FOODS, announceBond() {}, publishChange: value => dirty.push(value)
  }).register((name, handler) => handlers.set(name, handler));
  const request = { foodId: 'berry', commandId: '1000-abc123', issuedAt: 1000 };
  const result = handlers.get('pet:feed')(null, request);
  assert.equal(result.ok, true); assert.equal(result.foodId, 'berry'); assert.equal(result.gainedXp, 0);
  assert.equal(state.pet.foodCommands[0].commandId, request.commandId);
  assert.equal(handlers.get('pet:feed')(null, request).replayed, true);
  assert.equal(revision, 1); assert.equal(dirty.length, 1);
  assert.match(mainSource, /companionFeeding\.register\(registerIpc\)/);
});

test('the companion feeding workflow consumes inventory without minting XP', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/application/workflows/feed-companion.js'), 'utf8');
  assert.match(source, /gainedXp: 0/);
  assert.match(source, /const FEED_COMPANION_WRITES = Object\.freeze\(\[\s*'pet',\s*'companion',\s*'rewardLedger'\s*\]\)/);
  assert.doesNotMatch(source, /applyDomainReward|dailyFeedXp/);
});

test('archive and delete IPC routes are thin adapters over one workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:delete'",
    "\nregisterIpc('tasks:restore'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    archiveWorkItemWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true };
      }
    }
  });

  assert.deepEqual({ ...handlers.get('tasks:delete')(null, 'task-1') }, { ok: true });
  assert.deepEqual({ ...handlers.get('tasks:archive')(null, 'task-2') }, { ok: true });
  assert.deepEqual(calls.map(call => ({ ...call })), [
    { taskId: 'task-1', reason: 'manual-delete' },
    { taskId: 'task-2', reason: 'manual' }
  ]);
  assert.doesNotMatch(
    source,
    /store\.|focusSession|Date\.now|archiveTaskTransaction|pushStateChange/
  );
});

test('the task-restore IPC is only a thin adapter over its capability command', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:restore'",
    "\nregisterIpc('tasks:set-now'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    restoreWorkItemCommand: {
      execute: input => {
        calls.push(input);
        return { ok: true, task: { id: input.taskId } };
      }
    }
  });

  const result = handlers.get('tasks:restore')(null, 'task-1');
  assert.deepEqual({ ...result, task: { ...result.task } }, {
    ok: true,
    task: { id: 'task-1' }
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [{ taskId: 'task-1' }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|clonePersistedState|computeAutoExpiry|pushStateChange/
  );
});

test('the set-now IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:set-now'",
    "\nregisterIpc('tasks:pickOne'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    selectNowWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, task: { id: input.taskId } };
      }
    }
  });

  const result = handlers.get('tasks:set-now')(null, 'scheduled-task');
  assert.deepEqual({ ...result, task: { ...result.task } }, {
    ok: true,
    task: { id: 'scheduled-task' }
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [{ taskId: 'scheduled-task' }]);
  assert.doesNotMatch(source, /store\.|Date\.now|taskStartBlockReason|pushStateChange/);
});

test('both task-creation IPC routes delegate to the same application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const addSource = sourceBetween(
    mainSource,
    "registerIpc('tasks:add'",
    "\n\nregisterIpc('tasks:complete'"
  );
  const breakdownSource = sourceBetween(
    mainSource,
    "registerIpc('tasks:add-with-breakdown'",
    "\n// A suggestion about an existing task"
  );
  loadFunctions(`${addSource}\n${breakdownSource}`, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    createWorkItemCommand: {
      execute: input => {
        calls.push(input);
        return { ok: true, task: { id: `task-${calls.length}` }, series: null };
      }
    }
  });

  const task = { title: '写方案', energy: 'auto', steps: [] };
  assert.equal(handlers.get('tasks:add')(null, task).task.id, 'task-1');
  assert.equal(handlers.get('tasks:add-with-breakdown')(null, task).task.id, 'task-2');
  assert.deepEqual(calls.map(call => ({ ...call })), [
    { task },
    { task, breakdown: true }
  ]);
  assert.doesNotMatch(
    `${addSource}\n${breakdownSource}`,
    /store\.|Date\.now|normalizeTask|pushStateChange/
  );
});

test('the adjust-duration IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('pomodoro:adjust-duration'",
    "\nregisterIpc('pomodoro:resolve-quick-start'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    adjustFocusDurationWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, changed: true, session: { plannedDurationMs: input.minutes * 60_000 } };
      }
    }
  });

  const result = handlers.get('pomodoro:adjust-duration')(null, { minutes: 45 });
  assert.equal(result.session.plannedDurationMs, 45 * 60_000);
  assert.deepEqual(calls.map(call => ({ ...call })), [{ minutes: 45 }]);
  assert.doesNotMatch(source, /store\.|Date\.now|adjustSessionDuration|persistFocusSession/);
});

test('the skip-occurrence IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:skip-occurrence'",
    "\n\nregisterIpc('tasks:complete-step'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    skipWorkOccurrenceWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, nextOccurrenceDate: '2026-09-09' };
      }
    },
    Date
  });

  const skip = handlers.get('tasks:skip-occurrence');
  assert.deepEqual(skip(null, { id: 'occ-1' }), {
    ok: true,
    nextOccurrenceDate: '2026-09-09'
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [{ taskId: 'occ-1' }]);
  assert.doesNotMatch(
    source,
    /store\.|focusSession|Date\.now|skipOccurrence|pushStateChange/
  );
});

test('the task-update IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    '// Manual edits and accepted proposals enter the same atomic workflow',
    '\n\n// 继续做类似的事'
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    updateWorkItemWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, task: { id: input.taskId }, scope: input.scope || 'current' };
      }
    }
  });

  const result = handlers.get('tasks:update')(null, {
    id: 'task-1',
    patch: { title: '改标题' },
    scope: 'current'
  });
  assert.deepEqual({ ...result, task: { ...result.task } }, {
    ok: true,
    task: { id: 'task-1' },
    scope: 'current'
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [{
    taskId: 'task-1',
    patch: { title: '改标题' },
    scope: 'current'
  }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|updateTask\(|taskStartBlockReason|pushStateChange/
  );
});

test('the task-duplicate IPC is only a thin adapter over its capability command', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:duplicate'",
    '\n\n// 改规则只影响'
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    duplicateWorkItemCommand: {
      execute: input => {
        calls.push(input);
        return { ok: true, task: { id: 'task-copy' } };
      }
    }
  });

  const result = handlers.get('tasks:duplicate')(null, { id: 'task-1' });
  assert.deepEqual({ ...result, task: { ...result.task } }, {
    ok: true,
    task: { id: 'task-copy' }
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [{ taskId: 'task-1' }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|duplicateTask|pushStateChange/
  );
});

test('the series-update IPC is only a thin adapter over its capability command', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('series:update'",
    "\n\nregisterIpc('history:list'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    updateRecurrenceSeriesCommand: {
      execute: input => {
        calls.push(input);
        return { ok: true, series: { id: input.seriesId }, nextOccurrenceDate: null };
      }
    }
  });

  const payload = {
    seriesId: 'series-1',
    rule: { frequency: 'daily', interval: 2, strategy: 'fixed' },
    state: 'paused'
  };
  const result = handlers.get('series:update')(null, payload);
  assert.deepEqual({ ...result, series: { ...result.series } }, {
    ok: true,
    series: { id: 'series-1' },
    nextOccurrenceDate: null
  });
  assert.deepEqual(calls.map(call => ({ ...call, rule: { ...call.rule } })), [{
    seriesId: 'series-1',
    rule: payload.rule,
    seriesState: 'paused'
  }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|updateSeries|pushStateChange/
  );
});

test('the clarify-now IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:clarify-now'",
    '\n\n// 时效顺延'
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    clarifyWorkItemWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, task: { id: input.taskId, nextAction: input.nextAction } };
      }
    }
  });

  const result = handlers.get('tasks:clarify-now')(null, {
    taskId: 'task-1', blocker: '入口太多', nextAction: '先写标题'
  });
  assert.deepEqual({ ...result, task: { ...result.task } }, {
    ok: true,
    task: { id: 'task-1', nextAction: '先写标题' }
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [{
    taskId: 'task-1', blocker: '入口太多', nextAction: '先写标题'
  }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|clarifyTask\(|pushStateChange/
  );
});

test('the focus-landing IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('pomodoro:resolve-focus-landing'",
    "\n\nregisterIpc('impulses:add'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    resolveFocusLandingWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, action: input.action };
      }
    }
  });

  const payload = { sessionId: 'focus-1', action: 'save', landingNote: '打开文件' };
  assert.deepEqual({ ...handlers.get('pomodoro:resolve-focus-landing')(null, payload) }, {
    ok: true,
    action: 'save'
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [payload]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|applyLandingNoteToState|pushStateChange/
  );
});

test('impulse IPC handlers delegate capture to work and every inbox decision to the inbox composition', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('impulses:add'",
    "\n\nregisterIpc('energy:check-in'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    captureImpulseCommand: {
      execute: input => {
        calls.push(['capture', input]);
        return { ok: true };
      }
    },
    inboxOrganization: { register: registrar => calls.push(['inbox', registrar === undefined ? null : typeof registrar]) },
    activityMirror: { register: registrar => calls.push(['activity', typeof registrar]) }
  });

  assert.deepEqual({ ...handlers.get('impulses:add')(null, '记下来') }, { ok: true });
  assert.deepEqual(calls.map(([kind, input]) => [kind, typeof input === 'object' ? { ...input } : input]), [
    ['inbox', 'function'],
    ['activity', 'function'],
    ['capture', { text: '记下来' }]
  ]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|createWorkItemDraft|pushStateChange|impulses:(promote|delete|review|organize)/
  );
});

test('dismissing a migration notice delegates the last hand-rolled commit away', () => {
  const handlers = new Map();
  const calls = [];
  const outcomes = [{ ok: true }, { ok: false, reason: 'notice-not-found' }];
  const source = fs.readFileSync(path.join(ROOT, 'src/bootstrap/app-maintenance.js'), 'utf8');
  const { registerAppMaintenance } = require('../src/bootstrap/app-maintenance');
  registerAppMaintenance({
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    getState() {}, hide() {}, stateRepository: {}, appHost: {}, lifecycle: { register() {} },
    makeUpdates: () => ({ read() {}, check() {}, download() {}, cancel() {}, install() {}, close() {} }),
    dismissNotice: id => { calls.push({ noticeId: id }); return outcomes.shift(); }
  });

  assert.deepEqual({ ...handlers.get('notices:dismiss')(null, { id: 'notice-1' }) }, { ok: true });
  // The renderer already ships this reason string; the move must not rename it.
  assert.deepEqual({ ...handlers.get('notices:dismiss')(null, { id: 'gone' }) }, {
    ok: false,
    reason: 'notice-not-found'
  });
  assert.deepEqual(calls, [{ noticeId: 'notice-1' }, { noticeId: 'gone' }]);
  assert.doesNotMatch(source, /store\.|Date\.now|migrationNotices|pushStateChange/);
});

test('the host keeps exactly one seam for persisted writes', () => {
  // A grep-level guarantee: no helper in main.js can commit behind the unit of
  // work, so every persisted change is a workflow or command with a declared
  // write-set. schemaVersion has no writer here at all — the migration sets it
  // while the store is being constructed, outside this file.
  for (const helper of ['commitCanonicalState', 'updateCanonicalState', 'setCanonicalField']) {
    assert.doesNotMatch(mainSource, new RegExp(`\\b${helper}\\b`));
  }
  assert.doesNotMatch(mainSource, /store\.(?:commit|update|set)\s*\(/);
  assert.match(mainSource, /const stateUnitOfWork = createUnitOfWork\(\{ repository: store \}\);/);

  // The host only ever echoes the imported constant — once into the composition
  // root so the store's migration knows its target, once into the renderer
  // projection. It never picks a version, and never assigns one.
  assert.doesNotMatch(mainSource, /schemaVersion\s*=/);
  const schemaVersionUses = [...mainSource.matchAll(/schemaVersion:\s*\S+/g)].map(match => match[0]);
  assert.equal(schemaVersionUses.length, 2);
  for (const use of schemaVersionUses) assert.match(use, /^schemaVersion: PERSISTED_SCHEMA_VERSION,?$/);
});

test('task renewal reuses the atomic update workflow and preserves its response contract', () => {
  const handlers = new Map();
  const calls = [];
  const defaultExpiry = '2026-09-08T18:00:00.000Z';
  const source = sourceBetween(
    mainSource,
    '// 时效顺延：用户可以给一个具体时间',
    "\n\nregisterIpc('pomodoro:start'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    computeAutoExpiry: () => defaultExpiry,
    updateWorkItemWorkflow: {
      execute: input => {
        calls.push(input);
        return input.taskId === 'missing'
          ? { ok: false, reason: 'task-not-found', task: null }
          : { ok: true, task: { expiresAt: input.patch.expiresAt }, scope: 'current' };
      }
    }
  });

  const renew = handlers.get('tasks:renew');
  assert.deepEqual({ ...renew(null, { id: 'task-1', expiresAt: null }) }, {
    ok: true,
    expiresAt: defaultExpiry
  });
  assert.deepEqual({ ...renew(null, { id: 'missing', expiresAt: defaultExpiry }) }, {
    ok: false,
    reason: 'task-not-found',
    expiresAt: null
  });
  assert.deepEqual(calls.map(call => ({ ...call, patch: { ...call.patch } })), [
    { taskId: 'task-1', patch: { expiresAt: defaultExpiry }, scope: 'current' },
    { taskId: 'missing', patch: { expiresAt: defaultExpiry }, scope: 'current' }
  ]);
  assert.doesNotMatch(source, /store\.|updateTask\(|pushStateChange/);
});

test('recurrence occurrences reward per instance while one-off rewards stay lifetime-idempotent', () => {
  const monday = { id: 'occ-monday', occurrenceDate: '2026-08-28' };
  const tuesday = { id: 'occ-tuesday', occurrenceDate: '2026-08-29' };
  const oneOff = { id: 'project' };
  let ledger = createRewardLedger();

  function award(eventId, source, dateKey) {
    const result = recordReward(ledger, createRewardEvent({ eventId, source, dateKey }));
    ledger = result.ledger;
    return result;
  }

  // Each occurrence is its own task, so its reward identity is stable no matter
  // which local day the user finally closes it on.
  assert.equal(award(taskCompletionRewardId(monday, '2026-08-28'), 'task-complete', '2026-08-28').recorded, true);
  assert.equal(award(taskCompletionRewardId(monday, '2026-08-29'), 'task-complete', '2026-08-29').recorded, false);
  assert.equal(award(taskCompletionRewardId(tuesday, '2026-08-29'), 'task-complete', '2026-08-29').recorded, true);

  assert.equal(award(stepCompletionRewardId(monday, 'stable-step', '2026-08-28'), 'step-complete', '2026-08-28').recorded, true);
  assert.equal(award(stepCompletionRewardId(monday, 'stable-step', '2026-08-29'), 'step-complete', '2026-08-29').recorded, false);
  assert.equal(award(stepCompletionRewardId(tuesday, 'stable-step', '2026-08-29'), 'step-complete', '2026-08-29').recorded, true);

  assert.equal(award(taskCompletionRewardId(oneOff, '2026-08-28'), 'task-complete', '2026-08-28').recorded, true);
  assert.equal(award(taskCompletionRewardId(oneOff, '2026-08-29'), 'task-complete', '2026-08-29').recorded, false);
  assert.equal(award(stepCompletionRewardId(oneOff, 'stable-step', '2026-08-28'), 'step-complete', '2026-08-28').recorded, true);
  assert.equal(award(stepCompletionRewardId(oneOff, 'stable-step', '2026-08-29'), 'step-complete', '2026-08-29').recorded, false);

  // The main process must not compute reward identities itself: both commands
  // enter their cross-capability workflows.
  const completeTaskIpc = sourceBetween(mainSource, "registerIpc('tasks:complete',", '\n\n// 跳过一次重复');
  const completeStepIpc = sourceBetween(mainSource, "registerIpc('tasks:complete-step'", "\n\nregisterIpc('tasks:delete'");
  const completionWorkflowSource = fs.readFileSync(
    path.join(ROOT, 'src/application/workflows/complete-work-item.js'),
    'utf8'
  );
  const taskRewardSource = fs.readFileSync(
    path.join(ROOT, 'src/capabilities/progress/domain/task-completion.js'),
    'utf8'
  );
  const stepCompletionWorkflowSource = fs.readFileSync(
    path.join(ROOT, 'src/application/workflows/complete-work-step.js'),
    'utf8'
  );
  const stepRewardSource = fs.readFileSync(
    path.join(ROOT, 'src/capabilities/progress/domain/step-completion.js'),
    'utf8'
  );
  assert.match(completeTaskIpc, /completeWorkItemWorkflow\.execute\(\{ taskId: id, confirmUnfinishedSteps \}\)/);
  assert.match(completeStepIpc, /completeWorkStepWorkflow\.execute\(\{ taskId, stepId \}\)/);
  assert.doesNotMatch(completeTaskIpc, /taskCompletionRewardId/);
  assert.doesNotMatch(completeStepIpc, /store\.|Date\.now|stepCompletionRewardId/);
  assert.match(completionWorkflowSource, /progress\.taskCompletion\.recordTaskCompletion/);
  assert.doesNotMatch(completionWorkflowSource, /taskCompletionRewardId/);
  assert.match(taskRewardSource, /taskCompletionRewardId\(task, rewardDay\)/);
  assert.match(stepCompletionWorkflowSource, /progress\.stepCompletion\.recordStepCompletion/);
  assert.doesNotMatch(stepCompletionWorkflowSource, /stepCompletionRewardId/);
  assert.match(stepRewardSource, /stepCompletionRewardId\(task, step\.id, rewardDay\)/);
});

test('focus entry delegates to its workflow and only bridges an already-due settlement', () => {
  // Both entries hand an already-due settlement to the same bridge, so the slice
  // carries it along: the contract under test is the whole refusal envelope, not
  // just the call that produces the reason.
  const source = [
    sourceBetween(mainSource, 'function deferStartToCompletedSession(', '\n\nfunction startFocusSession'),
    sourceBetween(mainSource, 'function startFocusSession(', '\n\nfunction startRestSession')
  ].join('\n');
  const calls = [];
  let workflowResult = { ok: true, session: { status: 'focus', sessionId: 'focus-2' } };
  const { startFocusSession } = loadFunctions(source, ['startFocusSession'], {
    startFocusSessionWorkflow: {
      execute: input => {
        calls.push(['execute', { ...input }]);
        return workflowResult;
      }
    },
    persistFocusSettlement: (...args) => calls.push(['settle', ...args]),
    handleCompletedSession: completion => calls.push(['complete', completion]),
    pushStateChange: dirty => calls.push(['publish', { ...dirty }]),
    pomodoroView: at => ({ status: 'break', at })
  });

  assert.deepEqual({ ...startFocusSession('task-1', 25) }, workflowResult);
  assert.deepEqual(calls, [['execute', { taskId: 'task-1', minutes: 25, quick: false, nextAction: undefined, taskVersion: undefined }]]);

  const completion = { sessionId: 'focus-1' };
  const nextSession = { status: 'idle' };
  workflowResult = {
    ok: false,
    reason: 'previous-session-completed',
    completion,
    nextSession,
    settledAt: 500
  };
  assert.deepEqual({ ...startFocusSession('task-1', 2, { quick: true }) }, {
    ok: false,
    reason: 'previous-session-completed',
    completion,
    session: { status: 'break', at: 500 }
  });
  assert.deepEqual(calls.slice(1), [
    ['execute', { taskId: 'task-1', minutes: 2, quick: true, nextAction: undefined, taskVersion: undefined }],
    ['settle', nextSession, completion, 500],
    ['complete', completion],
    ['publish', { pomodoro: true, stats: true, tasks: true, quickStartDecision: true }]
  ]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|startFocus\(|startQuickStart\(|transitionFocusSettlement/
  );
});

test('real start publication forwards clarified tasks/recommendations despite presentation failure', () => {
  const { createSessionStartPublisher } = require('../src/bootstrap/session-start-publication');
  const dirty = [], failures = [], timeline = [];
  const { publishStartedFocusSession } = loadFunctions(
    sourceBetween(mainSource, 'function publishStartedFocusSession(', '\n\nfunction publishCompletedWorkStep'),
    ['publishStartedFocusSession'], {
      createSessionStartPublisher, showNotification: () => { throw new Error('Synthetic presentation failure'); },
      petTellState: () => {}, timelineRecorder: { recordSessionStarted: input => timeline.push({ ...input }) },
      pushStateChange: input => dirty.push({ ...input }), reportWindowDeliveryError: error => failures.push(error.message)
    });
  const fact = { quick: true, clarified: true, taskId: 'task', startedAt: 42, session: { sessionId: 'new' } };
  publishStartedFocusSession(fact);
  assert.deepEqual(dirty, [{ pomodoro: true, stats: true, nowTask: true, quickStartDecision: true, tasks: true, recommendations: true }]);
  assert.deepEqual(timeline, [{ session: fact.session, taskId: 'task', startedAt: 42 }]);
  assert.deepEqual(failures, ['Synthetic presentation failure']);
});

test('rest entry delegates to its command and only bridges an already-due settlement', () => {
  const source = [
    sourceBetween(mainSource, 'function deferStartToCompletedSession(', '\n\nfunction startFocusSession'),
    sourceBetween(mainSource, 'function startRestSession(', '\n\nfunction pauseFocusSession')
  ].join('\n');
  const calls = [];
  let commandResult = { ok: true, session: { status: 'break', sessionId: 'break-2' } };
  const { startRestSession } = loadFunctions(source, ['startRestSession'], {
    startBreakSessionCommand: {
      execute: input => {
        calls.push(['execute', { ...input }]);
        return commandResult;
      }
    },
    getSettings: () => ({ breakMinutes: 5 }),
    persistFocusSettlement: (...args) => calls.push(['settle', ...args]),
    handleCompletedSession: completion => calls.push(['complete', completion]),
    pushStateChange: dirty => calls.push(['publish', { ...dirty }]),
    pomodoroView: at => ({ status: 'break', at })
  });

  assert.deepEqual({ ...startRestSession('task-1') }, commandResult);
  assert.deepEqual(calls, [[
    'execute', { taskId: 'task-1', minutes: 5, present: true, userInitiated: false }
  ]]);

  const completion = { sessionId: 'focus-1' };
  const nextSession = { status: 'idle' };
  commandResult = {
    ok: false,
    reason: 'previous-session-completed',
    completion,
    nextSession,
    settledAt: 500
  };
  assert.deepEqual({ ...startRestSession('task-1', { syncPet: false }) }, {
    ok: false,
    reason: 'previous-session-completed',
    completion,
    session: { status: 'break', at: 500 }
  });
  assert.deepEqual(calls.slice(1), [
    ['execute', { taskId: 'task-1', minutes: 5, present: false, userInitiated: false }],
    ['settle', nextSession, completion, 500],
    ['complete', completion],
    ['publish', { pomodoro: true, stats: true, tasks: true, quickStartDecision: true }]
  ]);
  assert.doesNotMatch(
    source,
    /store\.|startBreak\(|persistFocusSession|sessionTransitionNow|createDomainId/
  );
});

test('pause delegates to its command and settles an exact-deadline handoff once', () => {
  const source = sourceBetween(
    mainSource,
    'function pauseFocusSession()',
    '\n\nfunction publishCompletedWorkItem('
  );
  const calls = [];
  let commandResult = { ok: true, session: { status: 'paused', sessionId: 'focus-1' } };
  const { pauseFocusSession } = loadFunctions(source, ['pauseFocusSession'], {
    pauseSessionCommand: {
      execute: input => {
        calls.push(['execute', input]);
        return commandResult;
      }
    },
    persistFocusSettlement: (...args) => calls.push(['settle', ...args]),
    nudge: { clearNudge: () => calls.push(['clear-nudge']) },
    handleCompletedSession: completion => calls.push(['complete', completion]),
    pushStateChange: dirty => calls.push(['publish', { ...dirty }]),
    pomodoroView: at => ({ status: 'idle', at })
  });

  assert.deepEqual({ ...pauseFocusSession() }, commandResult);
  assert.deepEqual(calls, [['execute', undefined]]);

  const completion = { sessionId: 'focus-1', completed: true };
  const nextSession = { status: 'idle' };
  commandResult = {
    ok: false,
    reason: 'session-completed',
    completion,
    nextSession,
    settledAt: 500
  };
  assert.deepEqual({ ...pauseFocusSession() }, {
    ok: true,
    session: { status: 'idle', at: 500 }
  });
  assert.deepEqual(calls.slice(1), [
    ['execute', undefined],
    ['settle', nextSession, completion, 500],
    ['clear-nudge'],
    ['complete', completion],
    ['publish', { pomodoro: true, stats: true, tasks: true }]
  ]);
  assert.doesNotMatch(
    source,
    /pauseSession\(|persistFocusSession|sessionTransitionNow|focusSession\b/
  );
});

test('lifecycle interruption delegates to the execution command', () => {
  const source = sourceBetween(
    mainSource,
    'function pauseActiveSessionForInterruption(',
    '\n\nconst resumeFocusSession'
  );
  const calls = [];
  const commandResult = { ok: true, session: { status: 'paused', sessionId: 'focus-1' } };
  const { pauseActiveSessionForInterruption } = loadFunctions(
    source,
    ['pauseActiveSessionForInterruption'],
    {
      pauseForInterruptionCommand: {
        execute: input => {
          calls.push({ ...input });
          return commandResult;
        }
      }
    }
  );

  assert.deepEqual({ ...pauseActiveSessionForInterruption() }, commandResult);
  assert.deepEqual({ ...pauseActiveSessionForInterruption({ publish: false }) }, commandResult);
  assert.deepEqual(calls, [{ publish: true }, { publish: false }]);
  assert.doesNotMatch(
    source,
    /pauseForOfflineConfirmation|persistFocusSession|sessionTransitionNow|focusSession\b|nudge\.|tray\.|petTellState|pushStateChange/
  );
});

test('resume delegates to its workflow and only bridges a completed paused session', () => {
  const source = sourceBetween(
    mainSource,
    'const resumeFocusSession =',
    '\n\nfunction stopFocusSession('
  );
  const calls = [];
  let workflowResult = { ok: true, session: { status: 'focus', sessionId: 'focus-1' } };
  const { resumeFocusSession } = loadFunctions(source, ['resumeFocusSession'], {
    createSessionResumeAdapter: require('../src/bootstrap/session-resume').createSessionResumeAdapter,
    resumeFocusSessionWorkflow: {
      execute: input => {
        calls.push(['execute', input]);
        return workflowResult;
      }
    },
    persistFocusSettlement: (...args) => calls.push(['settle', ...args]),
    handleCompletedSession: completion => calls.push(['complete', completion]),
    pushStateChange: dirty => calls.push(['publish', { ...dirty }]),
    pomodoroView: at => ({ status: 'idle', at })
  });

  assert.deepEqual({ ...resumeFocusSession() }, workflowResult);
  assert.deepEqual(calls, [['execute', undefined]]);

  const completion = { sessionId: 'focus-1', completed: true };
  const nextSession = { status: 'idle' };
  workflowResult = {
    ok: false,
    reason: 'session-completed',
    completion,
    nextSession,
    settledAt: 700
  };
  assert.deepEqual({ ...resumeFocusSession() }, {
    ok: true,
    session: { status: 'idle', at: undefined }
  });
  assert.deepEqual(calls.slice(1), [
    ['execute', undefined],
    ['settle', nextSession, completion, 700],
    ['complete', completion],
    ['publish', { pomodoro: true, stats: true, tasks: true }]
  ]);
  assert.doesNotMatch(
    source,
    /store\.|resumeSession\(|transitionExecutionReturn|sessionTransitionNow/
  );
});

test('offline confirmation and unresolved handoffs remain visible in tray policy', () => {
  assert.match(mainSource, /registerIpc\('pet:startFocus',[\s\S]*?startFocusSession\(/);
  const traySessionAction = sourceBetween(
    mainSource,
    "{ label: hasAwaitingOfflineConfirmation()",
    "{ label: settings.dnd ?"
  );
  assert.match(traySessionAction, /if \(hasAwaitingOfflineConfirmation\(\)\)/);
  assert.match(traySessionAction, /if \(hasPendingQuickStartDecision\(\) \|\| hasPendingFocusLandingPrompt\(\)\)/);
  // Both blocked states have to reveal the panel rather than act, so count the
  // reveals instead of matching one: a single assertion passes while either
  // branch silently starts a round the user was never shown.
  assert.equal((traySessionAction.match(/activatePrimaryWindow\(\)/g) || []).length, 2);
  const label = traySessionAction.match(/: (.+?) \? '停止当前计时' : '开始专注'/);
  const click = traySessionAction.match(/if \((.+?)\) return stopFocusSession\(\)/);
  assert.ok(label, 'the tray entry must choose between stopping and starting');
  assert.ok(click, 'the tray entry must be able to stop the round on the clock');
  // The label and the action behind it have to ask the same question, or the
  // menu offers to stop a timer and starts a second one instead. Comparing the
  // two expressions keeps that tied together without pinning the predicate's
  // name, so the reads stay separate: the label is built when the menu opens.
  assert.equal(click[1], label[1]);
  assert.match(traySessionAction, /return startFocusSession\(store\.get\('nowTaskId'\), getSettings\(\)\.pomodoroMinutes\)/);
});

test('recommendations score the complete actionable pool before selecting two choices', () => {
  const tasks = Array.from({ length: 26 }, (_, index) => ({
    id: `task-${index}`,
    blocked: index === 7
  }));
  const scoredIds = [];
  let selectedPool = null;
  let selectedLimit = null;
  const source = sourceBetween(fs.readFileSync(path.join(__dirname, '../src/capabilities/guidance/domain/recommendations.js'), 'utf8'),
    'function buildRecommendations(', '\nreturn buildRecommendations(input);');
  const { buildRecommendations } = loadFunctions(source, ['buildRecommendations'], {
    readNow: () => 0,
    store: {
      get: key => {
        if (key === 'tasks') return tasks;
        if (key === 'stats') return {};
        if (key === 'energyCheckIn') return null;
        if (key === 'nowTaskId') return 'task-25';
        return undefined;
      }
    },
    getSettings: () => ({}),
    pomodoroView: () => ({ status: 'idle' }),
    currentEnergyEstimate: () => ({ level: 2, confidence: 0.5 }),
    taskStartBlockReason: task => task.blocked ? 'scheduled' : null,
    scoreTask: task => {
      scoredIds.push(task.id);
      return { id: task.id, task };
    },
    selectRecommendationCandidates: (ranked, limit) => {
      selectedPool = ranked;
      selectedLimit = limit;
      return ranked.slice(0, limit);
    }
  });

  const result = buildRecommendations({
    state: { tasks, stats: {}, energyCheckIn: null, nowTaskId: 'task-25' },
    settings: {}, pomodoro: { status: 'idle' }, now: 0, limit: 2
  });

  assert.equal(scoredIds.length, 25);
  assert.equal(scoredIds.includes('task-7'), false, 'blocked tasks stay outside the candidate pool');
  assert.equal(scoredIds.includes('task-25'), true, 'tasks below the former top-20 boundary are still scored');
  assert.deepEqual(selectedPool.map(item => item.id), scoredIds);
  assert.equal(selectedLimit, 2);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.some(item => item.id === 'task-25'), false);
  assert.equal(result.nowCandidate.id, 'task-25', 'the selected Now keeps its full score outside the two cards');
  assert.equal(scoredIds.filter(id => id === 'task-25').length, 1, 'Now reuses the same scoring pass');
  assert.doesNotMatch(source, /limit\s*:\s*20/);
  assert.doesNotMatch(source, /\.slice\s*\(/);
});

test('the quick-start resolution IPC is only a thin adapter over its application workflow', () => {
  const handlers = new Map();
  const calls = [];
  const source = sourceBetween(
    mainSource,
    "registerIpc('pomodoro:resolve-quick-start'",
    "\nregisterIpc('pomodoro:resolve-focus-landing'"
  );
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    resolveQuickStartWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, action: input.action };
      }
    }
  });

  const payload = { action: 'extend-8', landingNote: '继续第一步' };
  assert.deepEqual({ ...handlers.get('pomodoro:resolve-quick-start')(null, payload) }, {
    ok: true,
    action: 'extend-8'
  });
  assert.deepEqual(calls.map(call => ({ ...call })), [payload]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|startFocusSession|transitionExecutionReturn|pushStateChange/
  );
});

test('stop delegates to its workflow and reprojects after post-commit presentation', () => {
  const calls = [];
  const source = sourceBetween(mainSource, 'function stopFocusSession(', '\n\nfunction acceptHealthyShutdown');
  let workflowResult = {
    ok: true,
    completion: { sessionId: 'exact-stop', completed: true },
    session: { status: 'idle' }
  };
  const { stopFocusSession } = loadFunctions(source, ['stopFocusSession'], {
    stopFocusSessionWorkflow: {
      execute: input => {
        calls.push(['execute', { ...input }]);
        return workflowResult;
      }
    },
    pomodoroView: () => {
      calls.push(['project']);
      return { status: 'break', sessionId: 'break-1' };
    }
  });

  const result = stopFocusSession();
  assert.deepEqual({ ...result }, {
    ...workflowResult,
    session: { status: 'break', sessionId: 'break-1' }
  });
  assert.deepEqual(calls, [['execute', { reason: 'stopped', sessionId: undefined }], ['project']]);

  workflowResult = { ok: false, reason: 'not-running', session: { status: 'idle' } };
  assert.deepEqual({ ...stopFocusSession('accepted-rest') }, workflowResult);
  assert.deepEqual(calls.slice(2), [['execute', { reason: 'accepted-rest', sessionId: undefined }]]);
  assert.doesNotMatch(
    source,
    /stopSession\(|persistFocusSettlement|sessionTransitionNow|pushStateChange/
  );
});

test('timer completion delegates its due check and settlement to one workflow', () => {
  const source = sourceBetween(mainSource, 'function handleSessionDue(', '\n\nfunction checkSoftReminder');
  const calls = [];
  let workflowResult = { ok: true, completed: true };
  const { handleSessionDue } = loadFunctions(source, ['handleSessionDue'], {
    completeDueSessionWorkflow: {
      execute: input => {
        calls.push(input);
        return workflowResult;
      }
    },
    Error
  });

  assert.equal(handleSessionDue(), true);
  workflowResult = { ok: true, completed: false };
  assert.equal(handleSessionDue(), false);
  workflowResult = { ok: false, reason: 'session-settlement-mismatch' };
  assert.throws(() => handleSessionDue(), /due session settlement rejected/);
  assert.deepEqual(calls, [undefined, undefined, undefined]);
  assert.doesNotMatch(
    source,
    /focusSession|completeIfDue|persistFocusSettlement|handleCompletedSession|pushStateChange/
  );
});

test('persisted session recovery delegates to the execution command', () => {
  const source = sourceBetween(
    mainSource,
    'function recoverPersistedFocusSession(',
    '\n\nconst startHydrationTimer'
  );
  const calls = [];
  const commandResult = {
    ok: true,
    action: 'awaiting-confirmation',
    session: { status: 'paused', sessionId: 'focus-1' }
  };
  const { recoverPersistedFocusSession } = loadFunctions(
    source,
    ['recoverPersistedFocusSession'],
    {
      recoverSessionCommand: {
        execute: input => {
          calls.push(input);
          return commandResult;
        }
      }
    }
  );

  assert.deepEqual({ ...recoverPersistedFocusSession() }, commandResult);
  assert.deepEqual(calls, [undefined]);
  assert.doesNotMatch(
    source,
    /Date\.now|\brecoverSession\s*\(|pauseForOfflineConfirmation|persistFocusSession|store\.|focusSession\b/
  );
  assert.doesNotMatch(mainSource, /function persistFocusSession\(/);
});

test('healthy shutdown is a thin adapter over its application workflow', () => {
  const calls = [];
  const workflowResult = {
    ok: true,
    action: 'paused-focus',
    session: { status: 'paused', sessionId: 'focus-1' }
  };
  const source = sourceBetween(mainSource, 'function acceptHealthyShutdown(', '\n\nfunction handleCompletedSession');
  const { acceptHealthyShutdown } = loadFunctions(source, ['acceptHealthyShutdown'], {
    acceptHealthyShutdownWorkflow: {
      execute: input => {
        calls.push(input);
        return workflowResult;
      }
    }
  });

  const result = acceptHealthyShutdown('2026-08-29');
  assert.equal(result, workflowResult);
  assert.deepEqual(calls.map(input => ({ ...input })), [{ dayKey: '2026-08-29' }]);
  assert.doesNotMatch(
    source,
    /store\.|Date\.now|settleForHealthyShutdown|transitionFocusSettlement|checkAndUnlockSkins/
  );
});

test('level-up feedback publishes presentation only; inventory and unlocks come from committed workflows', () => {
  const source = sourceBetween(mainSource, 'function notifyLevelUp(', '\n\nfunction persistFocusSettlement');
  const calls = [];
  const { notifyLevelUp } = loadFunctions(source, ['notifyLevelUp'], {
    companionCapability: require('../src/capabilities/companion'),
    showNotification: () => calls.push('level'),
    petTellExpression: () => calls.push('expression'),
    publishFoodDrop: food => calls.push(food)
  });

  notifyLevelUp({ recorded: true, leveledUp: false, level: 3 });
  assert.deepEqual(calls, []);
  notifyLevelUp({ recorded: false, leveledUp: false, level: 3 });
  assert.deepEqual(calls, []);
  notifyLevelUp({ recorded: true, leveledUp: true, level: 3, levelUpFood: 'cake' });
  assert.deepEqual(calls, ['level', 'expression']);
  assert.doesNotMatch(source, /checkAndUnlockSkins|store\.|grantLevelUpFood|publishFoodDrop/);
});

test('DND is initialized before startup work and tray changes are pushed to the pet', () => {
  const ready = sourceBetween(mainSource, 'appHost.whenReady().then(() => {', '\n  processLifecycle.startPowerMonitoring();');
  const dndInit = ready.indexOf('nudge.setDND(getSettings().dnd)');
  assert.ok(dndInit >= 0);
  for (const laterAction of [
    'recoverPersistedFocusSession()',
    'startHydrationTimer()',
    'runDailyReset()',
    'startWorkBoundaryWatcher()'
  ]) {
    assert.ok(dndInit < ready.indexOf(laterAction), `DND must initialize before ${laterAction}`);
  }

  const trayToggle = sourceBetween(
    ready,
    "{ label: settings.dnd ? '✓ 免打扰中（点击关闭）' : '开启免打扰'",
    "{ label: settings.petEnabled ?"
  );
  assert.match(trayToggle, /updatePreferencesCommand\.execute\(\{ patch: \{ dnd: nextDnd \} \}\)/);
  assert.match(mainSource, /function publishPreferencesUpdate\(fact\) \{\s*createPreferencesPublisher\(\{/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/bootstrap/preferences-publication.js'), 'utf8'), /publishChange\(\{ settings: true, pet: fact\.careChanged === true \}\)/);
  assert.equal(require('../src/bootstrap/surface-publication').petContextChanged({ settings: true }), true);

  const notificationHost = sourceBetween(
    mainSource,
    '} = createNotificationHost({',
    '\n\nconst { lifecycle, surpriseDirector }'
  );
  assert.match(notificationHost, /isSuppressed: \(\) => getSettings\(\)\.dnd/);
  assert.match(notificationHost, /isSoundEnabled: \(\) => getSettings\(\)\.soundEnabled/);
  assert.match(mainSource, /closeNotifications: closeAppNotifications/);
});

test('renderer state delivery is best-effort after canonical state commits', () => {
  const warnings = [];
  const source = sourceBetween(mainSource, 'function reportWindowDeliveryError(', '\n\nfunction sessionTransitionNow');
  const { safeWindowSend } = loadFunctions(source, ['safeWindowSend'], {
    console: { warn: (...args) => warnings.push(args) }
  });
  const crashedWindow = {
    send: () => { throw new Error('renderer gone'); }
  };

  assert.equal(safeWindowSend(crashedWindow, 'state:diff', { dirty: true }), false);
  assert.equal(safeWindowSend(null, 'state:diff', {}), false);
  assert.equal(warnings.length, 1);
});

test('routine nudges contain rejections and do not bypass the foreground whitelist through the pet', async () => {
  const { createNudgeDelivery } = require('../src/platform/electron/nudge-delivery');
  const warnings = [];
  const petMessages = [];
  let outcome = { shown: true, limitedToLevel: 1, reason: 'foreground-whitelist' };
  const startNudgeBestEffort = createNudgeDelivery({
    nudge: { startNudgeSequence: () => outcome },
    presentCompanion: message => petMessages.push(message),
    reportError: error => warnings.push(error)
  });

  await startNudgeBestEffort({ type: 'rest' }, { petMessage: '喝水' });
  assert.equal(petMessages.length, 0, 'L1-only foreground protection must include the desktop pet');

  outcome = { shown: true };
  await startNudgeBestEffort({ type: 'rest' }, { petMessage: '伸展' });
  assert.equal(petMessages.join(','), '伸展');

  outcome = { shown: true, delivery: 'companion' };
  await startNudgeBestEffort({ type: 'routine' }, { petMessage: '已经说过' });
  assert.equal(petMessages.join(','), '伸展', 'a delivered pet reminder is not mirrored a second time');

  outcome = Promise.reject(new Error('nudge transport unavailable'));
  const failed = await startNudgeBestEffort({ type: 'focus' });
  assert.equal(failed.shown, false);
  assert.equal(failed.reason, 'nudge-failed');
  assert.equal(warnings.length, 1);
});

test('the test-nudge IPC awaits its async result and reports rejection without leaking it', async () => {
  const handlers = new Map();
  const warnings = [];
  let outcome = Promise.reject(new Error('native notification unavailable'));
  const source = sourceBetween(mainSource, "registerIpc('nudge:test'", '\n\nregisterNudgeActions');
  loadFunctions(source, [], {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    getSettings: () => ({
      nudgeCharacter: 'cat', motionMode: 'balanced',
      stimulationMode: 'balanced', soundEnabled: false
    }),
    getCurrentTheme: () => ({ primary: '#000000' }),
    nudge: { showLevel: () => outcome },
    console: { warn: (...args) => warnings.push(args) }
  });

  const failed = await handlers.get('nudge:test')(null, { kind: 'rest', level: 2 });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'nudge-failed');
  assert.equal(warnings.length, 1);

  outcome = Promise.resolve({ shown: true, level: 2 });
  const shown = await handlers.get('nudge:test')(null, { kind: 'rest', level: 2 });
  assert.equal(shown.ok, true);
});

test('work-end reminder is not consumed by DND and catches up later that evening', async () => {
  let dnd = true;
  let now = new Date(2026, 7, 29, 21, 30).getTime();
  let localHour = 21;
  const values = new Map([
    ['lastWorkEndNotifyDate', null],
    ['tasks', [{ id: 'one', done: false }]]
  ]);
  const nudges = [];
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
    getHours() { return localHour; }
  }
  const { check: checkWorkBoundaries } = createWorkBoundaryReminder({
    readDate: () => new ClockDate(),
    getSettings: () => ({
      dnd, workEndReminder: true, nudgeCharacter: 'cat', nudgeWhitelist: [],
      motionMode: 'balanced', stimulationMode: 'balanced', soundEnabled: false
    }),
    activateScheduledTasks: () => 0,
    materializeDueReviews: () => [],
    taskStartBlockReason: () => null,
    getWorkHours: () => ({ start: 10, end: 21 }),
    recordWorkEndReminder: ({ dayKey }) => {
      values.set('lastWorkEndNotifyDate', dayKey);
      return { ok: true, changed: true, dayKey };
    },
    readLastNotifiedDay: () => values.get('lastWorkEndNotifyDate'),
    readTasks: () => values.get('tasks'),
    startNudgeSequence: options => { nudges.push(options); return { shown: true }; },
    getCurrentTheme: () => ({ primary: '#000000' }),
    petTalk: () => {}
  });

  await checkWorkBoundaries();
  assert.equal(values.get('lastWorkEndNotifyDate'), null);
  assert.equal(nudges.length, 0);

  dnd = false;
  now = new Date(2026, 7, 29, 22, 30).getTime();
  localHour = 22;
  await checkWorkBoundaries();
  assert.equal(values.get('lastWorkEndNotifyDate'), '2026-08-29');
  assert.equal(nudges.length, 1);
  assert.equal(nudges[0].priority, 100);

  await checkWorkBoundaries();
  assert.equal(nudges.length, 1, 'same local day is announced once');

  now = new Date(2026, 7, 28, 22, 30).getTime();
  await checkWorkBoundaries();
  assert.equal(nudges.length, 1, 'clock rollback cannot replay an older work-end reminder');
  assert.equal(values.get('lastWorkEndNotifyDate'), '2026-08-29');
});

// 宠物状态机与表情呈现是两条通道，抢占规则却只能有一份。渲染器只允许读
// 导演导出的优先级表，不允许自己再声明一份——0.4.0 之前 surfaces/pet 下就有
// 一份未接线的副本，把 input-safe 抄成低于 essential、cue 抄成高于 session。
// 规则本身的行为覆盖在 test/pet-presentation.test.js。
test('the pet surface declares no priority table of its own', () => {
  for (const source of ['input-safe', 'essential', 'interaction', 'session', 'cue', 'base']) {
    assert.doesNotMatch(
      petSource,
      new RegExp(`['"]?${source}['"]?\\s*:\\s*\\d`),
      `pet surface must read PRIORITY_BY_SOURCE instead of restating ${source}'s priority`
    );
  }
});

test('session completion sends presentation only while shared publication owns canonical base', () => {
  const source = sourceBetween(mainSource, 'function handleCompletedSession(', '\n\nfunction handleSessionDue');
  const events = [];
  const common = {
    STATUS: { QUICK_START: 'quick-start', FOCUS: 'focus' },
    getSettings: () => ({
      breakMinutes: 5, restMaxLevel: 2, focusMaxLevel: 2,
      nudgeCharacter: 'cat', nudgeWhitelist: [], motionMode: 'balanced',
      stimulationMode: 'balanced', soundEnabled: false
    }),
    petTellTemporaryState: (...args) => events.push(['temporary', ...args]),
    showNotification: () => {},
    petWindow: null,
    petPushFeedState: () => {},
    nudge: { startNudgeSequence: () => events.push(['nudge']) },
    startNudgeBestEffort: () => events.push(['nudge']),
    getCurrentTheme: () => ({ primary: '#000000' }),
    Date
  };

  const quick = loadFunctions(source, ['handleCompletedSession'], {
    ...common,
    celebrationUntil: 0,
    startRestSession: () => { throw new Error('quick-start must not start a break'); },
    petTellState: () => events.push(['base'])
  }).handleCompletedSession;
  quick({ kind: 'quick-start', sessionId: 'quick-1', taskId: 'task-1', endedAt: 100, elapsedMs: 120000 });
  assert.deepEqual(events, [['temporary', 'celebrating', 2500]]);

  events.length = 0;
  const full = loadFunctions(source, ['handleCompletedSession'], {
    ...common,
    celebrationUntil: 0,
    startRestSession: (_taskId, options) => {
      events.push(['start-rest', options]);
      return { ok: true };
    },
    petTellState: state => events.push(['base', state])
  }).handleCompletedSession;
  full({ kind: 'focus', sessionId: 'focus-1', taskId: 'task-1', endedAt: 100, elapsedMs: 1500000 });
  assert.equal(events[0][0], 'start-rest');
  assert.equal(events[0][1].syncPet, false);
  assert.deepEqual(events[1], ['temporary', 'celebrating', 5000]);
  assert.equal(events.some(([type]) => type === 'base'), false, 'no intermediate resting frame cancels celebration');
});

test('P5 structured pet facts are closed, bounded and reuse pet:sync', () => {
  const sent = [];
  const source = sourceBetween(mainSource, 'function petTellExpression(', '\nfunction pushNeutralPetGaze');
  const { petTellExpression, petCancelExpression } = loadFunctions(
    source,
    ['petTellExpression', 'petCancelExpression'],
    {
    petContent: require('../src/pet-content'),
    PRESENTATION_TRANSIENT_SOURCES: require('../src/core/pet-presentation.mjs').PRESENTATION_TRANSIENT_SOURCES,
    PET_PRESENTATION_MAX_TTL_MS: 600_000,
    petPresentationSequence: 0,
    petWindow: {},
    safeWindowSend: (_window, channel, payload) => sent.push({ channel, payload })
    }
  );

  const eventId = petTellExpression('system.processing', {
    source: 'interaction', ttlMs: 999_999, minHoldMs: 999_999
  });
  assert.equal(eventId, 'main.system.processing.1');
  assert.deepEqual(plain(sent[0]), {
    channel: 'pet:sync',
    payload: {
      presentation: {
        eventId: 'main.system.processing.1',
        expressionId: 'system.processing',
        source: 'interaction',
        ttlMs: 600_000,
        minHoldMs: 600_000
      }
    }
  });
  assert.equal(petTellExpression('system.not-real'), null);
  assert.equal(sent.length, 1, '未知 expression 不得越过闭合集合进入 renderer');

  assert.equal(petCancelExpression(eventId, 'proposal-dismissed'), true);
  assert.deepEqual(plain(sent[1]), {
    channel: 'pet:sync',
    payload: {
      presentation: {
        eventId: 'main.system.processing.1',
        cancel: true,
        reason: 'proposal-dismissed'
      }
    }
  });
  assert.equal(petCancelExpression('x'.repeat(201)), false, '取消事件 ID 也必须有界');
  assert.equal(sent.length, 2);
});

test('P5 business expressions are emitted only behind their real fact gates', () => {
  const proposalSource = fs.readFileSync(path.join(__dirname, '../src/capabilities/guidance/application/proposal-preview.js'), 'utf8');
  const ai = sourceBetween(proposalSource, 'async function previewBreakdownProposal(', 'return Object.freeze');
  // The request expression lives in generateProposal, which every task shares —
  // including the ones that never reach proposalStore.
  const sharedRequest = sourceBetween(proposalSource, 'async function generateProposal(', 'async function previewBreakdownProposal');
  assert.match(sharedRequest, /selected\.client && selected\.client\.id !== 'deterministic'[\s\S]*?'system\.processing'[\s\S]*?'system\.thinking'/);
  assert.match(sharedRequest, /ttlMs: PET_PRESENTATION_MAX_TTL_MS[\s\S]*?finally \{[\s\S]*?cancelExpression\(requestEventId, 'request-ended'\)/,
    'AI 进行态必须覆盖最长请求，并在请求真实结束时显式撤销');
  assert.match(ai, /if \(generated\.fallback\) \{[\s\S]*?presentExpression\('system\.unavailable'/);
  assert.match(ai, /if \(!proposalStore\.get\(stored\.id\)\) return;[\s\S]*?presentExpression\('work\.waiting'/,
    '只允许仍存在的 proposal 宣称等待确认');

  const proposalLifecycle = sourceBetween(
    mainSource,
    "registerIpc('ai:preview-breakdown'",
    "\n\nregisterIpc('strategy:request'"
  ) + fs.readFileSync(path.join(__dirname, '../src/application/workflows/apply-guidance-proposal.js'), 'utf8');
  assert.match(proposalLifecycle, /function consumeBreakdownProposal[\s\S]*?proposalStore\.consume\(proposalId\)[\s\S]*?provider-unavailable[\s\S]*?\.waiting/);
  assert.equal(
    (proposalLifecycle.match(/consumeBreakdownProposal\(proposalId, 'proposal-applied'\)/g) || []).length,
    2,
    '新建与更新既有任务两条成功路径都必须结束宠物等待表达'
  );
  assert.match(proposalLifecycle, /stored\.context\.kind !== 'breakdown'/,
    'enrich proposal 不得借 apply-proposal 写入任务');
  assert.match(proposalLifecycle, /stored\.context\.taskId !== requestedTaskId/,
    'proposal 不得改绑到生成时未绑定的另一任务');
  assert.match(
    proposalLifecycle,
    /const applied = updateWorkItemWorkflow\.execute\(\{[\s\S]*?taskId: requestedTaskId,[\s\S]*?patch: \{ steps: operations \},[\s\S]*?scope/
  );
  assert.doesNotMatch(proposalLifecycle, /applyTaskUpdate|updateTask\(/,
    '手工编辑与 proposal 必须共享同一个 application workflow');
  assert.match(proposalLifecycle, /tasks:dismiss-proposal[\s\S]*?consumeBreakdownProposal\(proposalId, 'proposal-dismissed'\)/);

  const strategy = sourceBetween(mainSource, "registerIpc('strategy:request'", "\nregisterIpc('strategy:feedback'");
  const enabledGate = strategy.indexOf("reason: 'strategy-guidance-disabled'");
  const taskGate = strategy.indexOf("reason: 'task-not-found'");
  const thinking = strategy.indexOf("petTellExpression('system.thinking'");
  assert.ok(enabledGate >= 0 && taskGate > enabledGate && thinking > taskGate,
    '策略未启用或任务不存在时不能伪造 thinking');
  // A click is the only caller, and selectStrategy ignores the budget and cooldown
  // ledgers for an explicit request. Maintaining them here would suppress ambient
  // cues for an hour whenever the user asks for a tip.
  assert.doesNotMatch(strategy, /shownToday|lastShownAtBy/,
    '点击不得写入主动推送才会读的额度与冷却账本');
  assert.match(strategy, /\.slice\(-MAX_RECENT\)/,
    '最近窗口的长度只在 strategy-registry 定义一次');

  const complete = sourceBetween(mainSource, "registerIpc('tasks:complete'", '\n\n// 跳过一次重复');
  const completionPublisher = sourceBetween(
    mainSource,
    'function publishCompletedWorkItem(',
    '\n\nfunction pauseActiveSessionForInterruption('
  );
  // Execute the real composition callback instead of requiring one spelling of
  // its wiring: the quick panel also receives feedback from the committed fact.
  const published = [];
  let ports;
  vm.runInNewContext(sourceBetween(mainSource,
    'const completeWorkItemWorkflow = createCompleteWorkItemWorkflow(',
    '\nconst completeWorkStepWorkflow ='), {
    createCompleteWorkItemWorkflow: options => { ports = options; return {}; },
    stateUnitOfWork: {}, taskUndo: { registry: {} }, createDomainId: () => 'test-id',
    publishCompletedWorkItem: fact => published.push(['completion', fact]),
    quickPanelHost: { feedback: kind => published.push(['quick-panel', kind]) }
  });
  assert.deepEqual(published, [], 'registration must not publish a completion');
  const committedFact = Object.freeze({ type: 'work-item-completed', taskId: 'completed-task' });
  ports.publish(committedFact);
  assert.deepEqual(published, [['completion', committedFact], ['quick-panel', 'completed']]);
  assert.match(complete, /completeWorkItemWorkflow\.execute\(\{ taskId: id, confirmUnfinishedSteps \}\)/);
  assert.doesNotMatch(complete, /react\.celebrate/,
    '完成 handler 只能进入原子工作流，不能自行提交或提前庆祝');
  assert.match(completionPublisher, /growthPublisher\.completeTask\(fact\)/,
    '庆祝只存在于工作流提交后的发布函数');
  assert.match(complete, /if \(result\.reason === 'unfinished-steps-need-confirmation'\) \{[\s\S]*?petTellExpression\('work\.waiting'/);

  const stopped = sourceBetween(
    mainSource,
    'function presentStoppedSession(',
    '\n\nfunction pauseActiveSessionForInterruption'
  );
  assert.match(stopped, /if \(fact\.requestedReason === 'stopped'\) \{\s*petTellExpression\('system\.stopped'/,
    '只有用户明确停止才使用 stopped');

  const skipped = sourceBetween(mainSource, "registerIpc('tasks:skip-occurrence'", "\n\nregisterIpc('tasks:complete-step'");
  const expiry = sourceBetween(mainSource, 'function expireDueTasks(', '\n// schema 8 的迁移器');
  for (const source of [skipped, expiry]) {
    assert.doesNotMatch(source, /system\.(?:stopped|unavailable)|react\.celebrate|angry|blame|down/,
      '跳过或过期不是失败/庆祝事实');
  }
});

// ---- 伙伴默契（bondPoints）接线 ----
// vm 里造的对象跟宿主不同 realm，deepStrictEqual 会卡在原型不同上
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBondModule(overrides = {}) {
  const source = sourceBetween(mainSource, 'function announceBondStage(', '\n\nfunction hasPendingQuickStartDecision(');
  const sent = [];
  const pushed = [];
  const sandbox = {
    relationshipProjection,
    completionBenefits,
    petContent: require('../src/pet-content'),
    petWindow: {},
    safeWindowSend: (_window, channel, payload) => sent.push({ channel, payload }),
    pushStateChange: dirty => pushed.push(dirty),
    getPetData: () => ({ satiation: 60, totalFeeds: 4 }),
    store: { get: key => ({ companion: normalizeCompanionState() })[key] },
    Date,
    ...overrides
  };
  const exportConstants = '\nglobalThis.__bond = { BOND_STAGES: relationshipProjection.BOND_STAGES, BOND_POINTS: completionBenefits.BOND_POINTS };';
  const loaded = loadFunctions(
    source + exportConstants,
    ['announceBondStage'],
    sandbox
  );
  return {
    ...loaded, sent, pushed, constants: loaded.context.__bond,
    buildCompanionProjection: () => relationshipProjection.buildRelationshipProjection({
      pet: sandbox.getPetData(), companion: sandbox.store.get('companion'), foods: sandbox.petContent.FOODS, now: Date.now()
    })
  };
}

test('bond claims mutate the caller snapshot once per day and preserve role counters and milestones', () => {
  const state = { currentSkin: 'pink', companion: normalizeCompanionState() };
  const feed = at => completionBenefits.applyBondToState(state, { points: 1, counterId: 'feed', foodId: 'fish', at });
  const first = feed(1000);
  assert.equal(first.bondPoints, 1); assert.equal(first.stage, 'new'); assert.equal(first.stageChanged, false);
  assert.equal(state.companion.relationships.dango.bondPoints, 1);
  assert.deepEqual(state.companion.relationships.dango.foodAffinity, { fish: 1 });
  assert.deepEqual(state.companion.relationships.dango.milestones, ['journey-first-table']);
  const second = feed(2000); assert.equal(second.granted, 0); assert.equal(second.bondPoints, 1);
  assert.equal(state.companion.relationships.dango.foodAffinity.fish, 2);
  state.currentSkin = 'usagi'; assert.equal(feed(3000).granted, 0);
  assert.equal(state.companion.relationships.usagi.foodAffinity.fish, 1);
  state.currentSkin = 'pink'; state.companion.relationships.dango.bondPoints = 11;
  const nextDay = feed(1000 + 86_400_000);
  assert.equal(nextDay.bondPoints, 12); assert.equal(nextDay.stage, 'warming'); assert.equal(nextDay.stageChanged, true);
  assert.deepEqual(state.companion.relationships.dango.milestones, ['bond-warming', 'journey-first-table']);
  assert.equal(feed(2000 + 86_400_000).stageChanged, false);
});

test('only a genuine stage change announces itself, and it never sends a punishing message', () => {
  const { announceBondStage, sent, pushed, constants } = loadBondModule();
  announceBondStage({ stage: 'warming', stageChanged: false, bondPoints: 30 });
  assert.deepEqual(sent, []);
  assert.deepEqual(pushed, []);

  announceBondStage({ stage: 'familiar', stageChanged: true, bondPoints: 150 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'pet:sync');
  assert.equal(sent[0].payload.message, '我们现在是「熟悉了」了');
  assert.deepEqual(pushed, [], 'the committing workflow publishes the projection once after all writes');

  announceBondStage(null);
  assert.equal(sent.length, 1, 'a missing result is not an announcement');
  assert.deepEqual(Object.keys(constants.BOND_POINTS).sort(), ['feed', 'focusComplete', 'interaction', 'taskComplete']);
  assert.deepEqual(plain(constants.BOND_STAGES).map(entry => entry.min), [0, 12, 40, 100]);
});

test('the companion projection reports honest distance to the next stage and never a deficit', () => {
  const companion = normalizeCompanionState();
  companion.relationships.dango.bondPoints = 26;
  companion.relationships.dango.firstMetAt = Date.now() - 3 * 86_400_000;
  companion.relationships.dango.foodAffinity = { berry: 1, cake: 5, fish: 9, milk: 5 };
  companion.relationships.dango.milestones = ['bond-warming'];
  const { buildCompanionProjection } = loadBondModule({
    store: { get: key => ({ companion })[key] }
  });

  const projection = buildCompanionProjection();
  assert.equal(projection.satiation, 60);
  assert.equal(projection.totalFeeds, 4);
  assert.equal(projection.bond.points, 26);
  assert.equal(projection.bond.stage, 'warming');
  assert.equal(projection.bond.label, '慢慢熟了');
  assert.equal(projection.bond.nextLabel, '熟悉了');
  assert.equal(projection.bond.toNext, 14);
  assert.equal(projection.bond.percent, 50, '26 of the 12-to-40 span is half way');
  assert.equal(projection.daysTogether, 4);
  assert.deepEqual(plain(projection.foodAffinity).map(item => item.id), ['fish', 'cake', 'milk']);
  assert.ok(plain(projection.foodAffinity).every(item => item.name && item.emoji), 'the panel needs a name and emoji per food');
  assert.deepEqual(plain(projection.milestones), [{ id: 'bond-warming', label: '和它慢慢熟了', hint: '12 点' }]);

  companion.relationships.dango.bondPoints = 900;
  const maxed = buildCompanionProjection();
  assert.equal(maxed.bond.stage, 'trusted');
  assert.equal(maxed.bond.nextLabel, null);
  assert.equal(maxed.bond.toNext, 0);
  assert.equal(maxed.bond.percent, 100);
});

test('bond accrual is gated by a successful feed or a recorded progress reward', () => {
  const feed = fs.readFileSync(
    path.join(ROOT, 'src/application/workflows/feed-companion.js'),
    'utf8'
  );
  assert.match(
    feed,
    /const prepared = companion\.feeding\.prepareFeed\([\s\S]*?if \(!prepared\.ok\) return prepared;[\s\S]*?const bond = foodId === 'basic' \? null : companion\.completionBenefits\.applyBondToState\(state,\s*\{[\s\S]*?BOND_POINTS\.feed/,
    'feeding accrues bond only after inventory was consumed successfully'
  );
  assert.doesNotMatch(feed, /applyDomainReward/);

  const complete = fs.readFileSync(
    path.join(ROOT, 'src/application/workflows/complete-work-item.js'),
    'utf8'
  );
  assert.match(
    complete,
    /const benefits = reward\.recorded\s*\?\s*companion\.completionBenefits\.applyTaskCompletionBenefits\(state,/,
    'completing a task accrues bond only when the reward ledger recorded it'
  );

  const settle = sourceBetween(mainSource, 'function persistFocusSettlement(', '\nfunction ');
  const settleWorkflow = fs.readFileSync(
    path.join(ROOT, 'src/application/workflows/settle-focus-session.js'),
    'utf8'
  );
  assert.match(
    settle,
    /settleFocusSessionWorkflow\.execute\(\{ nextSession: next, completion, settledAt: now \}\)/,
    'the legacy coordinator delegates focus settlement to the named workflow'
  );
  assert.match(
    settleWorkflow,
    /if \(!progressResult\.reward\.recorded\) \{[\s\S]*?return \{[\s\S]*?bond: null,[\s\S]*?\};[\s\S]*?applyFocusCompletionBenefits\(state,/,
    'full focus settlement accrues bond only after its reward identity is recorded'
  );

  const interaction = fs.readFileSync(
    path.join(ROOT, 'src/application/workflows/record-companion-interaction.js'),
    'utf8'
  );
  assert.match(
    interaction,
    /const bond = reward\.recorded\s*\?\s*companion\.completionBenefits\.applyBondToState\(state,[\s\S]*?BOND_POINTS\.interaction/,
    'the interaction workflow accrues bond only when the daily-capped reward is recorded'
  );
  assert.match(
    interaction,
    /const newlyUnlockedSkins = reward\.recorded\s*\?[\s\S]*?unlockEligibleSkins/,
    'interaction unlocks are derived from the same recorded reward transaction'
  );
});

test('the pet renderer keeps long press interactive and exposes five primary commands', () => {
  assert.doesNotMatch(petSource, /radial/i, 'the interaction radial is gone; its lines moved into the click pool');
  assert.doesNotMatch(petHtml, /radial-item|id="radial"/, 'no radial markup may survive');

  const longPress = sourceBetween(petSource, 'onLongPress() {', 'onCommand(');
  assert.doesNotMatch(longPress, /toggleCommandMenu|openFoodMenu|MenuOpen/, 'long press must not open any menu');
  assert.match(longPress, /INTERACTIONS[\s\S]*?longPress/);
  assert.match(longPress, /emitPurrParticles\?\.\(\)/);

  assert.match(petSource, /const COMPANION_GESTURES = \[/, 'the removed radial lines must stay reachable');
  for (const line of ['嗯，摸摸很安心', '啪！我们继续', '一起慢慢呼吸一下']) {
    assert.ok(petSource.includes(line), `${line} must survive the radial removal`);
  }

  assert.match(petHtml, /id="commandMenu"[^>]*role="menu"/);
  assert.match(petHtml, /id="feedQuick"[^>]*data-act="feed"/);
  const commandItems = [...petHtml.matchAll(/<button[^>]*class="command-item[^"]*"[^>]*role="menuitem(?:checkbox)?"[^>]*>/g)];
  assert.equal(commandItems.length, 5, 'the primary menu stays within one quick decision');
  const labels = [...petHtml.matchAll(/<span class="ci-text">([^<]+)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['开始专注', '快速记录', '打开面板', '免打扰', '隐藏伙伴']);
  for (const removed of ['喂点心', '聊一句', '击个掌', '跳支舞', '伸懒腰', '换风景']) {
    assert.equal(labels.includes(removed), false, `${removed} must not occupy the primary menu`);
  }
});

test('the surrounding command menu keeps every label legible and inside the expanded window', () => {
  const style = petHtml.match(/\.command-item \{[\s\S]*?\n  \}/);
  assert.ok(style, 'the command item rule must stay findable');
  assert.doesNotMatch(
    petHtml,
    /font:\s*\d+\s+[\d.]+px\s+inherit/,
    'a font shorthand with an inherit family is dropped whole and silently restores the 13px default, which clips the labels'
  );
  assert.match(style[0], /font-size: 9px;/);
  const width = Number(style[0].match(/width: (\d+)px;/)[1]);
  const height = Number(style[0].match(/min-height: (\d+)px;/)[1]);
  assert.ok(width >= 76, 'the widest runtime label 关闭免打扰 is five glyphs plus an icon and a gap');

  const menuSize = mainSource.match(/const PET_MENU_SIZE = \{ w: (\d+), h: (\d+) \};/);
  assert.ok(menuSize, 'the expanded window size must stay declared in one place');
  const windowW = Number(menuSize[1]);
  const windowH = Number(menuSize[2]);
  // .stage 是固定 220x220 并在窗口里居中，所以项的坐标要加上这个偏移才是窗口坐标
  const offsetX = (windowW - 220) / 2;
  const offsetY = (windowH - 220) / 2;
  const positions = [...petHtml.matchAll(/\.command-item\.c(\d+)\s+\{ left: (-?\d+)px;\s+top: (-?\d+)px;/g)];
  assert.equal(positions.length, 5, 'five commands need five declared positions');

  const boxes = positions.map(([, index, left, top]) => ({
    index, x: offsetX + Number(left), y: offsetY + Number(top)
  }));
  for (const box of boxes) {
    assert.ok(box.x >= 0 && box.x + width <= windowW, `c${box.index} overflows the expanded window horizontally`);
    assert.ok(box.y >= 0 && box.y + height <= windowH, `c${box.index} overflows the expanded window vertically`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + width && b.x < a.x + width && a.y < b.y + height && b.y < a.y + height;
      assert.equal(overlap, false, `commands c${a.index} and c${b.index} overlap`);
    }
  }
});

test('the menu auto-close treats programmatic focus as pointer use, not as keyboard use', () => {
  // 菜单打开时一律聚焦首项；若把它当成键盘使用，指针那两档短超时永远不会生效
  assert.match(petSource, /let menuKeyboardActive = false;/);
  assert.match(
    petMenuSource,
    /isFocusInside: \(\) => menuKeyboardActive && commandMenu\.contains\(document\.activeElement\)/,
    'the long delay must require real keyboard activity'
  );
  assert.match(petMenuSource, /menuKeyboardActive = show && keyboard;/, 'closing the menu must clear the keyboard flag');
  assert.match(petMenuSource, /openCommandMenuOnce\?\.\('keyboard'\)/, 'the keyboard entry point must declare itself');
  assert.match(
    petMenuSource,
    /function onCommandKeydown\(event\) \{[\s\S]*?if \(commandMenuOpen\) \{\s*menuKeyboardActive = true;\s*menuAutoClose\.arm\(\);/,
    'a real keypress inside the menu promotes it to the keyboard delay and restarts the timer'
  );
});

test('completing the task you are focusing on pauses the timer without settling rewards', () => {
  // 完成不可逆，但一段正在跑的会话不应该被默默结算：只暂停，让用户自己决定下一步。
  const state = {
    nowTaskId: 'task-1',
    focusLandingPrompt: { taskId: 'task-1', status: 'pending' },
    focusSession: startFocus(createIdleSession(1_000), {
      now: 1_000,
      durationMs: 60_000,
      sessionId: 'focus-task-1',
      taskId: 'task-1'
    }).session,
    xp: 42,
    rewardLedger: { seenEventIds: ['existing-reward'] }
  };
  const rewardBefore = structuredClone(state.rewardLedger);

  const result = execution.taskCompletion.reconcileCompletedTask(state, {
    taskId: 'task-1',
    now: 31_000
  });

  assert.equal(result.paused, true);
  assert.equal(result.due, false);
  assert.equal(state.nowTaskId, null);
  assert.deepEqual(state.focusLandingPrompt, { taskId: 'task-1', status: 'pending' });
  assert.equal(state.focusSession.status, 'paused');
  assert.equal(state.focusSession.pausedFrom, 'focus');
  assert.equal(state.focusSession.elapsedBeforeStartMs, 30_000);
  assert.equal(state.xp, 42);
  assert.deepEqual(state.rewardLedger, rewardBefore, 'execution reconciliation must not settle rewards');

  const unrelated = structuredClone(state);
  unrelated.focusSession = startFocus(createIdleSession(1_000), {
    now: 1_000,
    durationMs: 60_000,
    sessionId: 'focus-other',
    taskId: 'other-task'
  }).session;
  const untouched = structuredClone(unrelated.focusSession);
  assert.equal(execution.taskCompletion.reconcileCompletedTask(unrelated, {
    taskId: 'task-1',
    now: 31_000
  }).paused, false);
  assert.deepEqual(unrelated.focusSession, untouched, 'another task completion must not touch this session');
});
