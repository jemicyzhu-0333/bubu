'use strict';

// popover module 的运行时冒烟。
//
// 这一页的其余测试全是对源码文本做正则断言：它们能守住“写下来的东西”，守不住
// “跑起来会怎样”。popover 在构造 surface 时就绑定 DOM listener，所以
// 任何一次 HTML 重构删掉或改名一个 id，都会在启动瞬间抛 TypeError —— 而全部
// 字符串断言仍然是绿的。
//
// 这里把真实的 popover.html 解析出 id 清单，用一个只认这些 id 的 DOM 桩加载
// 真实的 popover.mjs：查一个 HTML 里不存在的 id 会拿到 null，于是接线立刻炸，
// 正是我们要的。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URL } = require('node:url');
const { createRendererModuleLoader } = require('../test-support/renderer-modules');
const { DEFAULT_SETTINGS } = require('../src/capabilities/preferences');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createIdleSession } = require('../src/capabilities/execution').focusSession;
const { STRATEGIES } = require('../src/content/strategies');
const { RasterBrowserImage } = require('../test-support/raster-browser-image.js');

const ROOT = path.join(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const html = fs.readFileSync(path.join(RENDERER_DIR, 'popover.html'), 'utf8');

// popover.html 里真实存在的 id 与 class，就是渲染层可以合法查到的全部东西。
const HTML_IDS = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
const HTML_CLASSES = new Set(
  [...html.matchAll(/\sclass="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)).filter(Boolean)
);

// 加载清单从 popover.html 里读，不在这里手拄一份：手拄的那份一旦漏了一个
// <script>，失败会长得像渲染层的 bug，而且页面新增脚本时不会自动跟上。

function createCanvasContextStub() {
  // 2D 上下文只需要“不抛”：这个测试守的是接线，不是像素。
  return new Proxy({}, {
    get: (target, key) => {
      if (key in target) return target[key];
      return () => undefined;
    },
    set: (target, key, value) => { target[key] = value; return true; }
  });
}

function createElementStub(description) {
  const listeners = new Map();
  const descendants = new Map();
  const children = [];
  let innerHTML = '';
  const element = {
    __stub: description,
    isConnected: true,
    disabled: false,
    hidden: false,
    open: false,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    tabIndex: 0,
    // 自定义属性(--focus-primary 这类)只能经 setProperty 写。桩里让它落到自己身上，
    // 于是 style.left = '…' 这种直接赋值与 setProperty 写进来的值都能被读回来。
    style: {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
      getPropertyValue(name) { return this[name] === undefined ? '' : this[name]; }
    },
    dataset: {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    appendChild: child => { children.push(child); return child; },
    append(...nodes) { children.push(...nodes); },
    prepend(...nodes) { children.unshift(...nodes); },
    remove() {},
    insertBefore: child => { children.push(child); return child; },
    replaceChildren(...nodes) { children.length = 0; children.push(...nodes); },
    focus() {},
    blur() {},
    click() {},
    scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    closest: () => null,
    matches: () => false,
    // 步骤行、任务卡这些由 JS 拼出来的结构只存在于 innerHTML 与 appendChild 里。
    // 元素级 querySelector 一律返回 null 时，每条模板渲染路径都会在第一次
    // addEventListener 上就炸，于是它下游的行为（比如提交时发出的 payload）
    // 一个字都测不到。所以这里按“自己这段 innerHTML 里真写了这个 class 吗”回答，
    // 否则往已接上来的子节点里找。
    querySelector(selector) {
      const id = String(selector).match(/^#([\w-]+)$/);
      if (id && new RegExp(`id=["']${id[1]}["']`).test(innerHTML)) {
        if (!descendants.has(selector)) descendants.set(selector, createElementStub(`${description} ${selector}`));
        return descendants.get(selector);
      }
      const classNames = String(selector).match(/^\.([\w-]+(?:\.[\w-]+)*)$/);
      if (!classNames) return null;
      const requestedClasses = classNames[1].split('.');
      const matchingClass = [...innerHTML.matchAll(/class=["']([^"']+)["']/g)]
        .some(match => requestedClasses.every(name => match[1].split(/\s+/).includes(name)));
      if (matchingClass) {
        if (!descendants.has(selector)) {
          descendants.set(selector, createElementStub(`${description} ${selector}`));
        }
        return descendants.get(selector);
      }
      for (const child of children) {
        const hit = child && typeof child.querySelector === 'function' ? child.querySelector(selector) : null;
        if (hit) return hit;
      }
      return null;
    },
    querySelectorAll: () => [],
    // 真实 DOM 一定有 contains；热力图重建前要问“焦点在不在里面”。桩里没有子孙树，只有自己包含自己。
    contains: other => other === element,
    getContext: () => createCanvasContextStub(),
    // 事件处理器可以被测试主动触发，用来验证接线本身不抛。
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      return handler ? handler({ preventDefault() {}, stopPropagation() {}, target: element, ...event }) : undefined;
    },
    hasListener: type => listeners.has(type)
  };
  // 写 innerHTML 就是把整片子树换掉。不跟着清空已接上来的子节点，第二次
  // 渲染后一次查询会拿到上一轮的行，而那一行已经不在页上了。
  Object.defineProperty(element, 'innerHTML', {
    enumerable: true,
    configurable: true,
    get: () => innerHTML,
    set(value) {
      innerHTML = String(value);
      children.length = 0;
      descendants.clear();
    }
  });
  return element;
}

// querySelectorAll 永远返回集合而不是 null，所以它不是这个测试要守的东西——
// 打空一个 id 才是。这里只求“数量大致对且从不抛”：多给一个桩不会掩盖接线错误，
// 给零个会让整段循环体不被执行，所以数不出来时至少给一个。
function approximateMatchCount(selector) {
  const tokens = selector.split(',')[0].match(/\.[\w-]+|\[[^\]]+\]/g);
  if (!tokens) return 1;
  const last = tokens[tokens.length - 1];
  const needle = last.startsWith('.') ? last.slice(1) : last.slice(1, -1);
  const count = html.split(needle).length - 1;
  return count > 0 ? count : 1;
}

function createDocumentStub() {
  const byId = new Map();
  const lookupById = id => {
    if (!HTML_IDS.has(id)) return null;
    if (!byId.has(id)) byId.set(id, createElementStub(`#${id}`));
    return byId.get(id);
  };
  const lookupBySelector = selector => {
    const id = selector.match(/^#([\w-]+)$/);
    if (id) return lookupById(id[1]);
    // 只回答 HTML 里真的写了的 class 选择器；其余一律 null，让打空立刻暴露。
    const className = selector.match(/^\.([\w-]+)$/);
    if (className) return HTML_CLASSES.has(className[1]) ? createElementStub(selector) : null;
    return createElementStub(selector);
  };
  const document = {
    documentElement: createElementStub('html'),
    body: createElementStub('body'),
    head: createElementStub('head'),
    activeElement: null,
    getElementById: lookupById,
    querySelector: lookupBySelector,
    querySelectorAll: selector => Array.from(
      { length: approximateMatchCount(selector) },
      () => createElementStub(selector)
    ),
    createElement: tag => createElementStub(`<${tag}>`),
    createTextNode: text => ({ text }),
    createDocumentFragment: () => createElementStub('#fragment'),
    addEventListener() {},
    removeEventListener() {}
  };
  return document;
}

// state 的形状取自真实的 DEFAULT_SETTINGS 与 createIdleSession()，不是手编一份：
// 手编的形状只会证明渲染层能跑通一个主进程从不会发出的 state。
function createStateStub() {
  const settings = { ...DEFAULT_SETTINGS };
  return {
    revision: 1,
    tasks: [], archivedTasks: [], impulses: [],
    history: { total: 0, nextCursor: null, retention: 30 },
    nowTaskId: null, nowTask: null,
    xp: 0, level: 1, streak: { current: 0, best: 0 },
    settings, stats: {},
    skins: [], currentSkin: null,
    companionProjection: null,
    theme: 'day',
    energy: { level: 'medium', score: 50, label: '一般', estimated: true },
    energyCheckIn: null,
    recommendations: { primary: null, alternatives: [], energy: { level: 'medium', score: 50 } },
    work: { start: 9, end: 18, isWorkTime: true },
    recurrenceSeries: [],
    focusMinutes: { min: 5, max: 120, presets: [15, 25, 45], chosen: settings.pomodoroMinutes },
    reviews: [],
    strategy: { enabled: true, phases: ['pre-start', 'distraction', 'working-memory', 'time-visibility', 'recovery'] },
    ai: {
      enabled: false, provider: 'api', model: '', baseUrl: '', credential: { configured: false },
      disclosure: {
        fields: ['title', 'description'],
        endpoint: 'https://api.openai.com/v1/responses',
        network: false,
        activeProvider: 'deterministic',
        blockedReason: null
      }
    },
    migrationNotices: [],
    autoExpiryPreview: null,
    focusSession: createIdleSession(0),
    pomodoro: {
      running: false, paused: false, status: 'idle', mode: 'focus', kind: 'idle',
      sessionId: null, startedAt: null, endsAt: null, taskId: null,
      awaitingOfflineConfirmation: false, recoveryReason: null,
      plannedDurationMs: 0, elapsedMs: 0, remainingMs: 0
    },
    quickStartDecision: null,
    quickStartResolutionPending: false,
    focusLandingPrompt: null,
    serverNow: 0
  };
}

async function loadPopoverRenderer({ responses: extraResponses = {} } = {}) {
  const document = createDocumentStub();
  const noop = () => {};
  // 一律返回裸 { ok: true } 是个谎：主进程的 ok:true 总带着 payload（比如
  // strategy:request 在选不出条目时返回的是 ok:false）。给不出 payload 的桩
  // 会造出渲染层并不存在的失败，所以这里拿真实内容包里的条目充。
  const responses = {
    getState: () => createStateStub(),
    requestStrategy: () => ({ ok: true, strategy: STRATEGIES[0] }),
    ...extraResponses
  };
  // 渲染层向主进程发出的东西也是它的行为之一：只看“没抛异常”时，一份会被
  // IPC 校验整条拒掉的 payload 看起来跟保存成功一模一样。
  const calls = [];
  const intervals = new Map();
  let nextInterval = 0;
  let stateSubscriptions = 0;
  const focuspix = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'then') return undefined;
      const respond = responses[key];
      return (...args) => {
        calls.push({ method: key, args });
        if (key === 'onStateDiff') {
          stateSubscriptions += 1;
          return () => { stateSubscriptions -= 1; };
        }
        return Promise.resolve(respond ? respond(...args) : { ok: true });
      };
    }
  });
  const sandbox = {
    AbortController, Image: RasterBrowserImage,
    document,
    console,
    focuspix,
    setTimeout, clearTimeout,
    setInterval: callback => { intervals.set(++nextInterval, callback); return nextInterval; },
    clearInterval: id => intervals.delete(id),
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    performance: { now: () => 0 },
    Date, Math, JSON, Number, String, Boolean, Object, Array, Map, Set, Promise, RegExp, Error, URL, isNaN,
    parseInt, parseFloat, Intl
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.focuspix = focuspix;
  sandbox.addEventListener = noop;
  sandbox.removeEventListener = noop;
  sandbox.devicePixelRatio = 1;
  sandbox.innerWidth = 380;
  sandbox.innerHeight = 640;
  sandbox.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });

  const bootErrors = [];
  const collect = error => bootErrors.push(error);
  process.on('unhandledRejection', collect);
  try {
    const context = vm.createContext(sandbox);
    sandbox.surface = createRendererModuleLoader(context)(path.join(RENDERER_DIR, 'popover.mjs'), ['breakdownFeature', 'taskList', 'popoverSurface', 'createPopoverSurface']);
    sandbox.surface.popoverSurface.ready.catch(collect);
    for (let tick = 0; tick < 5; tick += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
  } finally {
    process.off('unhandledRejection', collect);
  }
  return { document, sandbox, bootErrors, calls, intervals, subscriptions: () => stateSubscriptions };
}

