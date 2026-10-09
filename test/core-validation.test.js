'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PERSISTED_SCHEMA_VERSION, normalizePersistedState, assertCanonicalPersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload, assertIpcPayload, PayloadValidationError } = require('../src/application/ipc/route-catalog');
const { chatCompletionsEndpoint } = require('../src/core/llm');

// Settings normalization is only reachable through a full persisted state, so
// this shortcut keeps the AI settings assertions readable.
function normalizeSettings(settings) {
  return normalizePersistedState({ settings }, { now: 1_000 }).settings;
}

test('outer schema protects unresolved landing prompts from schema-5 downgrade', () => {
  assert.equal(PERSISTED_SCHEMA_VERSION, 18);
});

test('normalizes malformed persisted state without losing recoverable task text', () => {
  const state = normalizePersistedState({
    tasks: [null, { title: '  保留下来的任务  ', category: 'unknown', steps: 'bad', focusedMs: -1 }],
    settings: { hydrationEvery: 0, workStartHour: 22, workEndHour: 2, nudgeWhitelist: 'bad' },
    stats: { totalFocusMs: 'bad', dailyFocus: { '2026-08-29': 1000, nope: 99 } },
    pet: { satiation: 0, foodInventory: { fish: 0 } },
    focusSession: { status: 'broken' },
    rewardLedger: { events: [{ nope: true }] }
  }, { now: 1234 });

  assert.equal(state.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].title, '保留下来的任务');
  // schema 8 的任务是封闭形状：category 无处可活，无法残留。
  assert.equal('category' in state.tasks[0], false);
  assert.deepEqual(state.tasks[0].steps, []);
  assert.equal(state.settings.hydrationEvery, 15);
  assert.equal(state.settings.workStartHour, 22);
  assert.equal(state.settings.workEndHour, 23);
  assert.deepEqual(state.stats.dailyFocus, { '2026-08-29': 1000 });
  assert.equal(state.pet.satiation, 0);
  assert.equal(state.pet.foodInventory.fish, 0);
  assert.equal(Object.hasOwn(state.pet, 'dailyFeedXp'), false);
  assert.throws(() => normalizePersistedState({ pet: { foodInventory: { fish: -3 } } }), /invalid-pet-count/);
  assert.equal(state.focusSession.status, 'idle');
  assert.deepEqual(state.rewardLedger.events, []);
  assert.deepEqual(state.rewardLedger.seenEventIds, []);
  assert.deepEqual(state.rewardLedger.dailyBucketTotals, {});
});

test('fresh nullable timestamps remain absent instead of becoming the Unix epoch', () => {
  const state = normalizePersistedState({
    pet: { care: { lastObservedAt: null, lastMealAt: null } },
    focusSession: null,
    energyCheckIn: null
  }, { now: 1234 });

  assert.equal(state.pet.care.lastObservedAt, null);
  assert.equal(state.pet.care.lastMealAt, null);
  assert.equal(state.energyCheckIn, null);
  assert.equal(state.focusSession.status, 'idle');
});

test('schema-5 landing prompts migrate and the complete canonical state round-trips across wall time', () => {
  const migrated = normalizePersistedState({
    schemaVersion: 5,
    tasks: [{ id: 'task-1', title: '继续写方案', done: false, createdAt: 100 }],
    focusLandingPrompt: {
      sessionId: ' focus-1 ', taskId: ' task-1 ', completedAt: 900,
      status: 'pending', ignoredLegacyField: true
    }
  }, { now: 1000 });

  assert.equal(migrated.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.deepEqual(migrated.focusLandingPrompt, {
    sessionId: 'focus-1', taskId: 'task-1', completedAt: 900, status: 'pending'
  });
  assert.deepEqual(
    normalizePersistedState(migrated, { now: 5000 }),
    migrated,
    'a state written by the current schema must pass strict startup normalization later without mutation'
  );
});

test('malformed landing prompts normalize to null while linked orphan identity is retained', () => {
  const activeTask = { id: 'task-1', title: '未完成任务', done: false, createdAt: 100 };
  const invalidPrompts = [
    null,
    'pending',
    {},
    { sessionId: 'focus-1', taskId: 'task-1', completedAt: 900, status: 'done' },
    { sessionId: '', taskId: 'task-1', completedAt: 900, status: 'pending' },
    { sessionId: 'focus-1', taskId: '', completedAt: 900, status: 'pending' },
    { sessionId: 'focus-1', taskId: 'task-1', completedAt: 'not-a-time', status: 'pending' }
  ];
  for (const focusLandingPrompt of invalidPrompts) {
    const state = normalizePersistedState({
      schemaVersion: 5,
      tasks: [activeTask],
      focusLandingPrompt
    }, { now: 1000 });
    assert.equal(state.focusLandingPrompt, null);
  }

  const orphaned = normalizePersistedState({
    schemaVersion: 5,
    tasks: [activeTask],
    focusLandingPrompt: {
      sessionId: 'focus-orphan', taskId: 'missing', completedAt: 900, status: 'pending'
    }
  }, { now: 1000 });
  assert.equal(orphaned.focusLandingPrompt.taskId, 'missing');
});

test('migrates legacy step indices to stable unique IDs without changing them again', () => {
  const once = normalizePersistedState({
    tasks: [{
      id: 'task-1', title: '拆解任务',
      steps: [
        { title: '第一步', done: true },
        { id: 'custom-step', title: '第二步' },
        { id: 'custom-step', title: '重复 ID' }
      ]
    }]
  }, { now: 1234 });
  assert.deepEqual(once.tasks[0].steps.map(step => step.id), ['0', 'custom-step', '2']);

  const twice = normalizePersistedState(once, { now: 5678 });
  assert.deepEqual(twice.tasks[0].steps.map(step => step.id), ['0', 'custom-step', '2']);
});

test('repairs duplicate legacy task and impulse IDs deterministically across collections', () => {
  const once = normalizePersistedState({
    tasks: [
      { id: 'same-task', title: '进行中 A' },
      { id: 'same-task', title: '进行中 B' }
    ],
    archivedTasks: [{ id: 'same-task', title: '已归档' }],
    impulses: [
      { id: 'same-impulse', text: '闪念 A' },
      { id: 'same-impulse', text: '闪念 B' }
    ]
  }, { now: 1234 });

  assert.deepEqual(once.tasks.map(task => task.id), ['same-task', 'recovered-1234-1']);
  assert.deepEqual(once.archivedTasks.map(task => task.id), ['recovered-1234-2']);
  assert.deepEqual(once.impulses.map(impulse => impulse.id), ['same-impulse', 'recovered-impulse-1234-1']);

  const twice = normalizePersistedState(once, { now: 5678 });
  assert.deepEqual(twice.tasks.map(task => task.id), once.tasks.map(task => task.id));
  assert.deepEqual(twice.archivedTasks.map(task => task.id), once.archivedTasks.map(task => task.id));
  assert.deepEqual(twice.impulses.map(impulse => impulse.id), once.impulses.map(impulse => impulse.id));
});

test('fails closed when current-schema persisted identities are duplicated', () => {
  assert.throws(() => normalizePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks: [{ id: 'same-task' }, { id: 'same-task' }]
  }), /Duplicate persisted task id/);
  assert.throws(() => normalizePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks: [{ id: 'task-1', steps: [{ id: 'same-step' }, { id: 'same-step' }] }]
  }), /Duplicate persisted step id/);
  assert.throws(() => normalizePersistedState({
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    impulses: [{ id: 'same-impulse' }, { id: 'same-impulse' }]
  }), /Duplicate persisted impulse id/);
});

test('task creation takes orthogonal planning fields instead of a category', () => {
  // A title is the only requirement. Capture must never be blocked by paperwork.
  const minimal = validateIpcPayload('tasks:add', { title: ' 交付报告 ' });
  assert.equal(minimal.ok, true);
  assert.equal(minimal.value.title, '交付报告');
  assert.deepEqual(
    [minimal.value.plannedFor, minimal.value.scheduledFor, minimal.value.deadline, minimal.value.expiresAt],
    [null, null, null, null],
    'a new task carries no implied date of any kind'
  );
  assert.equal(minimal.value.recurrence, null);

  assert.equal(validateIpcPayload('tasks:add', { title: '交付报告', category: 'midterm' }).ok, false);

  // All four dates may coexist: they answer four different questions.
  const full = validateIpcPayload('tasks:add', {
    title: '交付报告',
    energy: 'high',
    tags: [' 工作 ', '工作'],
    estimateMinutes: 90,
    plannedFor: '2026-09-01',
    scheduledFor: '2026-09-01T01:00:00Z',
    deadline: '2026-09-01T23:59:59+08:00',
    expiresAt: '2026-09-03T00:00:00Z'
  });
  assert.equal(full.ok, true);
  assert.equal(full.value.deadline, '2026-09-01T15:59:59.000Z');
  assert.deepEqual(full.value.tags, ['工作'], 'tags are trimmed and de-duplicated');
  assert.equal(full.value.estimateMinutes, 90);

  assert.equal(validateIpcPayload('tasks:add', {
    title: '拆任务', steps: [{ title: '步'.repeat(201) }]
  }).ok, false);
  assert.doesNotThrow(() => validateIpcPayload('tasks:add', {
    title: '超出 JavaScript 日期范围', deadline: 1e100
  }));
  assert.equal(validateIpcPayload('tasks:add', {
    title: '超出 JavaScript 日期范围', deadline: 1e100
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:add', { title: '估时不合法', estimateMinutes: 0 }).ok, false);
  assert.equal(validateIpcPayload('tasks:add', { title: '计划日不合法', plannedFor: '2026-9-1' }).ok, false);
  assert.equal(validateIpcPayload('tasks:add', {
    title: '步骤对象必须封闭',
    steps: [{ title: '只允许标题', done: true }]
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:add-with-breakdown', {
    title: '拆解步骤对象必须封闭',
    steps: [{ title: '只允许标题', metadata: {} }]
  }).ok, false);
});

test('recurrence rules are validated as a whole instead of per task type', () => {
  const weekly = validateIpcPayload('tasks:add', {
    title: '周报',
    recurrence: {
      frequency: 'weekly', interval: 2, weekdays: [3, 1, 1], strategy: 'fixed', anchorDate: '2026-09-07'
    }
  });
  assert.equal(weekly.ok, true);
  assert.deepEqual(weekly.value.recurrence, {
    frequency: 'weekly', interval: 2, weekdays: [1, 3], strategy: 'fixed', anchorDate: '2026-09-07'
  });

  // weekdays only mean something for a weekly rule; anything else is a
  // contradiction the persisted invariant would reject later anyway.
  assert.equal(validateIpcPayload('tasks:add', {
    title: '每日', recurrence: { frequency: 'daily', interval: 1, weekdays: [1], strategy: 'fixed' }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:add', {
    title: '频率未知', recurrence: { frequency: 'yearly', interval: 1, strategy: 'fixed' }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:add', {
    title: '间隔越界', recurrence: { frequency: 'daily', interval: 366, strategy: 'fixed' }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:add', {
    title: '策略未知', recurrence: { frequency: 'daily', interval: 1, strategy: 'whenever' }
  }).ok, false);
});

test('series rule edits preserve an omitted anchor instead of writing null', () => {
  const value = assertIpcPayload('series:update', {
    seriesId: 'series-1',
    rule: { frequency: 'weekly', interval: 2, weekdays: [1, 3], strategy: 'fixed' }
  });
  assert.deepEqual(value.rule, {
    frequency: 'weekly', interval: 2, weekdays: [1, 3], strategy: 'fixed'
  });
  assert.equal(Object.hasOwn(value.rule, 'anchorDate'), false);
});

test('rejects timer-storm settings and malformed timer or pet payloads', () => {
  assert.equal(validateIpcPayload('settings:update', { hydrationEvery: 0 }).ok, false);
  assert.equal(validateIpcPayload('pomodoro:start', { taskId: null, minutes: -1 }).ok, false);
  assert.equal(validateIpcPayload('pomodoro:start', { taskId: null, minutes: 2 }).ok, false);
  assert.equal(validateIpcPayload('pomodoro:kickstart', { taskId: null }).ok, false);
  assert.equal(validateIpcPayload('pomodoro:kickstart', { taskId: '   ' }).ok, false);
  assert.equal(validateIpcPayload('pet:setPosition', { x: Number.NaN, y: 1 }).ok, false);
  assert.equal(validateIpcPayload('pet:feed', 'unknown-food').ok, false);
  assert.equal(validateIpcPayload('settings:update', {
    petPosition: { x: 1, y: 2, screenId: 'unexpected' }
  }).ok, false);

  assert.throws(
    () => assertIpcPayload('settings:update', { hydrationEvery: null }),
    PayloadValidationError
  );
});

test('accepts valid settings, timer, and pet payloads in renderer-compatible shapes', () => {
  assert.deepEqual(
    assertIpcPayload('settings:update', { workStartHour: 9 }, { currentSettings: { workStartHour: 10, workEndHour: 21 } }),
    { workStartHour: 9 }
  );
  assert.deepEqual(assertIpcPayload('pomodoro:start', { taskId: 'task-1', minutes: 25 }), { taskId: 'task-1', minutes: 25 });
  assert.deepEqual(assertIpcPayload('pomodoro:kickstart', { taskId: ' task-1 ' }), { taskId: 'task-1' });
  const taskVersion = 'a'.repeat(64);
  assert.deepEqual(assertIpcPayload('pomodoro:kickstart', { taskId: 'task-1', nextAction: ' Open notes ', taskVersion }),
    { taskId: 'task-1', nextAction: 'Open notes', taskVersion });
  for (const extra of [{ nextAction: 'Action' }, { taskVersion }, { nextAction: null, taskVersion },
    { nextAction: ' ', taskVersion }, { nextAction: 'x'.repeat(201), taskVersion },
    { nextAction: 'Action', taskVersion: 'bad' }, { nextAction: 'Action', taskVersion, extra: true }]) {
    assert.equal(validateIpcPayload('pomodoro:kickstart', { taskId: 'task-1', ...extra }).ok, false);
  }
  assert.deepEqual(assertIpcPayload('pet:setPosition', { x: 1.2, y: null }), { x: 1, y: null });
  const feedRequest = { foodId: 'fish', commandId: '1000-feed', issuedAt: 1000 };
  assert.deepEqual(assertIpcPayload('pet:feed', feedRequest), feedRequest);
  assert.deepEqual(assertIpcPayload('settings:update', { petActivityMode: 'quiet' }), { petActivityMode: 'quiet' });
  assert.equal(validateIpcPayload('settings:update', { petActivityMode: 'unbounded' }).ok, false);
});

test('AI base URLs are parsed as credential-free HTTPS URLs', () => {
  assert.deepEqual(
    assertIpcPayload('settings:update', { aiBaseUrl: ' https://api.example.test/v1?model=small ' }),
    { aiBaseUrl: 'https://api.example.test/v1?model=small' }
  );
  // 留空是一个合法的意思（“API 模式用官方默认地址”），不是错误。
  assert.deepEqual(assertIpcPayload('settings:update', { aiBaseUrl: null }), { aiBaseUrl: null });
  for (const baseUrl of [
    'http://api.example.test/v1',
    'https://',
    'https://%zz',
    'https://user:secret@example.test/v1',
    'https://api.example.test/v1#secret',
    'https://api.example.test/a path'
  ]) {
    assert.equal(validateIpcPayload('settings:update', { aiBaseUrl: baseUrl }).ok, false, baseUrl);
  }
  const expandingUrl = `https://api.example.test/${'界'.repeat(50)}/responses`;
  const expandedBase = assertIpcPayload('settings:update', { aiBaseUrl: expandingUrl }).aiBaseUrl;
  assert.ok(expandedBase.length > 200, 'the fixture must exercise WHATWG percent-encoding expansion');
  assert.equal(normalizeSettings({ aiEndpoint: expandingUrl }).aiBaseUrl, expandedBase);
  assert.equal(normalizeSettings({ aiBaseUrl: expandedBase }).aiBaseUrl, expandedBase);
  assert.equal(
    validateIpcPayload('settings:update', { aiBaseUrl: `https://api.example.test/${'a'.repeat(200)}` }).ok,
    false,
    'the user-facing input remains bounded to 200 characters'
  );
});

test('AI breakdown preview accepts its optional blocker without widening enrich payloads', () => {
  assert.deepEqual(
    assertIpcPayload('ai:preview-breakdown', { title: '整理发布说明', blocker: 'too-big' }),
    { title: '整理发布说明', description: null, clarification: null, taskId: null, blocker: 'too-big' }
  );
  assert.deepEqual(
    assertIpcPayload('ai:preview-breakdown', { title: '整理发布说明' }),
    { title: '整理发布说明', description: null, clarification: null, taskId: null, blocker: null }
  );
  assert.equal(
    validateIpcPayload('ai:preview-enrich', { title: '整理发布说明', blocker: 'too-big' }).ok,
    false,
    'enrich has no blocker field to disclose or send'
  );
  assert.equal(
    validateIpcPayload('ai:preview-breakdown', { title: '整理发布说明', blocker: 'x'.repeat(81) }).ok,
    false
  );
});

test('the unstick request carries only a target and a note, never task content', () => {
  assert.deepEqual(
    assertIpcPayload('ai:suggest-unstick', {}),
    { taskId: null, note: null },
    'asking without a selected task is legal; the main process decides what that means'
  );
  assert.deepEqual(
    assertIpcPayload('ai:suggest-unstick', { taskId: 'task-1', note: '卡在：太大了' }),
    { taskId: 'task-1', note: '卡在：太大了' }
  );
  assert.deepEqual(assertIpcPayload('ai:suggest-unstick', { taskId: 'task-1', note: '' }).note, null);
  // Title and steps are read from the store, so accepting them here would let the
  // renderer choose what leaves the machine.
  assert.equal(validateIpcPayload('ai:suggest-unstick', { taskId: 'task-1', title: '别的标题' }).ok, false);
  assert.equal(validateIpcPayload('ai:suggest-unstick', { note: 'x'.repeat(501) }).ok, false);
  // The shared id bound is 200 inclusive, so 201 is the first rejected length.
  assert.equal(validateIpcPayload('ai:suggest-unstick', { taskId: 'x'.repeat(200) }).ok, true);
  assert.equal(validateIpcPayload('ai:suggest-unstick', { taskId: 'x'.repeat(201) }).ok, false);
});

test('a clarify turn carries a message and at most a conversation id, never task content', () => {
  assert.deepEqual(
    assertIpcPayload('ai:draft-turn', { message: '下周要交周报' }),
    { conversationId: null, message: '下周要交周报' },
    'no conversation id means "open a new one", which is the normal first turn'
  );
  assert.deepEqual(
    assertIpcPayload('ai:draft-turn', { conversationId: 'draft-1', message: '周五下班前' }),
    { conversationId: 'draft-1', message: '周五下班前' }
  );
  assert.equal(assertIpcPayload('ai:draft-turn', { conversationId: null, message: '写周报' }).conversationId, null);
  // A turn without anything said is not a turn; an empty conversation id is a
  // caller bug, not a request for a new conversation.
  assert.equal(validateIpcPayload('ai:draft-turn', { message: '   ' }).ok, false);
  assert.equal(validateIpcPayload('ai:draft-turn', { conversationId: '', message: '写周报' }).ok, false);
  assert.equal(validateIpcPayload('ai:draft-turn', { message: 'x'.repeat(2000) }).ok, true);
  assert.equal(validateIpcPayload('ai:draft-turn', { message: 'x'.repeat(2001) }).ok, false);
  // The clarified task is submitted over the existing task commands, so this
  // channel must not grow a second way to state task content.
  assert.equal(validateIpcPayload('ai:draft-turn', { message: '写周报', title: '周报' }).ok, false);
  assert.equal(validateIpcPayload('ai:draft-turn', { message: '写周报', senderId: 'webContents:1' }).ok, false);

  assert.deepEqual(assertIpcPayload('ai:draft-discard', { conversationId: 'draft-1' }), { conversationId: 'draft-1' });
  // Discard names one conversation. Without an id it would mean "drop whatever
  // you have", and the main process would have to guess which one.
  assert.equal(validateIpcPayload('ai:draft-discard', {}).ok, false);
  assert.equal(validateIpcPayload('ai:draft-discard', { conversationId: 'draft-1', message: 'x' }).ok, false);
});

test('a pasted request path comes off the base URL instead of surviving into the request', () => {
  // 用户的剪贴板里装的通常是文档上的完整接口地址。把它原样存下，拼路径时
  // 就会得到 …/chat/completions/responses 这种不可能存在的 URL。
  for (const [pasted, stored] of [
    ['https://api.example.test/v1/chat/completions', 'https://api.example.test/v1'],
    ['https://api.example.test/v1/responses', 'https://api.example.test/v1'],
    ['https://api.example.test/v1/completions', 'https://api.example.test/v1'],
    ['https://api.example.test/api/openai/v1/chat/completions/', 'https://api.example.test/api/openai/v1'],
    // 已经是 base URL 的原样不动，只去掉末尾斜杠。
    ['https://api.example.test/v1/', 'https://api.example.test/v1'],
    ['https://api.example.test/v1', 'https://api.example.test/v1'],
    // Protocol-looking hostnames are origins, never removable path segments.
    ['https://responses', 'https://responses'],
    ['https://responses/responses', 'https://responses'],
    ['https://completions/responses', 'https://completions'],
    // WHATWG accepts these special-scheme spellings. Parsing first keeps their
    // authority identical to the URL that fetch will ultimately use.
    ['https:////responses/responses', 'https://responses'],
    ['https:/responses/responses', 'https://responses'],
    ['https:responses/responses', 'https://responses'],
    [String.raw`https:\\responses\responses`, 'https://responses'],
    // Repeated suffixes and extra path separators reach a fixed point in one
    // pass instead of changing again on the next settings update.
    ['https://api.example.test/responses/responses', 'https://api.example.test'],
    ['https://api.example.test//responses', 'https://api.example.test'],
    // Query parameters stay attached to the URL while only the pathname loses
    // its request suffix.
    [
      'https://api.example.test/v1/responses?api-version=2026-01-01',
      'https://api.example.test/v1?api-version=2026-01-01'
    ]
  ]) {
    const first = assertIpcPayload('settings:update', { aiBaseUrl: pasted });
    assert.deepEqual(first, { aiBaseUrl: stored }, pasted);
    assert.equal(
      assertIpcPayload('settings:update', first).aiBaseUrl,
      stored,
      `${pasted} must normalize idempotently`
    );
  }
  // 剥离必须幂等，否则提交边界会在两次规范化上报不一致。
  assert.deepEqual(
    assertIpcPayload('settings:update', { aiBaseUrl: 'https://api.example.test/v1' }),
    { aiBaseUrl: 'https://api.example.test/v1' }
  );

  // 但读盘时不得改写：规范化每次启动都跑，改一个已存值会把一份完全可读的
  // 文件送进同版本迁移守卫，而那里认不出这种变化 —— 结果是 App 启不了。
  const stale = 'https://api.example.test/v1/chat/completions';
  assert.equal(normalizeSettings({ aiBaseUrl: stale }).aiBaseUrl, stale);
  // 旧值在真正用到它的地方被剥干净，而不是拼出一个不存在的 URL。
  assert.equal(chatCompletionsEndpoint(stale), 'https://api.example.test/v1/chat/completions');
  assert.equal(chatCompletionsEndpoint('https://api.example.test/v1'), 'https://api.example.test/v1/chat/completions');
  assert.equal(chatCompletionsEndpoint('https://responses'), 'https://responses/chat/completions');
  assert.equal(
    chatCompletionsEndpoint('https://api.example.test/v1/responses?api-version=2026-01-01'),
    'https://api.example.test/v1/chat/completions?api-version=2026-01-01'
  );
});

test('an API key may be pasted in, but never quoted back out', () => {
  // 空负载 = “从环境变量读”，这条路径下密钥根本不经过 renderer。
  assert.equal(assertIpcPayload('ai:credential-import', undefined), undefined);
  assert.deepEqual(assertIpcPayload('ai:credential-import', { secret: '  sk-test-value  ' }), { secret: 'sk-test-value' });
  for (const secret of ['', '   ', 'has space', 'a'.repeat(4097), 42, null, undefined]) {
    const result = validateIpcPayload('ai:credential-import', { secret });
    assert.equal(result.ok, false, String(secret));
    // 报错会被 Electron 记到日志里，所以一个字也不能引用密钥本身。
    if (typeof secret === 'string' && secret.trim()) {
      assert.ok(!result.errors.join(' ').includes(secret.trim()), 'the error must not quote the secret');
    }
  }
  assert.equal(validateIpcPayload('ai:credential-import', { secret: 'sk-x', extra: 1 }).ok, false);
  assert.equal(validateIpcPayload('ai:credential-import', 'sk-x').ok, false);
});

test('there is no provider mode to get wrong, and the model id is a bounded string', () => {
  // `aiProvider` 枚举被删掉了：只剩一种连接形态（一个 OpenAI 兼容端点），
  // “连哪儿”完全由 aiBaseUrl 决定。一个只能取单值的模式开关不提供信息，
  // 只提供选错的机会；aiBreakdownEnabled 仍然是唯一的总开关。
  assert.equal(normalizeSettings({}).aiProvider, undefined);
  assert.equal(normalizeSettings({ aiProvider: 'local' }).aiProvider, undefined, '旧持久值静默消失，不报错');
  assert.equal(
    normalizeSettings({ aiProvider: 'none', aiBreakdownEnabled: true }).aiBreakdownEnabled,
    false,
    '旧 none 开关必须保留禁用远程 AI 的语义'
  );
  assert.equal(
    normalizeSettings({
      aiProvider: 'local',
      aiModel: 'local-model',
      aiBaseUrl: 'https://public.example.test/v1',
      aiBreakdownEnabled: true
    }).aiBreakdownEnabled,
    false,
    '旧 loopback-only 模式不能被重解释为已启用的公网 provider'
  );
  assert.equal(
    normalizeSettings({ aiProvider: 'api', aiBreakdownEnabled: true }).aiBreakdownEnabled,
    false,
    '旧 api 没有持久化模型，升级后必须重新确认'
  );
  assert.equal(
    normalizeSettings({ aiProvider: 'api', aiModel: 'gpt-5-mini', aiBreakdownEnabled: true }).aiBreakdownEnabled,
    true,
    '已持久化模型的中间版本只需移除 provider'
  );
  for (const provider of ['api', 'local', 'none']) {
    assert.equal(validateIpcPayload('settings:update', { aiProvider: provider }).ok, false, provider);
  }
  // 模型 id 的形状因厂商而异，校验只管字符集与长度，不猜命名约定。
  for (const model of ['gpt-5-mini', 'anthropic/claude-sonnet-4', 'qwen2.5:7b', 'Qwen_3-32B.v2']) {
    assert.deepEqual(assertIpcPayload('settings:update', { aiModel: ` ${model} ` }), { aiModel: model });
  }
  for (const model of ['', '   ', '-leading-dash', 'has space', 'a'.repeat(81), 'semi;colon', 42, null]) {
    assert.equal(validateIpcPayload('settings:update', { aiModel: model }).ok, false, String(model));
  }
});

test('settings written before base URLs existed keep their endpoint as a base URL', () => {
  // 旧字段存的是完整 endpoint。掉一段路径就是它的 base URL，比直接丢掉好。
  assert.equal(
    normalizeSettings({ aiEndpoint: 'https://api.example.test/v1/responses' }).aiBaseUrl,
    'https://api.example.test/v1'
  );
  assert.equal(
    normalizeSettings({ aiEndpoint: 'https://api.example.test/v1/responses/' }).aiBaseUrl,
    'https://api.example.test/v1'
  );
  // 不带那段路径的旧值原样当 base URL 用。
  assert.equal(
    normalizeSettings({ aiEndpoint: 'https://api.example.test/v1' }).aiBaseUrl,
    'https://api.example.test/v1'
  );
  // 新字段优先，而且规范化必须幂等 —— 提交边界会跑两次并比对结果。
  const once = normalizeSettings({ aiEndpoint: 'https://old.test/v1/responses', aiBaseUrl: 'https://new.test/v1' });
  assert.equal(once.aiBaseUrl, 'https://new.test/v1');
  assert.deepEqual(normalizeSettings(once), once);
  assert.equal(normalizeSettings({}).aiBaseUrl, null);
  assert.equal(normalizeSettings({}).aiBreakdownEnabled, false);
  // 拿默认值本身当期望值：改默认模型是产品决定，不该连带改测试。
  const defaultModel = normalizeSettings({}).aiModel;
  assert.match(defaultModel, /^\S+$/);
  assert.equal(normalizeSettings({ aiModel: 'bad model' }).aiModel, defaultModel);
});

test('validates work-hour relationships when current settings are available', () => {
  const invalid = validateIpcPayload(
    'settings:update',
    { workStartHour: 22 },
    { currentSettings: { workStartHour: 10, workEndHour: 21 } }
  );
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(' '), /workEndHour must be later/);

  assert.equal(validateIpcPayload('pet:dragStart', undefined).ok, true);
  assert.equal(validateIpcPayload('tasks:preview-breakdown', '  写方案  ').value, '写方案');
  assert.equal(validateIpcPayload('tasks:preview-breakdown', '写'.repeat(101)).ok, false);
  assert.deepEqual(validateIpcPayload('tasks:dismiss-proposal', {
    proposalId: 'proposal-1'
  }).value, { proposalId: 'proposal-1' });
  assert.equal(validateIpcPayload('tasks:dismiss-proposal', { proposalId: 'x'.repeat(201) }).ok, false);
  assert.equal(validateIpcPayload('tasks:dismiss-proposal', {
    proposalId: 'proposal-1', extra: true
  }).ok, false);
});

test('task updates enforce supported fields and demand a scope for recurring work', () => {
  assert.deepEqual(assertIpcPayload('tasks:update', {
    id: 'task-1', patch: { title: ' 新标题 ', energy: 'auto' }
  }, { currentTask: { seriesId: null } }), {
    id: 'task-1', patch: { title: '新标题', energy: 'auto' }, scope: undefined
  });
  // The four planning fields are independent, so any of them may be patched on
  // any task — including clearing one back to null.
  assert.deepEqual(assertIpcPayload('tasks:update', {
    id: 'task-1', patch: { deadline: null, expiresAt: '2026-09-01T08:00:00Z', plannedFor: '2026-09-01' }
  }, { currentTask: { seriesId: null } }).patch, {
    plannedFor: '2026-09-01', deadline: null, expiresAt: '2026-09-01T08:00:00.000Z'
  });
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { category: 'midterm' }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { title: 'x'.repeat(101) }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { done: true }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:update', { id: 'task-1', patch: {} }).ok, false);

  // Editing an occurrence must say whether the series template moves with it.
  const recurringContext = { currentTask: { seriesId: 'series-1' } };
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { title: '改标题' }
  }, recurringContext).ok, false);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { title: '改标题' }, scope: 'current-and-future'
  }, recurringContext).ok, true);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { title: '改标题' }, scope: 'everything'
  }, recurringContext).ok, false);
});