test('whole popover teardown is idempotent and a fresh instance does not accumulate timers or listeners', async () => {
  const harness = await loadPopoverRenderer();
  assertBooted(harness.bootErrors);
  const first = harness.sandbox.surface.popoverSurface;
  const initialTimers = harness.intervals.size;
  assert.ok(initialTimers > 0);
  assert.equal(harness.subscriptions(), 1);
  first.dispose();
  first.dispose();
  assert.equal(harness.subscriptions(), 0);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.document.getElementById('btnCompleteNowTask').hasListener('click'), false);
  const second = harness.sandbox.surface.createPopoverSurface({ document: harness.document, window: harness.sandbox });
  await second.ready;
  assert.equal(harness.subscriptions(), 1);
  assert.equal(harness.intervals.size, initialTimers);
  second.dispose();
  assert.equal(harness.intervals.size, 0);
});

test('disposing before the initial projection resolves cannot resurrect the expiry ticker', async () => {
  let resolve;
  const pending = new Promise(complete => { resolve = complete; });
  const harness = await loadPopoverRenderer({ responses: { getState: () => pending } });
  harness.sandbox.surface.popoverSurface.dispose();
  resolve(createStateStub());
  await harness.sandbox.surface.popoverSurface.ready;
  assert.equal(harness.subscriptions(), 0);
  assert.equal(harness.intervals.size, 0);
});

test('a failed initial projection disposes the mounted surface instead of leaking subscriptions', async () => {
  const harness = await loadPopoverRenderer({ responses: { getState: () => Promise.reject(new Error('snapshot unavailable')) } });
  assert.equal(harness.bootErrors.length, 1);
  assert.equal(harness.subscriptions(), 0);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.document.getElementById('btnCompleteNowTask').hasListener('click'), false);
});

test('a history response from a disposed surface cannot repaint the next surface', async () => {
  let resolveHistory;
  const history = new Promise(resolve => { resolveHistory = resolve; });
  const initial = createStateStub();
  initial.history = { total: 2, nextCursor: 'next', retention: {} };
  const harness = await loadPopoverRenderer({ responses: { getState: () => initial, listHistory: () => history } });
  harness.document.getElementById('historyLoadMore').dispatch('click');
  assert.equal(harness.calls.filter(call => call.method === 'listHistory').length, 1);
  harness.sandbox.surface.popoverSurface.dispose();
  const next = harness.sandbox.surface.createPopoverSurface({ document: harness.document, window: harness.sandbox });
  await next.ready;
  const archive = harness.document.getElementById('archiveList');
  const currentMarkup = archive.innerHTML;
  resolveHistory({ items: [{ id: 'late', title: 'late history' }], total: 3 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(archive.innerHTML, currentMarkup);
  next.dispose();
});

// 渲染层把异常吐到 unhandledRejection 而不是当场抛，所以每个测试都得把
// “没有攒下错误”当成断言的一部分。
function assertBooted(bootErrors) {
  assert.deepEqual(bootErrors.map(error => String(error && error.message || error)), []);
}

test('popover.js wires itself up and paints a first screen against the real popover.html', async () => {
  // 打空一个 id 在 evaluate 时就抛；首屏渲染碎掉则落在 bootErrors 里。
  const { bootErrors } = await loadPopoverRenderer();
  assertBooted(bootErrors);
});

test('every control the today page owns is reachable and carries a click handler', async () => {
  const { document, bootErrors } = await loadPopoverRenderer();
  assertBooted(bootErrors);
  // 本次改造引入或搬动的控件：入口、三条出路、子项区、以及仍需存在的启动路径。
  for (const id of [
    'btnStuck', 'stuckClose', 'btnRouteShrink', 'btnRouteTip',
    'btnShrinkAnother', 'shrinkCancel', 'shrinkConfirm',
    'btnStrategyRequest', 'btnNowKickstart', 'btnEditNowTask', 'btnCompleteNowTask',
    'btnChooseCandidates', 'btnStartFocus', 'closeCandidates'
  ]) {
    const node = document.getElementById(id);
    assert.ok(node, `#${id} 不在 popover.html 里，接线会打空`);
    assert.ok(node.hasListener('click'), `#${id} 没有绑定 click`);
  }
});

test('Now completion uses the shared main-process confirmation contract and ignores terminal tasks', async () => {
  for (const done of [false, true]) {
    const state = createStateStub();
    state.tasks = [{ id: 'now-task', title: 'Current task', done, steps: [], nextAction: 'Start' }];
    state.nowTaskId = 'now-task';
    const { document, calls, bootErrors } = await loadPopoverRenderer({
      responses: { getState: () => state, completeTask: () => ({ ok: true }) }
    });
    assertBooted(bootErrors);
    await document.getElementById('btnCompleteNowTask').dispatch('click');
    const completions = calls.filter(call => call.method === 'completeTask');
    assert.equal(completions.length, done ? 0 : 1);
    if (!done) assert.equal(completions[0].args[0], 'now-task');
  }
});

test('active focus names its own task or free focus instead of borrowing the next selected task', async () => {
  for (const taskId of ['active-task', null]) {
    const state = createStateStub();
    state.tasks = [
      { id: 'next-task', title: 'Next task', steps: [] },
      { id: 'active-task', title: 'Actually focusing', steps: [] }
    ];
    state.nowTaskId = 'next-task';
    state.focusSession = { ...state.focusSession, status: 'focus', kind: 'focus', taskId,
      sessionId: 'focus-one', plannedDurationMs: 1500000 };
    state.pomodoro = { ...state.pomodoro, taskId, plannedDurationMs: 1500000, remainingMs: 1490000 };
    const harness = await loadPopoverRenderer({ responses: { getState: () => state } });
    assertBooted(harness.bootErrors);
    assert.equal(harness.document.getElementById('nowCardTitle').textContent,
      taskId ? 'Actually focusing' : '自由专注');
    harness.sandbox.surface.popoverSurface.dispose();
  }
});

test('opening and closing the stuck modal walks every screen without throwing', async () => {
  const { document, bootErrors } = await loadPopoverRenderer();
  assertBooted(bootErrors);
  // 没有当前任务时也不能炸：弹窗可以在任何时刻被按开。
  for (const id of [
    'btnStuck', 'btnRouteShrink', 'btnShrinkAnother', 'shrinkCancel',
    'btnStrategyRequest', 'stuckClose'
  ]) {
    assert.doesNotThrow(
      () => document.getElementById(id).dispatch('click'),
      `#${id} 的 click 处理器抛了`
    );
  }
  await new Promise(resolve => setImmediate(resolve));
});

// 保存一件带步骤的任务时，渲染层发出的 payload 必须能过 IPC 校验。两边各写一份
// 步骤形状时，渲染层自己无法发现分叉：它只会拿到一个 rejection，然后把一条
// “任务没有保存”摆给用户。所以这里拿真正的 validateIpcPayload 当断言。
async function captureCreatePayload({ enrich, suggestion = null }) {
  const { document, calls, bootErrors } = await loadPopoverRenderer({
    responses: {
      // “让伙伴补全”回来的建议只落进草稿，于是保存走的是
      // tasks:add-with-breakdown；手写步骤走 tasks:add。两条都得测到。
      // 只有真的用到模型（provider 'api' 且没回退）的建议才会被填进草稿。
      previewEnrich: () => suggestion || ({
        ok: true,
        provider: 'api',
        fallback: false,
        steps: [{ title: '补全韩国 KYC 缺失字段' }, { title: '在本地校对必填与提交参数' }],
        completionCriteria: '韩国 KYC 所需字段已在对应页面补全',
        proposalId: null
      })
    }
  });
  assertBooted(bootErrors);
  document.getElementById('taskInput').value = '代码韩国kyc字段修正，同步到预发环境和文档';
  if (enrich) {
    document.getElementById('btnEnrichDraft').dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
  } else {
    document.getElementById('createAddStep').dispatch('click');
    const input = document.getElementById('createSteps').querySelector('.bd-step-input');
    assert.ok(input, '新增的步骤行里必须有一个可输入的标题框');
    input.value = '在页面代码中补全韩国 KYC 缺失字段';
    input.dispatch('input', { target: input });
  }
  document.getElementById('taskCreateConfirm').dispatch('click');
  for (let tick = 0; tick < 5; tick += 1) await new Promise(resolve => setImmediate(resolve));
  assertBooted(bootErrors);
  const method = enrich ? 'addWithBreakdown' : 'addTask';
  const call = calls.find(entry => entry.method === method);
  assert.ok(call, `保存应该走 ${method}，实际只发出了 ${calls.map(entry => entry.method).join(', ')}`);
  // payload 过 IPC 时本就被结构化克隆一次，主进程收到的总是自己 realm 里的
  // 普通对象。vm 里造的对象原型不同，不克隆回来会在 isPlainObject 上先挂，
  // 那就测不到字段层面的分叉了。
  return structuredClone(call.args[0]);
}

test('a hand-written step list produces a tasks:add payload the IPC schema accepts', async () => {
  const payload = await captureCreatePayload({ enrich: false });
  assert.equal(payload.steps.length, 1);
  const result = validateIpcPayload('tasks:add', payload);
  assert.deepEqual(result.errors || [], [], 'tasks:add 拒掉了渲染层自己发出的 payload');
  assert.equal(result.ok, true);
});

test('an enriched step list produces a tasks:add-with-breakdown payload the IPC schema accepts', async () => {
  const payload = await captureCreatePayload({ enrich: true });
  assert.equal(payload.steps.length, 2);
  // done 由主进程写；渲染层多带一份就是 unknown field: done，整条保存被拒。
  for (const step of payload.steps) assert.deepEqual(Object.keys(step), ['title']);
  const result = validateIpcPayload('tasks:add-with-breakdown', payload);
  assert.deepEqual(result.errors || [], [], 'tasks:add-with-breakdown 拒掉了渲染层自己发出的 payload');
  assert.equal(result.ok, true);
});

test('without a model the completion button fills nothing and says why', async () => {
  const local = {
    ok: true, provider: 'deterministic', fallback: true, reason: 'provider-credential-missing',
    steps: [{ title: '对谁都一样的第一步' }, { title: '对谁都一样的第二步' }],
    completionCriteria: '对谁都一样的完成标准', estimateMinutes: 25, energy: 'medium', proposalId: null
  };
  const { document, calls, bootErrors } = await loadPopoverRenderer({ responses: { previewEnrich: () => local } });
  assertBooted(bootErrors);
  document.getElementById('taskInput').value = '整理季度报销';
  document.getElementById('btnEnrichDraft').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('createSteps').querySelectorAll('.bd-step-input').length, 0, 'no generic steps in the draft');
  assert.equal(document.getElementById('estimateInput').value || '', '');
  assert.match(document.getElementById('taskFormStatus').textContent, /没有用 AI，所以没替你拆.*第一个看得见的动作/);
  document.getElementById('taskCreateConfirm').dispatch('click');
  for (let tick = 0; tick < 5; tick += 1) await new Promise(resolve => setImmediate(resolve));
  const saved = calls.find(entry => entry.method === 'addTask' || entry.method === 'addWithBreakdown');
  assert.ok(saved && saved.method === 'addTask', 'the task saves as a plain task, with no template steps');
  assert.equal(structuredClone(saved.args[0]).steps, undefined);
});

test('breakdown save is single-flight and an old response cannot close a newer task editor', async () => {
  let releaseFirstSave;
  const firstSave = new Promise(resolve => { releaseFirstSave = resolve; });
  let saveCount = 0;
  const { document, sandbox, calls, bootErrors } = await loadPopoverRenderer({
    responses: {
      previewBreakdown: title => [{ title: `先处理：${title}` }],
      updateTask: () => {
        saveCount += 1;
        return saveCount === 1 ? firstSave : { ok: true };
      }
    }
  });
  assertBooted(bootErrors);
  // The lightweight classList stub intentionally does not model CSS state.
  // This flow needs the durable landing dialog to be closed so the breakdown
  // editor can own the modal layer.
  document.getElementById('quickStartMask').classList.contains = className => className === 'hidden';

  // 面板的顶层 const 不会挂到全局对象上,所以要从 vm 里把这一层取出来——
  // 换句话说,这个 feature 是通过它自己的 API 被驱动的,不是靠外面翻它的变量。
  const breakdown = sandbox.surface.breakdownFeature;

  const firstTask = { id: 'task-first', title: '第一件任务', steps: [] };
  const secondTask = { id: 'task-second', title: '第二件任务', steps: [] };
  await breakdown.open(firstTask, document.getElementById('btnCreateTask'));

  const confirm = document.getElementById('bdConfirm');
  const pending = confirm.dispatch('click');
  confirm.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.method === 'updateTask').length, 1,
    '同步提交锁必须在第一个 await 之前生效');

  await breakdown.open(secondTask, document.getElementById('btnCreateTask'));
  releaseFirstSave({ ok: true });
  await pending;
  assert.equal(breakdown.context().taskId, secondTask.id,
    '第一件任务的迟到响应不得关闭或清空第二件任务的编辑上下文');
});