test('step edits are explicit operations on stable identities', () => {
  const reordered = assertIpcPayload('tasks:update', {
    id: 'task-1',
    patch: {
      steps: [
        { op: 'add', title: ' 打开文档 ' },
        { op: 'rename', stepId: ' step-a ', title: '改一下' },
        { op: 'remove', stepId: 'step-b' },
        { op: 'reorder', stepIds: ['step-a', 'step-c'] }
      ]
    }
  }, { currentTask: { seriesId: null } });
  assert.deepEqual(reordered.patch.steps, [
    { op: 'add', title: '打开文档' },
    { op: 'rename', stepId: 'step-a', title: '改一下' },
    { op: 'remove', stepId: 'step-b' },
    { op: 'reorder', stepIds: ['step-a', 'step-c'] }
  ]);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { steps: [{ op: 'toggle', stepId: 'step-a' }] }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { steps: [{ op: 'reorder', stepIds: ['step-a', 'step-a'] }] }
  }).ok, false);
  assert.equal(validateIpcPayload('tasks:update', {
    id: 'task-1', patch: { steps: [] }
  }).ok, false);
});

test('normalizes every 0.1.0 persisted field and keeps archived tasks out of Now', () => {
  const state = normalizePersistedState({
    schemaVersion: 1,
    tasks: [{
      id: 'active', title: '继续写方案', category: 'midterm', deadline: '2026-09-01T08:00:00Z',
      scheduledFor: '2026-08-29T02:00:00Z', scheduleNotifiedAt: 700,
      energy: 'high', energyAuto: false, suggestedMin: 45, createdAt: 100,
      selectionCount: 3, avoidanceCount: 2, lastSelectedAt: 200, lastStartedAt: 300,
      lastAvoidedAt: 400, blocker: '范围太大', nextAction: '打开空白文档'
    }],
    archivedTasks: [{
      id: 'archived', title: '以后再看', category: 'adhoc', createdAt: 90,
      archivedAt: 500, archiveReason: 'someday'
    }],
    nowTaskId: 'archived',
    stats: {
      dailyLaunches: { '2026-08-28': 2 },
      dailyReturns: { '2026-08-28': 1 },
      dailyCompletions: { '2026-08-28': 3 },
      healthyShutdownCount: 8,
      healthyShutdownStreak: 4,
      lastHealthyShutdownDate: '2026-08-28'
    },
    settings: {
      motionMode: 'reduced', stimulationMode: 'low', energyCheckInHalfLifeMinutes: 240
    },
    pet: {
      satiation: 42.75, foodTickets: 6, lastTicketDay: '2026-08-28',
      care: { lastObservedAt: 600, lastMealAt: 700 }
    },
    focusSession: {
      status: 'paused', pausedFrom: 'quick-start', sessionId: 'session-1', taskId: 'active',
      plannedDurationMs: 120000, elapsedBeforeStartMs: 60000, pausedAt: 800,
      activeSegments: [{ startedAt: 700, endedAt: 800 }], createdAt: 700, updatedAt: 800
    },
    quickStartDecision: {
      sessionId: 'session-1', taskId: 'active', completedAt: 900,
      elapsedMs: 120000, status: 'pending'
    },
    focusLandingPrompt: {
      sessionId: 'focus-2', taskId: 'active', completedAt: 950, status: 'pending', ignored: true
    },
    energyCheckIn: { level: 25, state: 'low', timestamp: 1000 },
    rewardLedger: { events: [{
      eventId: 'quick-start:session-1:1', source: 'quick-start-complete',
      dateKey: '2026-08-28', bucket: 'focus', baseReward: 5,
      awardedReward: 5, createdAt: 1000, metadata: { taskId: 'active' }
    }] }
  }, { now: 1100 });

  assert.equal(state.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.equal(state.nowTaskId, null);
  assert.equal(state.tasks[0].nextAction, '打开空白文档');
  assert.equal(state.tasks[0].scheduledFor, '2026-08-29T02:00:00.000Z');
  assert.equal(state.tasks[0].scheduleNotifiedAt, 700);
  assert.equal(state.tasks[0].selectionCount, 3);
  assert.equal(state.tasks[0].avoidanceCount, 2);
  assert.equal(state.archivedTasks[0].archiveReason, 'someday');
  assert.deepEqual(state.stats.dailyLaunches, { '2026-08-28': 2 });
  assert.deepEqual(state.stats.dailyReturns, { '2026-08-28': 1 });
  assert.equal(state.stats.healthyShutdownCount, 8);
  assert.equal(state.stats.healthyShutdownStreak, 4);
  assert.equal(state.settings.motionMode, 'reduced');
  assert.equal(state.settings.stimulationMode, 'low');
  assert.equal(state.settings.energyCheckInHalfLifeMinutes, 240);
  assert.equal(state.pet.satiation, 42.75);
  assert.equal(state.pet.care.lastObservedAt, 600);
  assert.equal(state.pet.care.lastMealAt, 700);
  assert.equal(state.focusSession.status, 'paused');
  assert.equal(state.focusSession.pausedFrom, 'quick-start');
  assert.deepEqual(state.focusSession.activeSegments, [{ startedAt: 700, endedAt: 800 }]);
  assert.equal(state.quickStartDecision.status, 'pending');
  assert.deepEqual(state.focusLandingPrompt, {
    sessionId: 'focus-2', taskId: 'active', completedAt: 950, status: 'pending'
  });
  assert.deepEqual(state.energyCheckIn, { level: 25, state: 'low', timestamp: 1000 });
  assert.equal(state.rewardLedger.events.length, 1);
  assert.deepEqual(state.rewardLedger.seenEventIds, ['quick-start:session-1:1']);
  assert.equal(state.rewardLedger.dailyBucketTotals['2026-08-28'].focus, 5);
});

test('current18 preserves fractional satiation and refuses retired care fields', () => {
  const current = normalizePersistedState({}, { now: 0 });
  current.pet.satiation = 44.999999444444444;
  current.pet.care.lastObservedAt = 1_799_999;

  assert.deepEqual(
    normalizePersistedState(current, { now: 2_000_000 }),
    current,
    'satiation sampling must round-trip without integer rounding'
  );
  assert.doesNotThrow(() => assertCanonicalPersistedState(current));
  current.pet.satiationDecayRemainder = 0.5;
  assert.throws(() => assertCanonicalPersistedState(current), /not-canonical/);
});

test('only an existing unfinished task can survive as the persisted Now task', () => {
  const selected = normalizePersistedState({
    tasks: [
      { id: 'done', title: '已完成', done: true },
      { id: 'active', title: '可继续', done: false }
    ],
    nowTaskId: 'active'
  }, { now: 100 });
  assert.equal(selected.nowTaskId, 'active');

  const completed = normalizePersistedState({
    tasks: [{ id: 'done', title: '已完成', done: true }],
    nowTaskId: 'done',
    focusLandingPrompt: {
      sessionId: 'focus-done', taskId: 'done', completedAt: 50, status: 'pending'
    }
  }, { now: 100 });
  assert.equal(completed.nowTaskId, null);
  assert.equal(completed.focusLandingPrompt.taskId, 'done');

  const skippedSource = normalizePersistedState({
    tasks: [{ id: 'skipped', title: '已跳过', category: 'daily', done: false }]
  }, { now: Date.parse('2026-08-28T12:00:00Z') });
  skippedSource.tasks[0].skippedAt = 60;
  skippedSource.recurrenceSeries[0].openTaskId = null;
  skippedSource.nowTaskId = 'skipped';
  skippedSource.focusLandingPrompt = {
    sessionId: 'focus-skipped', taskId: 'skipped', completedAt: 50, status: 'pending'
  };
  const skipped = normalizePersistedState(skippedSource, { now: 100 });
  assert.equal(skipped.nowTaskId, null);
  assert.equal(skipped.focusLandingPrompt.taskId, 'skipped');

  const futureScheduled = normalizePersistedState({
    tasks: [{ id: 'future-slot', title: '明天再看', scheduledFor: '2026-08-29T10:00:00Z' }],
    nowTaskId: 'future-slot'
  }, { now: Date.parse('2026-08-28T10:00:00Z') });
  assert.equal(futureScheduled.nowTaskId, 'future-slot');

  const boundedTimestamp = normalizePersistedState({
    tasks: [{ id: 'future', title: '异常时间', createdAt: 1e100, lastSelectedAt: 1e100 }]
  }, { now: 1234 });
  assert.equal(boundedTimestamp.tasks[0].createdAt, 1234);
  assert.equal(boundedTimestamp.tasks[0].lastSelectedAt, null);
});

test('current-schema Now state stays canonical after an adhoc task crosses its expiry', () => {
  const beforeExpiry = Date.parse('2026-08-29T12:00:00Z');
  const afterExpiry = Date.parse('2026-08-30T12:00:00Z');
  const persisted = normalizePersistedState({
    tasks: [{
      id: 'adhoc-1', title: '明天继续', category: 'adhoc', done: false,
      createdAt: beforeExpiry, expiresAt: '2026-08-30T00:00:00.000Z', expired: false
    }],
    nowTaskId: 'adhoc-1'
  }, { now: beforeExpiry });

  assert.equal(persisted.schemaVersion, PERSISTED_SCHEMA_VERSION);
  assert.deepEqual(normalizePersistedState(persisted, { now: afterExpiry }), persisted);
});

test('validates archive, restore, set-now and clarify commands without silent truncation', () => {
  for (const channel of ['tasks:archive', 'tasks:restore', 'tasks:set-now']) {
    assert.equal(assertIpcPayload(channel, '  task-1  '), 'task-1');
    assert.equal(validateIpcPayload(channel, '').ok, false);
    assert.equal(validateIpcPayload(channel, 'x'.repeat(201)).ok, false);
    assert.equal(validateIpcPayload(channel, { id: 'task-1' }).ok, false);
  }

  assert.deepEqual(assertIpcPayload('tasks:clarify-now', {
    taskId: ' task-1 ', blocker: ' 范围太大 ', nextAction: ' 打开空白文档 '
  }), { taskId: 'task-1', blocker: '范围太大', nextAction: '打开空白文档' });
  assert.equal(validateIpcPayload('tasks:clarify-now', { taskId: 'task-1', blocker: '' }).ok, false);
  assert.equal(validateIpcPayload('tasks:clarify-now', { taskId: 'task-1', blocker: '卡'.repeat(81) }).ok, false);
  assert.equal(validateIpcPayload('tasks:clarify-now', { taskId: 'task-1', nextAction: '做'.repeat(201) }).ok, false);
  assert.equal(validateIpcPayload('tasks:clarify-now', { taskId: 'task-1', extra: true }).ok, false);
});

test('completion channels are one-way and use stable identities', () => {
  assert.deepEqual(assertIpcPayload('tasks:complete-step', {
    taskId: ' task-1 ', stepId: ' step-a '
  }), { taskId: 'task-1', stepId: 'step-a' });
  assert.equal(validateIpcPayload('tasks:complete-step', { taskId: 'task-1', stepIdx: 0 }).ok, false);
  assert.equal(validateIpcPayload('tasks:complete-step', { taskId: 'task-1', stepId: '' }).ok, false);

  // Finishing a task with unfinished steps needs an explicit confirmation,
  // because completion is final and there is no reopen.
  assert.deepEqual(assertIpcPayload('tasks:complete', { id: ' task-1 ' }), {
    id: 'task-1', confirmUnfinishedSteps: false
  });
  assert.deepEqual(assertIpcPayload('tasks:complete', { id: 'task-1', confirmUnfinishedSteps: true }), {
    id: 'task-1', confirmUnfinishedSteps: true
  });
  assert.equal(validateIpcPayload('tasks:complete', { id: 'task-1', confirmUnfinishedSteps: 'yes' }).ok, false);
  assert.equal(validateIpcPayload('tasks:complete', { id: 'task-1', done: false }).ok, false);

  // The retired reversible checkbox must not come back through a stale channel.
  assert.equal(validateIpcPayload('tasks:toggle', 'task-1').ok, false);
  assert.equal(validateIpcPayload('tasks:toggleStep', { taskId: 'task-1', stepId: 'step-a' }).ok, false);

  assert.deepEqual(assertIpcPayload('tasks:skip-occurrence', { id: ' task-1 ' }), { id: 'task-1' });
  assert.deepEqual(assertIpcPayload('tasks:duplicate', { id: ' task-1 ' }), { id: 'task-1' });
  assert.equal(validateIpcPayload('tasks:skip-occurrence', 'task-1').ok, false);
  assert.equal(validateIpcPayload('tasks:duplicate', { id: 'task-1', extra: true }).ok, false);
});

test('notice dismissal uses the documented closed object payload', () => {
  assert.deepEqual(assertIpcPayload('notices:dismiss', { id: ' notice-1 ' }), { id: 'notice-1' });
  assert.equal(validateIpcPayload('notices:dismiss', 'notice-1').ok, false);
  assert.equal(validateIpcPayload('notices:dismiss', { id: 'notice-1', extra: true }).ok, false);
});

test('pick-one exposes exactly the two complementary recommendation strategies', () => {
  assert.deepEqual(assertIpcPayload('tasks:pickOne', undefined), { limit: 2, explain: true });
  assert.deepEqual(assertIpcPayload('tasks:pickOne', { limit: 1, explain: false }), { limit: 1, explain: false });
  assert.deepEqual(assertIpcPayload('tasks:pickOne', { limit: 2 }), { limit: 2, explain: true });
  assert.equal(validateIpcPayload('tasks:pickOne', { limit: 3 }).ok, false);
  assert.equal(validateIpcPayload('tasks:pickOne', { limit: 1.5 }).ok, false);
  assert.equal(validateIpcPayload('tasks:pickOne', { limit: 2, strategy: 'random' }).ok, false);
});

test('pause, resume and landing resolutions accept only their documented shapes', () => {
  for (const channel of ['pomodoro:pause']) {
    assert.equal(validateIpcPayload(channel, undefined).ok, true);
    assert.equal(validateIpcPayload(channel, null).ok, true);
    assert.equal(validateIpcPayload(channel, {}).ok, false);
  }

  for (const action of ['stop', 'done', 'enough', 'extend', 'continue', 'extend-8', 'full', 'full-round', 'full-session']) {
    const request = { sessionId: 'quick-1', action, landingNote: null, progressMade: false };
    assert.deepEqual(assertIpcPayload('pomodoro:resolve-quick-start', request), request);
    assert.equal(validateIpcPayload('pomodoro:resolve-quick-start', action).ok, false);
  }
  assert.deepEqual(assertIpcPayload('pomodoro:resolve-quick-start', {
    sessionId: 'quick-1', action: 'extend-8', landingNote: '  从失败用例继续  ', progressMade: true
  }), { sessionId: 'quick-1', action: 'extend-8', landingNote: '从失败用例继续', progressMade: true });
  for (const action of [undefined, null, '', 'later', {}, 1]) {
    assert.equal(validateIpcPayload('pomodoro:resolve-quick-start', action).ok, false);
  }
  assert.equal(validateIpcPayload('pomodoro:resolve-quick-start', {
    sessionId: 'quick-1', action: 'stop', landingNote: 'x'.repeat(201), progressMade: false
  }).ok, false);
  for (const action of ['save', 'skip']) {
    const note = action === 'save' ? '打开 PR，先读第一条评论' : null;
    assert.deepEqual(assertIpcPayload('pomodoro:resolve-focus-landing', {
      sessionId: ' focus-1 ', action, landingNote: note, progressMade: false
    }), { sessionId: 'focus-1', action, landingNote: note, progressMade: false });
  }
  for (const channel of ['pomodoro:resolve-quick-start', 'pomodoro:resolve-focus-landing']) {
    for (const progressMade of [undefined, null, 0, 1, 'yes']) {
      assert.equal(validateIpcPayload(channel, { sessionId: 'focus-1', action: 'skip', landingNote: null, progressMade }).ok, false);
    }
  }
  for (const payload of [
    { sessionId: '', action: 'skip', landingNote: null },
    { sessionId: 'focus-1', action: 'later', landingNote: null },
    { sessionId: 'focus-1', action: 'save', landingNote: '   ' },
    { sessionId: 'focus-1', action: 'skip', landingNote: 'should not save' },
    { sessionId: 'focus-1', action: 'save', landingNote: 'x'.repeat(201) },
    { sessionId: 'focus-1', action: 'save', landingNote: 'next', extra: true }
  ]) {
    assert.equal(validateIpcPayload('pomodoro:resolve-focus-landing', { ...payload, progressMade: false }).ok, false);
  }

});

test('validates all four impulse review outcomes and rejects ambiguous actions', () => {
  for (const action of ['delete', 'next-step', 'schedule', 'someday']) {
    assert.deepEqual(assertIpcPayload('impulses:review', { id: ' impulse-1 ', action }), {
      id: 'impulse-1', action
    });
  }
  assert.equal(validateIpcPayload('impulses:review', { id: 'impulse-1', action: 'promote' }).ok, false);
  assert.equal(validateIpcPayload('impulses:review', { id: '', action: 'delete' }).ok, false);
  assert.equal(validateIpcPayload('impulses:review', { id: 'impulse-1', action: 'delete', title: 'injected' }).ok, false);
});

test('energy check-ins require a bounded level, declared band, and current timestamp', () => {
  const now = Date.now();
  assert.deepEqual(assertIpcPayload('energy:check-in', {
    level: 55, state: 'medium', timestamp: now
  }), { level: 55, state: 'medium', timestamp: now });

  const invalid = [
    { level: 9, state: 'low', timestamp: now },
    { level: 91, state: 'high', timestamp: now },
    { level: 55.5, state: 'medium', timestamp: now },
    { level: 55, state: 'unknown', timestamp: now },
    { level: 55, state: 'medium', timestamp: -1 },
    { level: 55, state: 'medium', timestamp: now + 10 * 60 * 1000 },
    { level: 55, state: 'medium', timestamp: null },
    { level: 55, state: 'medium', timestamp: '' },
    { level: 55, state: 'medium', timestamp: String(now) },
    { level: 55, state: 'medium', timestamp: now, extra: true }
  ];
  for (const payload of invalid) assert.equal(validateIpcPayload('energy:check-in', payload).ok, false);

  for (const direction of ['lower', 'same', 'higher']) {
    assert.deepEqual(assertIpcPayload('energy:adjust', { direction }), { direction });
  }
  assert.equal(validateIpcPayload('energy:adjust', { direction: 'maximum' }).ok, false);
  assert.equal(validateIpcPayload('energy:adjust', { direction: 'higher', level: 90 }).ok, false);

  const buyRequest = { foodId: 'berry', commandId: '1000-buy', issuedAt: 1000 };
  assert.deepEqual(assertIpcPayload('pet:buy-food', buyRequest), buyRequest);
  assert.equal(validateIpcPayload('pet:buy-food', { foodId: 'unknown' }).ok, false);
  assert.equal(validateIpcPayload('pet:buy-food', { foodId: 'berry', amount: 2 }).ok, false);
});

test('nudge pointer and pet interaction/content channels have narrow payload contracts', () => {
  assert.equal(assertIpcPayload('nudge:pointer-interactive', true), true);
  assert.equal(assertIpcPayload('nudge:pointer-interactive', false), false);
  for (const invalid of [0, 1, 'true', {}, null, undefined]) {
    assert.equal(validateIpcPayload('nudge:pointer-interactive', invalid).ok, false);
  }

  for (const interaction of ['fling', 'click-3', 'click-5', 'click-10', 'click-20', 'click-50']) {
    assert.equal(assertIpcPayload('pet:interaction', interaction), interaction);
  }
  for (const invalid of ['click-1', 'click-500', 'dig', 'dig-treasure', '', null, { interaction: 'fling' }]) {
    assert.equal(validateIpcPayload('pet:interaction', invalid).ok, false);
  }

  assert.equal(validateIpcPayload('pet:getContent', undefined).ok, true);
  assert.equal(validateIpcPayload('pet:getContent', null).ok, true);
  assert.equal(validateIpcPayload('pet:getContent', {}).ok, false);
  assert.equal(validateIpcPayload('pet:getContextualLine', { state: 'focused', extra: true }).ok, false);
  assert.deepEqual(assertIpcPayload('pet:getContextualLine', {
    hour: 23.5, state: 'focused', energyLevel: 25,
    hoursIdle: 1.5, workStart: 9, workEnd: 24
  }), {
    hour: 23.5, state: 'focused', energyLevel: 25,
    hoursIdle: 1.5, workStart: 9, workEnd: 24
  });
  // 连续天数已经不存在了：老渲染端还带着 streak 就是未知字段，不是被悄悄忽略。
  assert.equal(validateIpcPayload('pet:getContextualLine', { state: 'focused', streak: 7 }).ok, false);
});