test('task overflow placement stays inside the viewport and opens upward near the bottom', async () => {
  const { sandbox, bootErrors } = await loadPopoverRenderer();
  assertBooted(bootErrors);
  const taskItem = createElementStub('.task-item');
  const trigger = createElementStub('.icon-btn.more');
  const menu = createElementStub('.task-menu');
  menu.closest = selector => selector === '.task-item' ? taskItem : null;
  menu.getBoundingClientRect = () => ({ width: 164, height: 180 });
  trigger.getBoundingClientRect = () => ({ top: 600, bottom: 630, right: 370 });

  // 定位归任务清单那一层，所以从它的实例上驱动，而不是找面板顶上的全局函数。
  sandbox.surface.taskList.setOverflowMenuOpen(trigger, menu, true);

  assert.equal(menu.style.left, '206px');
  assert.equal(menu.style.top, '416px');
  assert.equal(menu.style.maxHeight, '624px');
});

test('paused task adds exactly one step, blocks duplicate submissions and preserves a rejected draft', async () => {
  const state = createStateStub();
  state.tasks = [{ id: 'doing', title: 'Keep the whole task', done: false, steps: [], nextAction: 'Start' }];
  state.nowTaskId = 'doing';
  state.focusSession = { ...state.focusSession, status: 'paused', pausedFrom: 'focus', kind: 'focus', taskId: 'doing', sessionId: 's1', plannedDurationMs: 1500000 };
  state.pomodoro = { ...state.pomodoro, taskId: 'doing', paused: true, plannedDurationMs: 1500000, remainingMs: 1490000 };
  let finish;
  const h = await loadPopoverRenderer({ responses: { getState: () => state, updateTask: () => new Promise(resolve => { finish = resolve; }) } });
  const input = h.document.getElementById('sessionStepInput');
  input.value = '核对新增的附件';
  const form = h.document.getElementById('sessionStepForm');
  form.dispatch('submit', { preventDefault() {} });
  form.dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const edits = h.calls.filter(call => call.method === 'updateTask');
  assert.equal(edits.length, 1);
  assert.deepEqual(structuredClone(edits[0].args), ['doing', { steps: [{ op: 'add', title: '核对新增的附件' }] }, 'current']);
  finish({ ok: false, reason: 'conflict' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(input.value, '核对新增的附件');
  assert.equal(h.document.getElementById('saveSessionStep').disabled, false);
  assertBooted(h.bootErrors);
  h.sandbox.surface.popoverSurface.dispose();
});
