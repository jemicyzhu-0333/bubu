'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EN } = require('../src/surfaces/shared/interface/catalog.mjs');
const { t, setLocale, getLocale, localizeDocument } = require('../src/surfaces/shared/interface/i18n.mjs');
const { createPopoverFocusTimer } = require('../src/surfaces/popover/features/focus-timer.mjs');
const { createPopoverNowCard } = require('../src/surfaces/popover/features/now-card.mjs');
const sessionDuration = require('../src/capabilities/execution/contract/session-duration.mjs');
const { dom } = require('../test-support/manual-growth-dom');

function localeTest(name, run) {
  test(name, async context => {
    const before = getLocale();
    context.after(() => setLocale(before));
    await run(context);
  });
}

localeTest('English catalog preserves every placeholder and exact user parameter', () => {
  assert.ok(Object.isFrozen(EN));
  const fields = value => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(hit => hit[1]).sort();
  for (const [source, english] of Object.entries(EN)) {
    assert.equal(typeof english, 'string');
    assert.ok(english.trim(), source);
    assert.deepEqual(fields(english), fields(source), source);
  }
  setLocale('en');
  const title = '开始专注 <draft> {minutes}';
  assert.equal(t('换成{title}', { title }), `Switch to ${title}`);
  assert.equal(t('a user phrase outside the catalog'), 'a user phrase outside the catalog');
  setLocale('zh-CN');
  assert.equal(t('换成{title}', { title }), `换成${title}`);
});

localeTest('explicit document markers preserve icons, counters, and unmarked user content', () => {
  const leaf = { dataset: { i18n: '设置' }, textContent: '设置' };
  const icon = { nodeType: 1, textContent: '' };
  const count = { nodeType: 1, textContent: '23' };
  const label = { nodeType: 3, textContent: '任务 ' };
  const mixed = { childNodes: [icon, label, count], getAttribute: () => '任务' };
  const input = { value: '设置', attributes: { placeholder: '记下一句话…' },
    getAttribute(name) { return name === 'data-i18n-placeholder' ? '记下一句话…' : this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; } };
  const user = { textContent: '设置', value: '开始专注' };
  const document = { documentElement: {}, querySelectorAll: selector => ({
    '[data-i18n]': [leaf], '[data-i18n-text]': [mixed], '[data-i18n-placeholder]': [input]
  })[selector] || [] };
  setLocale('en'); localizeDocument(document);
  assert.equal(leaf.textContent, 'Settings');
  assert.equal(label.textContent, 'Tasks ');
  assert.equal(mixed.childNodes[0], icon); assert.equal(mixed.childNodes[2], count);
  assert.equal(count.textContent, '23');
  assert.equal(input.attributes.placeholder, 'Write a quick note…');
  assert.equal(input.value, '设置'); assert.equal(user.textContent, '设置');
  setLocale('zh-CN'); localizeDocument(document);
  assert.equal(leaf.textContent, '设置'); assert.equal(label.textContent, '任务 ');
  assert.equal(input.value, '设置'); assert.equal(user.value, '开始专注');
});

localeTest('focus caches repaint language without changing session or task data', () => {
  const h = dom();
  const state = { settings: { pomodoroMinutes: 25, breakMinutes: 5 },
    focusMinutes: { min: 5, max: 120, chosen: 25, presets: [25, 45] } };
  const session = { running: false, paused: false, status: 'idle' };
  const task = { id: 'one', title: '设置 {minutes}', nextAction: '开始专注' };
  const feature = createPopoverFocusTimer({ document: h.document, $: h.$, $$: () => [],
    getState: () => state, getSession: () => session, pad2: value => String(value).padStart(2, '0'),
    setStatusLine() {}, sessionDuration, surfaceClient: {}, focusActionMessage: () => '', currentTask: () => task });
  setLocale('zh-CN'); feature.renderPomoStructure(); feature.renderDurationPicker();
  assert.equal(h.$('#durationValue').textContent, '25 分钟');
  setLocale('en'); feature.renderPomoStructure({ copyOnly: true }); feature.renderDurationPicker({ copyOnly: true });
  assert.equal(h.$('#durationValue').textContent, '25 min');
  assert.equal(h.$('#btnStartFocusText').textContent, 'Start focus');
  assert.equal(h.$('#btnStartFocus').attributes['aria-label'], 'Focus on “设置 {minutes}” for 25 minutes');
  assert.deepEqual(session, { running: false, paused: false, status: 'idle' });
  assert.equal(task.nextAction, '开始专注');
  setLocale('zh-CN'); feature.renderPomoStructure({ copyOnly: true }); feature.renderDurationPicker({ copyOnly: true });
  assert.equal(h.$('#btnStartFocusText').textContent, '开始专注');
  assert.equal(h.$('#durationValue').textContent, '25 分钟');
});

localeTest('Now translates generated prompts but preserves user actions even when they match catalog keys', () => {
  const h = dom();
  const task = { id: 'one', title: '设置', nextAction: '开始专注', steps: [] };
  const state = { nowTaskId: task.id, tasks: [task] };
  const feature = createPopoverNowCard({ document: h.document, $: h.$,
    getState: () => state, getSession: () => ({ running: false, paused: false }), escapeHTML: value => value,
    surfaceClient: {}, taskLaunchBlockReason: () => null, focusActionMessage: () => '', taskActionMessage: () => '',
    scoreSummary: () => '', syncBlocker: () => '', canReceiveFocus: () => true, celebrate() {},
    completeTask() {}, openTaskEditor() {}, runQuickStart() {}, showFocusStatus() {} });
  setLocale('en'); feature.render();
  assert.equal(h.$('#nowStateLabel').textContent, 'The next small step');
  assert.equal(h.$('#nowCardTitle').textContent, '设置');
  assert.equal(h.$('#nowNextAction').textContent, '开始专注');
  task.nextAction = ''; feature.render();
  assert.equal(h.$('#nowNextAction').textContent, 'Open what you need and take one small step');
  task.steps = [{ title: '打开材料，只做第一小步', done: false }]; feature.render();
  assert.equal(h.$('#nowNextAction').textContent, '打开材料，只做第一小步');
  task.done = true; feature.render();
  assert.equal(h.$('#nowNextAction').textContent, 'This task is complete');
});

localeTest('quick-start locale changes retain draft input and an in-flight command identity', async context => {
  const { harness, deferred, settle } = require('../test-support/quick-push-fixture');
  const pending = deferred();
  const submitted = [];
  setLocale('zh-CN');
  const h = await harness(context, { client: { kickstart: (...args) => { submitted.push(args); return pending.promise; } } });
  h.open();
  const input = h.$('#quickStartInput'); input.value = '开始专注 {title}';
  h.document.activeElement = input;
  h.submit();
  assert.equal(h.$('#quickStartConfirm').disabled, true);
  setLocale('en');
  assert.equal(h.$('#quickStartConfirm').textContent, 'Start 2 minutes');
  assert.equal(h.$('#quickStartConfirm').disabled, true);
  assert.equal(h.document.activeElement, input);
  assert.equal(input.value, '开始专注 {title}');
  assert.equal(h.reads(), 1);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0][1].nextAction, '开始专注 {title}');
  pending.resolve({ ok: true }); await settle();
  assert.equal(h.$('#panelStatus').textContent, 'Your two minutes have started.');
  assert.deepEqual(h.calls, [['hide']]);
  h.feature.dispose();
});

localeTest('active quick locale changes preserve timer anchor and focused step draft', async context => {
  const { harness, active, emit } = require('../test-support/quick-push-fixture');
  setLocale('zh-CN');
  const h = await harness(context, { initial: active() });
  const root = h.$('#quickSteps');
  emit(root.children[0].children[1], 'click');
  const input = root.querySelector('input');
  input.value = '设置 {step}'; emit(input, 'input');
  input.selectionStart = 2; input.selectionEnd = 4;
  h.document.activeElement = input;
  h.window.performance.now = () => 7000;
  setLocale('en');
  assert.equal(root.querySelector('input'), input, 'copy-only update keeps the same input node');
  assert.equal(input.value, '设置 {step}');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 4]);
  assert.equal(h.document.activeElement, input);
  assert.equal(input.attributes['aria-label'], 'Edit unfinished step');
  assert.equal(root.children[0].children[0].children[1].textContent, 'Save');
  assert.equal(h.$('#quickSessionTime').textContent, '01:33');
  assert.match(h.$('#quickSessionTime').attributes['aria-label'], /01:33 remaining/);
  assert.equal(h.reads(), 1); assert.deepEqual(h.calls, []);
  h.feature.dispose();
});

test('static copy markers have catalog entries and exclude business-content targets', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const decode = source => source.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  for (const surface of ['popover', 'impulse', 'pet']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer', `${surface}.html`), 'utf8');
    for (const marker of html.matchAll(/\bdata-i18n(?:-text|-title|-aria-label|-placeholder)?="([^"]*)"/g)) {
      assert.ok(Object.hasOwn(EN, decode(marker[1])), `${surface}: ${marker[1]}`);
    }
    for (const id of ['nowCardTitle', 'nowNextAction', 'companionName', 'draftChatSessionTitle',
      'draftChatContextPreview', 'quickTaskTitle', 'quickStartTitle', 'statusPill', 'aiSaveConfig', 'draftChatChangeTitle',
      'btnDraftChatChangeConfirm', 'btnDraftChatChangeRetry', 'planningConfirm', 'btnDraftChatAdopt']) {
      const openingTag = html.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`))?.[0];
      if (openingTag) assert.doesNotMatch(openingTag, /\bdata-i18n(?:-text)?=/, id);
    }
  }
});

const ROOT = require('node:path').join(__dirname, '..');
const { createAiConfiguration } = require(`${ROOT}/src/surfaces/popover/features/ai-configuration.mjs`);
const { createDesktopUpdateFeature } = require(`${ROOT}/src/surfaces/popover/features/desktop-updates.mjs`);
const { createActivityMirrorSettings } = require(`${ROOT}/src/surfaces/popover/features/activity-mirror-settings.mjs`);
const { createPopoverTaskList } = require(`${ROOT}/src/surfaces/popover/features/task-list.mjs`);
const { createAuthorizationSettingsDom } = require(`${ROOT}/test/fixtures/authorization-settings-dom`);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function localized(name, run) {
  test(name, async context => { const before = getLocale(); context.after(() => setLocale(before)); setLocale('zh-CN'); await run(context); });
}
localized('AI locale repaint keeps dirty fields, focused draft, pending save and exact provider model', async context => {
  const h = createAuthorizationSettingsDom(), pending = deferred(), calls = [];
  let reads = 0;
  const state = { settings: { aiModel: '设置 {model}', aiBaseUrl: 'https://example.com' }, ai: {
    enabled: true, model: '设置 {model}', credential: { configured: true }, disclosure: { activeProvider: 'api' } } };
  const feature = createAiConfiguration({ $: h.$, getState: () => { reads++; return state; }, surfaceClient: {
    updateSettings: patch => { calls.push(patch); return pending.promise; }
  } });
  feature.mount(); feature.render(); context.after(() => feature.dispose());
  h.input('#aiModelInput', '开始专注 {title}'); h.input('#aiBaseUrlInput', 'https://example.org');
  h.document.activeElement = h.$('#aiModelInput');
  const saving = feature.save(), baselineReads = reads;
  setLocale('en');
  assert.equal(h.$('#aiConfigStatus').textContent, 'Saving…');
  assert.equal(h.$('#aiActiveMode').textContent, 'Ready · 设置 {model}');
  assert.equal(h.$('#aiModelInput').value, '开始专注 {title}');
  assert.equal(h.document.activeElement, h.$('#aiModelInput'));
  assert.equal(h.$('#aiSaveConfig').disabled, true);
  assert.equal(reads, baselineReads); assert.equal(calls.length, 1);
  pending.resolve({ ok: true }); await saving;
  assert.equal(h.$('#aiConfigStatus').textContent, 'Saved · Takes effect on the next AI request');
  setLocale('zh-CN'); assert.equal(h.$('#aiConfigStatus').textContent, '已保存 · 下次 AI 请求生效');
  feature.dispose(); setLocale('en'); assert.equal(h.$('#aiConfigStatus').textContent, '已保存 · 下次 AI 请求生效');
});
localized('updater locale repaint preserves restart confirmation and makes no status read or command', async context => {
  const h = dom(); let reads = 0, installs = 0;
  const state = { phase: 'downloaded', currentVersion: '1.0.0', version: '版本 {version}' };
  const feature = createDesktopUpdateFeature({ $: h.$, getState: () => ({ settings: {} }), surfaceClient: {
    getUpdateStatus: async () => { reads++; return state; }, installUpdate: async () => { installs++; return { ok: true }; }
  }, setTimer: () => 1, clearTimer() {} });
  feature.mount(); await settle(); context.after(() => feature.dispose());
  await h.$('#appUpdateInstall').emit('click');
  h.document.activeElement = h.$('#appUpdateConfirmYes');
  const baseline = reads;
  setLocale('en');
  assert.equal(h.$('#appUpdateVersion').textContent, 'Current version 1.0.0');
  assert.equal(h.$('#appUpdateStatus').textContent, 'Version 版本 {version} is ready');
  assert.equal(h.$('#appUpdateConfirm').hidden, false);
  assert.equal(h.document.activeElement, h.$('#appUpdateConfirmYes'));
  assert.equal(reads, baseline); assert.equal(installs, 0);
  feature.dispose(); setLocale('zh-CN'); assert.equal(h.$('#appUpdateVersion').textContent, 'Current version 1.0.0');
});

// Synthetic DOM for emitted task/hook controls. It parses explicit emitted nodes
// to detect replacement and listener changes; it is not browser/layout evidence.
function controlDom() {
  const document = { activeElement: null }, nodes = new Map();
  const matches = (node, selector) => selector.startsWith('.')
    ? selector.slice(1).split('.').every(name => node.classList.contains(name))
    : selector.startsWith('[') ? Object.hasOwn(node.attributes, selector.slice(1, -1).split('=')[0]) : node.tagName === selector.toUpperCase();
  function element(tagName = 'DIV') {
    let markup = '', names = new Set(); const listeners = new Map();
    const node = { tagName, children: [], parentNode: null, dataset: {}, attributes: {}, style: {}, textContent: '', value: '', isConnected: true,
      get className() { return [...names].join(' '); }, set className(value) { names = new Set(value.split(/\s+/)); },
      classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name),
        toggle(name, force) { const on = force ?? !names.has(name); if (on) names.add(name); else names.delete(name); } },
      get innerHTML() { return markup; }, set innerHTML(value) {
        markup = value; node.children = [];
        for (const hit of value.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<]*)/gi)) {
          const child = element(hit[1].toUpperCase()); child.textContent = hit[3];
          for (const attr of hit[2].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attr[1], attr[2]);
          child.parentNode = node; node.children.push(child);
        }
      },
      setAttribute(name, value) { node.attributes[name] = String(value); if (name === 'class') node.className = value;
        if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value; },
      getAttribute: name => node.attributes[name],
      querySelectorAll(selector) { return node.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
      closest(selector) { return matches(node, selector) ? node : node.parentNode?.closest(selector) || null; },
      appendChild(child) { child.remove(); child.parentNode = node; node.children.push(child); return child; },
      insertBefore(child, reference) { child.remove(); child.parentNode = node; node.children.splice(node.children.indexOf(reference), 0, child); },
      remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node); node.parentNode = null; },
      get firstChild() { return node.children[0] || null; }, get nextSibling() { return node.parentNode?.children[node.parentNode.children.indexOf(node) + 1] || null; },
      addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
      removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
      async emit(type, event = {}) { for (const handler of listeners.get(type) || []) await handler({ target: node, stopPropagation() {}, ...event }); },
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }; },
      focus() { document.activeElement = node; }
    }; return node;
  }
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  Object.assign(document, { createElement: tag => element(tag.toUpperCase()), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} });
  const window = { innerWidth: 440, innerHeight: 600, addEventListener() {}, removeEventListener() {}, confirm: () => true };
  return { $, document, window, element };
}
localized('activity locale repaint preserves tool identities, authored setup text and copy controls', async context => {
  const h = controlDom(); let reads = 0, copies = 0, subscriptions = 0;
  const state = { settings: {}, activityMirror: { enabled: true, activity: 'ai', tools: [{ id: 'tool', label: '设置',
    lastSignalAt: null, steps: ['原始说明 {title}'], command: 'command 原文' }] } };
  const feature = createActivityMirrorSettings({ $: h.$, getState: () => { reads++; return state; }, escapeHTML: value => value,
    surfaceClient: { copyAgentPluginCommand: async () => { copies++; return { ok: true }; } } });
  feature.mount({ subscribe: () => { subscriptions++; return () => { subscriptions--; }; } }); context.after(() => feature.dispose());
  const copy = h.$('#activityHookCopy'), baseline = reads;
  const selector = h.$('#activityHookTool'), help = h.$('#activityHookHelp');
  help.open = true; copy.focus(); setLocale('en');
  assert.equal(h.$('#activityMirrorStatus').textContent, ''); assert.equal(h.$('#activityMirrorStatus').hidden, true);
  assert.equal(copy.getAttribute('aria-label'), 'Copy setup command');
  assert.equal(h.document.activeElement, copy); assert.equal(reads, baseline); assert.equal(copies, 0);
  assert.equal(selector.value, 'tool'); assert.equal(help.open, true);
  assert.match(selector.innerHTML, /设置/);
  assert.match(h.$('#activityHookSteps').innerHTML, /原始说明 \{title\}/);
  assert.equal(h.$('#activityHookCommand').textContent, 'command 原文');
  feature.dispose(); assert.equal(subscriptions, 0); setLocale('zh-CN'); assert.equal(copy.getAttribute('aria-label'), 'Copy setup command');
});
localized('task locale repaint preserves open overflow, focused action, row identity and user title/steps', context => {
  const h = controlDom(); let reads = 0, commands = 0;
  const task = { id: 'one', title: '设置 {title}', createdAt: 1, energy: 'medium', steps: [{ id: 'step', title: '开始专注', done: false }] };
  const state = { tasks: [task], archivedTasks: [{ id: 'old', title: '恢复任务', done: true }] };
  const feature = createPopoverTaskList({ ...h, getState: () => { reads++; return state; }, getSession: () => ({ paused: true, taskId: 'one' }),
    escapeHTML: value => String(value), formatMs: () => '10 min', localDateInputValue: () => '2026-10-09', syncPressedButtons() {},
    taskDates: {}, describeSeriesRule: () => '', taskActionMessage: () => '', formatExpiry: () => '', surfaceClient: { completeStep: () => { commands++; } },
    taskLaunchBlockReason: () => null, seriesForTask: () => null, completeTask() { commands++; }, openTaskEditor() {}, openBreakdown() {},
    startFocus() { commands++; }, celebrate() {}, showPanelStatus() {}, mergeHistoryPage() {} });
  feature.mount(); feature.renderList(); feature.renderArchive(); context.after(() => feature.dispose());
  const row = h.$('#taskList').children[0], menu = row.querySelector('.task-menu'), play = row.querySelector('.play'),
    action = row.querySelector('[data-task-action]'), title = row.querySelector('.task-title'), step = row.querySelector('.step-text');
  row.querySelector('.more').emit('click'); action.focus();
  const baseline = reads, archiveRow = h.$('#archiveList').children[0];
  setLocale('en');
  assert.equal(play.textContent, 'Start'); assert.equal(action.textContent, 'Break into steps');
  assert.equal(row.querySelector('.focus-badge').textContent, '← Timer paused');
  assert.equal(menu.classList.contains('hidden'), false); assert.equal(feature.isOverflowMenuOpen(), true);
  assert.equal(h.document.activeElement, action); assert.equal(h.$('#taskList').children[0], row);
  assert.equal(h.$('#archiveList').children[0], archiveRow); assert.equal(archiveRow.querySelector('button').textContent, '↩ Restore');
  assert.equal(title.textContent.trim(), '设置 {title}'); assert.equal(step.textContent, '开始专注');
  assert.equal(row.querySelector('.task-checkbox').getAttribute('aria-label'), 'Complete task: 设置 {title}');
  assert.equal(reads, baseline); assert.equal(commands, 0);
  feature.renderList(); assert.equal(row.querySelector('.more'), menu.parentNode.querySelector('.more'));
  assert.equal(row.querySelector('.play'), play, 'same projection after locale repaint does not rebuild controls');
  setLocale('zh-CN'); assert.equal(play.textContent, '开始'); assert.equal(h.document.activeElement, action);
  feature.dispose(); setLocale('en'); assert.equal(play.textContent, '开始');
});

localized('energy language repaint preserves model attribution and routine titles verbatim', () => {
  const { createPopoverEnergyStrip } = require('../src/surfaces/popover/features/energy-strip.mjs');
  const h = dom();
  const state = { energy: { level: 65, label: { text: '状态良好' } }, routines: { items: [{ id: 'r', title: '设置' }] },
    energyCurve: { levels: [40, 65], nowMinute: 60, confidence: 'medium', trend: 'rising', marks: [{ minute: 20, id: 'r' }],
      attribution: [{ source: 'impulse-ai', label: '开始专注 {title}', delta: 5 }, { source: 'routine', id: 'r', delta: 2 }] } };
  const feature = createPopoverEnergyStrip({ $: h.$, $$: () => [], getState: () => state,
    surfaceClient: {}, escapeHTML: String, syncPressedButtons() {} });
  feature.render(); setLocale('en'); feature.render();
  assert.match(h.$('#energyReading').textContent, /good/i);
  assert.match(h.$('#energyAttribution').textContent, /开始专注 \{title\}/);
  assert.match(h.$('#energyAttribution').textContent, /设置 \+2/);
  assert.match(h.$('#energyCurvePlot').attributes['aria-label'], /energy curve/);
  assert.match(h.$('#energyCurveMarks').innerHTML, /title="设置"/);
});

localized('review locale repaint retains unchecked task inputs and does not reopen or resolve', async context => {
  const { createPopoverReviewFeature } = require('../src/surfaces/popover/features/review.mjs');
  const h = dom(); let opens = 0, resolves = 0;
  const raf = global.requestAnimationFrame; global.requestAnimationFrame = fn => fn(); context.after(() => { global.requestAnimationFrame = raf; });
  h.document.createTextNode = textContent => ({ nodeType: 3, textContent });
  const card = { id: 'review', kind: 'startup', dayKey: '2026-10-09', status: 'pending' };
  const state = { serverNow: new Date(2026, 9, 9, 10).getTime(), reviews: { pending: [card] } };
  const feature = createPopoverReviewFeature({ ...h, $$: () => [], getState: () => state,
    surfaceClient: { openReview: async () => { opens++; return { card, facts: { kind: 'startup', picks: [{ id: 't', title: '设置' }] } }; },
      resolveReview: () => { resolves++; } }, activeLandingPrompt: () => null, isLandingModalOpen: () => false,
    renderLanding() {}, rememberLandingReturnFocus() {} });
  feature.mount(); context.after(() => feature.dispose()); feature.renderCards(); await feature.open('review');
  const body = h.$('#reviewBody'), section = body.children[1], row = section.children[2], input = row.children[0];
  input.checked = false; h.document.activeElement = input;
  const button = h.$('#reviewCards').children[0]?.children[1];
  setLocale('en');
  assert.equal(h.$('#reviewDone').textContent, 'Start with these');
  assert.equal(section.children[2].children[0], input); assert.equal(input.checked, false);
  assert.equal(row.children[1].textContent, '设置'); assert.equal(h.document.activeElement, input);
  assert.equal(opens, 1); assert.equal(resolves, 0);
  if (button) assert.equal(h.$('#reviewCards').children[0].children[1], button);
});

localized('progress locale-only notification retains selected heatmap cells and does not reselect', context => {
  const { createPopoverProgressFeature } = require('../src/surfaces/popover/features/progress.mjs');
  const h = controlDom(); let notify; const selected = [];
  h.$('#heatmap').contains = node => Boolean(node?.attributes?.['data-day']);
  const state = { serverNow: new Date(2026, 9, 9, 10).getTime(), stats: { dailyFocus: { '2026-10-09': 60000 } } };
  const feature = createPopoverProgressFeature({ ...h, getState: () => state, formatMs: ms => `${ms / 60000} min`,
    escapeHTML: String, onDaySelected: day => selected.push(day) });
  feature.mount({ subscribe: fn => { notify = fn; return () => {}; } }); context.after(() => feature.dispose());
  feature.renderStats(); feature.selectHeatmapDay('2026-10-09');
  const cell = h.$('#heatmap').querySelectorAll('[data-day]').at(-1); cell.focus();
  const detail = h.$('#heatmapDetail').innerHTML;
  setLocale('en'); notify({ localeOnly: true, dirty: { all: true }, state });
  assert.equal(h.$('#heatmap').querySelectorAll('[data-day]').at(-1), cell);
  assert.equal(h.document.activeElement, cell); assert.match(cell.title, /focus/i);
  assert.deepEqual(selected, ['2026-10-09']); assert.equal(h.$('#heatmapDetail').innerHTML, detail);
  assert.match(h.$('#weekFacts').textContent, /Last 7 days/);
});

localized('timeline locale-only notification retains loaded day, scroll and deletion arming without reads', async context => {
  const { createPopoverTimelineFeature } = require('../src/surfaces/popover/features/timeline.mjs');
  const h = dom(); let notify, reads = 0, resets = 0;
  const deletion = { view: () => ({ armedMoodId: 'm' }), resetArming: () => { resets++; }, subscribe: () => () => {} };
  const day = { dayKey: '2026-10-09', dayStart: 0, dayEnd: 86400000, rangeStart: 0, rangeEnd: 3600000,
    lanes: [], markers: [], totals: {} };
  const document = { ...h.document, createElement: undefined, addEventListener() {}, removeEventListener() {} };
  const feature = createPopoverTimelineFeature({ document, $: h.$, getState: () => ({ tasks: [], routines: { items: [] } }),
    escapeHTML: String, formatMs: String, moodDeletion: deletion,
    surfaceClient: { getTimelineDay: async () => { reads++; return { ok: true, day }; } } });
  feature.mount({ subscribe: fn => { notify = fn; return () => {}; } }); context.after(() => feature.dispose());
  await feature.showDay(day.dayKey); const before = resets; h.$('#timelineViewport').scrollTop = 79;
  setLocale('en'); notify({ localeOnly: true, dirty: { all: true } });
  assert.equal(reads, 1); assert.equal(resets, before); assert.equal(h.$('#timelineViewport').scrollTop, 79);
  assert.equal(deletion.view().armedMoodId, 'm'); assert.match(h.$('#timelineGuide').textContent, /saved activities/);
});

localized('planning locale changes preserve a pending confirmation, field drafts and same-request recovery', async context => {
  const { createPlanningPreferencesFeature } = require('../src/surfaces/popover/features/planning-preferences.mjs');
  const h = controlDom(), pending = deferred(), calls = [];
  const data = { parameters: [{ parameter: 'chronotypeShift', current: 0, minimum: -60, maximum: 60, maximumStep: 15 }],
    storedPreferences: [], receiptCount: 0, receiptCapacity: 512, collectionEnabled: true, retainedReportCount: 4,
    coverage: { eligible: false, consentEnabled: true, sampleCount: 4, coveredDays: 2, elapsedDays: 3, version: 1 }, trial: {} };
  const feature = createPlanningPreferencesFeature({ ...h, now: () => 1000, client: {
    getPlanningGuidance: async () => { calls.push(['read']); return { ok: true, view: data }; },
    cancelPlanningPreview: async value => { calls.push(['cancel', value]); return { ok: true }; },
    previewPlanningPreference: async input => { calls.push(['preview', input]); return { ok: true, previewId: 'same-id', confirmationExpiresAt: 9999, before: null, after: { ...input, id: 'p', expiresAt: null } }; },
    confirmPlanningPreference: value => { calls.push(['confirm', value]); return pending.promise; }
  } });
  h.$('#settingGroupPlanning').open = false; feature.init(); context.after(() => feature.dispose());
  h.$('#settingGroupPlanning').open = true; await feature.reload(); await feature.preview('preference');
  const confirm = feature.confirm(); await settle();
  h.$('#planningStart').value = '15:47'; h.$('#planningStart').selectionStart = 3; h.$('#planningStart').focus();
  h.$('#planningHistoryClear').checked = true;
  const baseline = calls.length, start = h.$('#planningStart'), options = h.$('#planningPreferenceTarget').children.slice();
  setLocale('en');
  assert.equal(h.$('#planningConfirm').textContent, 'Confirm save preference'); assert.equal(h.$('#planningConfirm').disabled, true);
  assert.match(h.$('#planningReviewText').textContent, /After confirmation: 13:00/);
  assert.equal(start.value, '15:47'); assert.equal(start.selectionStart, 3); assert.equal(h.document.activeElement, start);
  assert.equal(h.$('#planningHistoryClear').checked, true); assert.equal(calls.length, baseline);
  assert.deepEqual(h.$('#planningPreferenceTarget').children, options);
  pending.resolve({ ok: false, uncertain: true }); await confirm;
  assert.equal(h.$('#planningConfirm').textContent, 'Recheck this save');
  const request = calls.find(([name]) => name === 'confirm')[1];
  setLocale('zh-CN'); assert.equal(h.$('#planningConfirm').textContent, '重试核对这次保存');
  await feature.confirm(); assert.deepEqual(calls.filter(([name]) => name === 'confirm').map(([, value]) => value), [request, request]);
});

localized('AI change copy repaint preserves editable input, selection, expanded editor and raw diff values', () => {
  const { createCollaborationChangeView } = require('../src/surfaces/popover/ui/collaboration-change-view.mjs');
  const h = controlDom(), view = createCollaborationChangeView({ $: h.$, escapeHTML: String });
  const op = { opId: 'o', type: 'task.update', entityId: 't', scope: 'current', patch: { title: '设置' } };
  const changeSet = { proposalVersion: 2, operations: [op], rationale: '开始专注 {title}', warnings: ['设置'],
    diff: [{ opId: 'o', entityRef: { kind: 'task', id: 't' }, fields: [{ field: 'title', before: '设置', after: '开始专注' }], reversibility: { status: 'available' } }] };
  view.render({ changeSet, operations: [op], excluded: new Set(), message: '这些修改尚未提交。逐项核对后可以确认，也可以继续留在草稿里。' });
  const host = h.$('#draftChatChangeCards'), input = host.querySelector('[data-change-edit]'), checkbox = host.querySelector('[data-change-select]'), editor = host.querySelector('.chat-change-editor');
  input.value = '任务 {title}'; input.selectionStart = 2; input.focus(); checkbox.checked = false; editor.open = true;
  const markup = host.innerHTML;
  setLocale('en'); view.repaintCopy();
  assert.equal(input.value, '任务 {title}'); assert.equal(input.selectionStart, 2); assert.equal(h.document.activeElement, input);
  assert.equal(checkbox.checked, false); assert.equal(editor.open, true); assert.equal(host.innerHTML, markup);
  assert.equal(h.$('#btnDraftChatChangeConfirm').textContent, 'Confirm these changes');
  assert.ok(host.querySelectorAll('[data-change-copy]').some(node => node.textContent === 'Edit task'));
  assert.ok(host.querySelectorAll('[data-change-copy]').some(node => node.textContent === 'Reason for suggestion: 开始专注 {title}'));
  assert.ok(host.querySelectorAll('pre').some(node => node.textContent === '设置'));
  view.render({ receipt: { receiptId: 'r', status: 'applied', appliedRevision: 3 }, durability: 'unconfirmed', operations: [], excluded: new Set() });
  assert.equal(h.$('#draftChatChangeTitle').textContent, 'Save status needs checking');
  assert.equal(h.$('#btnDraftChatChangeRetry').textContent, 'Check save outcome');
  setLocale('zh-CN'); view.repaintCopy(); assert.equal(h.$('#draftChatChangeTitle').textContent, '修改的保存状态待核对');
});

localized('memory locale changes keep pending preview identity, acknowledgement and raw subject/body', async context => {
  const { createPopoverMemoryList } = require('../src/surfaces/popover/features/memory-list.mjs');
  const h = controlDom(), pending = deferred(), calls = [];
  const item = { id: 'm', version: 1, kind: 'preference', status: 'active', subject: '设置', body: '开始专注 {subject}',
    sourceType: 'user-statement', scope: 'work', privacyLevel: 'standard', expiresAt: null, lastUsedAt: null };
  const preview = { previewId: 'p', previewHash: 'a'.repeat(64), expectedVersion: 1, operation: 'pause', before: item,
    after: { ...item, status: 'paused', version: 2 }, affectedIds: ['m'], invalidatedSourceRefs: [], permanent: false };
  const feature = createPopoverMemoryList({ $: h.$, escapeHTML: String, now: () => 1000, surfaceClient: {
    listMemories: async () => { calls.push(['read']); return { ok: true, availability: 'available', items: [item], nextCursor: null }; },
    previewMemoryChange: async value => { calls.push(['preview', value]); return { ok: true, preview }; },
    confirmMemoryChange: value => { calls.push(['confirm', value]); return pending.promise; }
  } });
  feature.mount(); context.after(() => feature.dispose()); await feature.load(); await feature.requestAction('pause', 'm', 1);
  const confirm = feature.confirm(); await settle();
  const review = h.$('#memoryReviewContent').innerHTML, row = h.$('#memoryList').querySelector('.memory-row');
  h.$('#memoryPermanentAcknowledge').checked = true; h.$('#memoryDraftBody').value = '原文 {body}'; h.$('#memoryDraftBody').focus();
  const before = calls.length;
  setLocale('en');
  assert.equal(h.$('#memoryReviewTitle').textContent, 'Pause this memory');
  assert.equal(h.$('#btnConfirmMemoryChange').textContent, 'Confirm these changes');
  assert.equal(h.$('#memoryReviewContent').innerHTML, review); assert.equal(h.$('#memoryList').querySelector('.memory-row'), row);
  assert.equal(h.$('#memoryPermanentAcknowledge').checked, true); assert.equal(h.$('#memoryDraftBody').value, '原文 {body}');
  assert.equal(h.document.activeElement, h.$('#memoryDraftBody')); assert.equal(calls.length, before);
  assert.equal(h.$('#memoryList').querySelector('.memory-subject').textContent, '设置');
  assert.equal(h.$('#memoryList').querySelector('.memory-body').textContent, '开始专注 {subject}');
  pending.resolve({ ok: false, outcome: 'unknown', retrySameIdentity: true }); await confirm;
  assert.match(h.$('#memoryStatus').textContent, /outcome is unconfirmed/);
  const request = calls.find(([name]) => name === 'confirm')[1]; setLocale('zh-CN'); await feature.confirm({ retry: true });
  assert.deepEqual(calls.filter(([name]) => name === 'confirm').map(([, value]) => value), [request, request]);
});

localized('date and input presentation formatters preserve numeric values and untouched drafts', () => {
  const dates = require('../src/renderer/task-dates.mjs');
  const { createPopoverTaskInput } = require('../src/surfaces/popover/ui/task-input.mjs');
  const { createPopoverDom } = require('../src/surfaces/popover/ui/dom.mjs');
  const h = dom(), input = createPopoverTaskInput({ $: h.$ });
  const ui = createPopoverDom({ document: h.document, window: {} });
  h.$('#estimate').value = '0';
  const today = new Date(2026, 9, 9, 12), tomorrow = new Date(2026, 9, 10, 13, 45);
  setLocale('en');
  assert.equal(dates.describeDeadline(tomorrow, today).text, 'Due tomorrow');
  assert.equal(dates.formatScheduledFor(tomorrow, today), 'Tomorrow 13:45');
  assert.equal(ui.formatMs(25 * 60000), '25 min'); assert.equal(ui.formatMs(65 * 60000), '1h5m');
  assert.match(input.estimateInputError('#estimate'), /whole number/);
  assert.equal(h.$('#estimate').value, '0');
  assert.deepEqual(input.parseTagList('设置,开始专注，设置'), ['设置', '开始专注']);
  setLocale('zh-CN'); assert.equal(dates.describeDeadline(tomorrow, today).text, '明天 DDL');
  assert.equal(dates.formatScheduledFor(tomorrow, today), '明天 13:45'); assert.equal(ui.formatMs(25 * 60000), '25分');
});

localized('task expiry language repaint keeps the displayed instant and every draft date field', async context => {
  const { createPopoverTaskWhenFields } = require('../src/surfaces/popover/ui/task-when-fields.mjs');
  const h = controlDom(), chip = h.element('BUTTON'); chip.dataset.ttl = 'default'; let now = 1000, previewReads = 0;
  const feature = createPopoverTaskWhenFields({ $: h.$, $$: selector => selector === '.ttl-chip' ? [chip] : [], syncPressedButtons() {},
    localDateInputValue: () => '2026-10-09', localDateTimeInputValue: String, endOfDayISO: String,
    scheduledFromDateTimeInput: String, endOfLocalDateISO: String, formatExpiry: value => `${getLocale()}:${value}`,
    recurrenceIntervalError: () => null, autoExpiryPreview: () => { previewReads++; return `instant-${now}`; }, showStatus() {} });
  feature.mount(); context.after(() => feature.dispose()); await chip.emit('click');
  const input = h.$('#scheduledForInput'); input.value = '2026-10-10T12:47'; input.selectionStart = 9; input.focus();
  const before = previewReads; now = 4000; setLocale('en');
  assert.equal(h.$('#expiryPreview').textContent, '→ Expires en:instant-1000');
  assert.equal(previewReads, before); assert.equal(input.value, '2026-10-10T12:47');
  assert.equal(input.selectionStart, 9); assert.equal(h.document.activeElement, input);
});

localized('landing language repaint retains pending request, note, progress and focus without new resolution', async context => {
  const { createPopoverQuickStartLanding } = require('../src/surfaces/popover/features/quick-start-landing.mjs');
  const h = controlDom(), pending = deferred(), requests = [];
  const save = h.element('BUTTON'); save.dataset.focusLanding = 'save';
  h.$('#quickStartMask').classList.add('hidden'); h.$('#quickStartMask').querySelectorAll = () => [save];
  h.$('#quickStartMask').querySelector = () => save; h.$('#focusLandingActions').querySelector = () => save;
  const state = { focusLandingPrompt: { sessionId: 's', taskId: 't', taskEditable: true, status: 'pending' } };
  const feature = createPopoverQuickStartLanding({ ...h, $$: selector => selector.includes('data-focus-landing') ? [save] : [],
    getState: () => state, getSession: () => ({ mode: 'break', running: true }),
    modalRegistry: { isOpen: () => false, isAnyOpen: () => false }, landingBlockingModals: [], canReceiveFocus: () => false,
    focusActionMessage: reason => reason, surfaceClient: { resolveFocusLanding: value => { requests.push(value); return pending.promise; } } });
  feature.mount(); feature.render(); context.after(() => feature.dispose());
  const note = h.$('#landingNote'); note.value = '设置 {title}'; note.selectionStart = 4; note.focus();
  h.$('#landingProgressMade').checked = true; await note.emit('input'); await save.emit('click');
  setLocale('en');
  assert.equal(h.$('#quickStartTitle').textContent, 'Leave a place to pick up next time');
  assert.match(h.$('#landingDescription').textContent, /Your break is running/);
  assert.equal(note.value, '设置 {title}'); assert.equal(note.selectionStart, 4); assert.equal(h.document.activeElement, note);
  assert.equal(h.$('#landingProgressMade').checked, true); assert.equal(save.disabled, true); assert.equal(requests.length, 1);
  pending.resolve({ ok: false, reason: '原始诊断 {reason}' }); await settle();
  assert.equal(h.$('#quickStartError').textContent, '原始诊断 {reason}');
  setLocale('zh-CN'); assert.equal(h.$('#quickStartError').textContent, '原始诊断 {reason}');
  assert.equal(note.value, '设置 {title}'); assert.equal(requests[0].sessionId, 's');
});

localized('AI confirmation locale event retains its exact in-flight and retry identity', async context => {
  const { createCollaborationChangeReview } = require('../src/surfaces/popover/features/collaboration-change-review.mjs');
  const h = controlDom(), pending = deferred(), requests = [];
  const operation = { opId: 'o', type: 'task.update', entityId: 't', scope: 'current', patch: { title: '设置' } };
  const changeSet = { conversationId: 'c', changeSetId: 'change', proposalVersion: 1, applyGroupId: 'g',
    operationsHash: 'a'.repeat(64), previewHash: 'b'.repeat(64), disclosureHash: 'c'.repeat(64), operations: [operation],
    applyGroups: [{ applyGroupId: 'g', opIds: ['o'], store: 'config' }], diff: [] };
  const state = { open: true, scopeGrantId: 'grant', record: { id: 'c', messages: [{ proposal: { id: 'p', kind: 'change-set' } }] } };
  const feature = createCollaborationChangeReview({ $: h.$, escapeHTML: String, getState: () => state, onBusy() {},
    surfaceClient: { previewConversationChanges: async () => ({ ok: true, changeSet }),
      confirmConversationChanges: value => { requests.push(value); return pending.promise; } } });
  feature.mount(); context.after(() => feature.dispose()); await feature.preview('p');
  const confirm = feature.confirm(); await settle(); const cards = h.$('#draftChatChangeCards').innerHTML;
  h.$('#btnDraftChatChangeConfirm').focus(); setLocale('en');
  assert.equal(feature.isBusy(), true); assert.equal(requests.length, 1); assert.equal(h.$('#draftChatChangeCards').innerHTML, cards);
  assert.equal(h.document.activeElement, h.$('#btnDraftChatChangeConfirm'));
  assert.equal(h.$('#draftChatChangeStatus').textContent, 'Submitting the reviewed changes…');
  pending.resolve({ ok: false, reason: 'change-commit-outcome-unknown', retrySameIdentity: true }); await confirm;
  assert.equal(h.$('#btnDraftChatChangeRetry').textContent, 'Check save outcome');
  setLocale('zh-CN'); assert.equal(h.$('#btnDraftChatChangeRetry').textContent, '核对保存结果');
  await feature.confirm({ retry: true }); assert.deepEqual(requests[1], requests[0]);
});

localized('routine locale-only notification preserves draft fields, timer controls and delete arming', async context => {
  const { createPopoverRoutinesFeature } = require('../src/surfaces/popover/features/routines.mjs');
  const h = controlDom(); let notify, commands = 0;
  const state = { routines: { items: [{ id: 'r', title: '设置', kind: 'custom', customLabel: '开始专注', active: true }],
    today: { occurrences: [], counts: {} }, remindersEnabled: true } };
  const feature = createPopoverRoutinesFeature({ ...h, getState: () => state, escapeHTML: String,
    surfaceClient: { removeRoutine: () => { commands++; return { ok: true }; } } });
  feature.mount({ subscribe: fn => { notify = fn; return () => {}; } }); context.after(() => feature.dispose());
  const remove = h.element('BUTTON'); remove.setAttribute('data-routine', 'r'); remove.setAttribute('data-act', 'remove');
  await h.$('#routinesManageCard').emit('click', { target: remove });
  const row = h.$('#routineManageList').children[0], markup = h.$('#routineManageList').innerHTML;
  h.$('#routineTitle').value = '任务 {title}'; h.$('#routineCustomLabel').value = '设置'; h.$('#routineTitle').focus();
  await h.$('#btnAddRoutineTime').emit('click');
  const time = h.$('#routineTimeChoices').querySelector('[data-time-index]'); time.value = '17'; time.focus();
  setLocale('en'); notify({ state, localeOnly: true, dirty: { all: true } });
  assert.equal(h.$('#routineManageList').children[0], row); assert.equal(h.$('#routineManageList').innerHTML, markup);
  assert.equal(h.$('#routineTitle').value, '任务 {title}'); assert.equal(h.$('#routineCustomLabel').value, '设置');
  assert.equal(time.value, '17'); assert.equal(h.document.activeElement, time);
  assert.match(time.attributes['aria-label'], /Hour/); assert.match(h.$('#routineManageStatus').textContent, /again/);
  assert.equal(commands, 0);
  await h.$('#routinesManageCard').emit('click', { target: remove }); assert.equal(commands, 1);
});

localized('open timeline receipt repaint keeps its existing action and raw diff body', () => {
  const { renderTimelineReceipt } = require('../src/surfaces/popover/features/timeline-receipt-view.mjs');
  const h = dom(); let action = null;
  const paint = renderTimelineReceipt({ document: h.document, host: h.$('#receipt'), response: { receipt: { receiptId: 'r',
    conversationId: 'c', status: 'applied', details: { diff: [{ entityRef: { kind: 'task', id: 't' }, fields: [{ field: 'title', before: '设置', after: '开始专注' }] }] } }, historyStatus: 'synced', undoAvailable: true },
    onContinueConversation: value => { action = value; } });
  const section = h.$('#receipt').children[0], button = section.children[0];
  const text = { nodeType: 3, textContent: section.textContent }; section.childNodes = [text, button]; h.document.activeElement = button;
  setLocale('en'); paint();
  assert.match(text.textContent, /Title: 设置 → 开始专注/); assert.equal(button.textContent, 'Review and undo locally');
  assert.equal(section.childNodes[1], button); assert.equal(h.document.activeElement, button); assert.equal(action, null);
});

localized('conversation copy repaint preserves raw transcript, titles, model names, scroll and expanded records', () => {
  const { createCollaborationView } = require('../src/surfaces/popover/ui/collaboration-view.mjs');
  const h = controlDom(), view = createCollaborationView({ $: h.$, escapeHTML: String, fallbackReasonText: reason => reason });
  const record = { id: 'c', displayTitle: '设置', purpose: 'task', mode: 'talk', saveState: 'saved', retention: { mode: 'saved', days: 30 },
    messages: [{ id: 'u', role: 'user', content: '开始专注' }, { id: 'a', role: 'assistant', content: '设置 {title}',
      provenance: { source: 'local', reason: '原始诊断 {reason}' }, proposal: { id: 'p', kind: 'task-draft', version: 2,
        body: JSON.stringify({ title: '设置', nextAction: '开始专注', steps: [] }) } }] };
  view.conversation(record, 'p'); view.proposalStatuses('c', [{ proposalId: 'p', store: 'config', status: 'applied', receiptId: 'r', version: 3, targetId: 't', historyStatus: 'pending' }]);
  view.context({ fields: ['title'], provider: { model: '设置 {model}', endpoint: 'provider 原文' } }, { text: '开始专注' });
  view.sessions([record], null); view.draft('原始草稿', 'p'); view.busy(true);
  const log = h.$('#draftChatLog'), first = log.children[0], expanded = log.querySelector('details'), session = h.$('#draftChatSessions').children[0];
  expanded.open = true; log.scrollTop = 123; h.$('#draftChatInput').focus();
  const markup = log.innerHTML; setLocale('en'); view.repaintCopy();
  assert.equal(log.innerHTML, markup); assert.equal(log.children[0], first); assert.equal(expanded.open, true); assert.equal(log.scrollTop, 123);
  assert.equal(h.$('#draftChatSessions').children[0], session); assert.equal(h.$('#draftChatSessionTitle').textContent, '设置');
  assert.equal(h.$('#draftChatProvider').textContent, 'Receiving model: 设置 {model} · provider 原文');
  assert.equal(h.$('#draftChatInput').value, '原始草稿'); assert.equal(h.document.activeElement, h.$('#draftChatInput'));
  assert.equal(h.$('#btnDraftChatSend').textContent, 'Processing…'); assert.equal(h.$('#btnDraftChatSend').disabled, true);
  assert.ok(log.querySelectorAll('[data-chat-copy]').some(node => node.textContent.includes('原始诊断 {reason}')));
  assert.ok(log.querySelectorAll('.chat-turn-content').some(node => node.textContent === '设置 {title}'));
});

localized('conversation locale event preserves an in-flight turn and raw provider failure details without reads', async context => {
  const { createPopoverDraftConversation } = require('../src/surfaces/popover/features/draft-conversation.mjs');
  const h = controlDom(), pending = deferred(), calls = [];
  const record = { id: 'c', purpose: 'task', mode: 'talk', messages: [], retention: { mode: 'saved', days: 30 }, saveState: 'saved', inputDraft: '' };
  const response = () => ({ ok: true, conversation: record, scopeGrantId: 'grant', disclosure: { provider: { model: '设置', endpoint: 'original endpoint' } } });
  h.$('#draftChatMask').classList.add('hidden');
  const feature = createPopoverDraftConversation({ ...h, escapeHTML: String, fallbackReasonText: reason => reason,
    adoptProposal() {}, restoreModalFocus() {}, isAiClarifyEnabled: () => true, showEntryStatus() {},
    surfaceClient: { startConversation: async () => { calls.push(['open']); return response(); },
      conversationTurn: request => { calls.push(['turn', request]); return pending.promise; },
      pauseConversation: async () => ({ ok: true }), getConversationContextChoices: async () => { calls.push(['choices']); return { ok: true, items: [] }; } } });
  feature.mount(); context.after(() => feature.dispose()); await feature.open();
  const input = h.$('#draftChatInput'); input.value = '开始专注 {message}'; await input.emit('input');
  const sent = feature.send(); await settle();
  assert.equal(input.value, '');
  input.value = '下一条 {draft}'; await input.emit('input');
  input.selectionStart = 4; input.focus(); h.$('#draftChatLog').scrollTop = 83;
  const markup = h.$('#draftChatLog').innerHTML, count = calls.length;
  setLocale('en');
  assert.equal(input.value, '下一条 {draft}'); assert.equal(input.selectionStart, 4); assert.equal(h.document.activeElement, input);
  assert.equal(h.$('#draftChatLog').scrollTop, 83); assert.equal(h.$('#draftChatLog').innerHTML, markup); assert.equal(calls.length, count);
  assert.equal(h.$('#btnDraftChatSend').disabled, true); assert.equal(h.$('#btnDraftChatSend').textContent, 'Generating…');
  pending.resolve({ ...response(), source: 'local', fallback: true, providerReason: '原始诊断 {detail}' }); await sent;
  assert.equal(h.$('#draftChatStatus').textContent, 'Local template: 原始诊断 {detail}.');
  setLocale('zh-CN'); assert.equal(h.$('#draftChatStatus').textContent, '本地模板：原始诊断 {detail}。');
  assert.equal(calls.filter(([kind]) => kind === 'turn').length, 1);
});

localized('context selection language repaint keeps selected checkbox and search draft without loading', async context => {
  const { createCollaborationContextSelection } = require('../src/surfaces/popover/features/collaboration-context-selection.mjs');
  const h = controlDom(); let reads = 0, applied = 0;
  const record = { id: 'c' };
  const feature = createCollaborationContextSelection({ $: h.$, escapeHTML: String, getConversation: () => record,
    isOpen: () => true, isBusy: () => false, onChange() {}, onApply() { applied++; }, status() {},
    surfaceClient: { getConversationContextChoices: async () => { reads++; return { ok: true, items: [{ id: 't', title: '设置', textTruncated: true }] }; } } });
  feature.mount(); context.after(() => feature.dispose()); feature.reset(record); await feature.load(); feature.toggle('t', true);
  const host = h.$('#draftChatContextChoices'), checkbox = host.querySelector('[data-context-id]'), markup = host.innerHTML;
  checkbox.checked = true; checkbox.focus(); h.$('#draftChatContextSearch').value = '开始专注'; setLocale('en');
  assert.equal(host.innerHTML, markup); assert.equal(host.querySelector('[data-context-id]'), checkbox); assert.equal(checkbox.checked, true);
  assert.equal(h.document.activeElement, checkbox); assert.equal(h.$('#draftChatContextSearch').value, '开始专注');
  assert.equal(h.$('#draftChatScopeSelection').textContent, 'Selected: Tasks 1');
  assert.equal(h.$('#draftChatScopePending').textContent, 'Selection changed. Update the preview before sending.');
  assert.equal(reads, 1); assert.equal(applied, 0); assert.deepEqual(feature.selection().taskIds, ['t']);
});

localized('built-in food labels and activity labels translate without translating supplied names', () => {
  const { foodName } = require('../src/surfaces/companion/food-labels.mjs');
  const { foodEffectText, foodInventorySummary } = require('../src/surfaces/pet/feeding.mjs');
  const { activityLabelFor } = require('../src/surfaces/pet/activity-mirror.mjs');
  const { foodRequestMessage } = require('../src/surfaces/companion/food-request-lifecycle.mjs');
  setLocale('en');
  assert.equal(foodName('berry', '浆果'), 'Berries');
  assert.equal(foodName('berry', '设置'), '设置');
  assert.equal(foodName('custom', '浆果'), '浆果');
  assert.equal(foodEffectText({ satiation: 16 }), 'Fullness +16');
  assert.equal(foodInventorySummary({ totalFeeds: 7 }, 3), '3 in stock · Fed 7 times');
  assert.equal(activityLabelFor({ id: 'focus-read', state: 'focused', icon: '•', label: '读书' }), '• Focus · Reading');
  assert.equal(activityLabelFor({ id: 'custom', state: 'focused', icon: '•', label: '读书' }), '• Focus · 读书');
  assert.match(foodRequestMessage({ result: { reason: 'food-command-conflict' } }), /identity did not match/);
});

localized('companion shop locale copy retains pending control identity and receipt re-enables exchange', async context => {
  const { createPopoverCompanionFeature } = require('../src/surfaces/popover/features/companion.mjs');
  const { element } = require('../test-support/manual-growth-dom');
  const h = dom(), pending = deferred(), sent = [], subscribers = [];
  let reads = 0, renders = 0;
  let state = { revision: 1, level: 1, foodShop: { foodTickets: 6, items: [{ id: 'berry', name: '浆果', emoji: '', price: 1, level: 1, inventory: 2, affordable: true, unlocked: true }] } };
  const host = h.$('#foodShopList'); let markup = '', button, card;
  Object.defineProperty(host, 'innerHTML', { get: () => markup, set(value) {
    markup = value; renders++;
    button = element(); button.dataset.foodId = 'berry'; button.disabled = /<button[^>]* disabled/.test(value); button.closest = () => button;
    card = element(); card.dataset.foodCard = 'berry'; const leaves = new Map();
    card.querySelector = selector => selector === 'button' ? button : (leaves.get(selector) || leaves.set(selector, element()).get(selector));
    host.querySelectorAll = () => [card];
  } });
  h.$('#foodShopPanel').open = true;
  const feature = createPopoverCompanionFeature({ getState: () => { reads++; return state; }, $: h.$, escapeHTML: String, skinAccent: () => ({}),
    surfaceClient: { buyFood: request => { sent.push(request); return pending.promise; } } });
  feature.mount({ subscribe: listener => { subscribers.push(listener); return () => {}; }, refresh: async () => state });
  context.after(() => feature.dispose()); feature.renderCompanion();
  assert.equal(button.disabled, false);
  const operation = host.emit('click', { target: button });
  assert.equal(button.disabled, true);
  const pendingButton = button, pendingCard = card, baselineReads = reads, baselineRenders = renders;
  h.document.activeElement = button;
  setLocale('en'); subscribers.forEach(listener => listener({ localeOnly: true, state, dirty: { all: true } }));
  assert.equal(button, pendingButton); assert.equal(card, pendingCard); assert.equal(button.disabled, true);
  assert.equal(h.document.activeElement, pendingButton); assert.equal(h.$('#foodShopPanel').open, true);
  assert.equal(h.$('#foodShopStatus').textContent, 'Exchanging…');
  assert.equal(card.querySelector('strong').textContent, 'Berries');
  assert.equal(reads, baselineReads); assert.equal(renders, baselineRenders); assert.equal(sent.length, 1);
  state = { ...state, revision: 2, foodShop: { ...state.foodShop, foodTickets: 5, items: [{ ...state.foodShop.items[0], inventory: 3 }] } };
  subscribers.forEach(listener => listener({ state, dirty: { pet: true } }));
  assert.equal(button.disabled, true);
  pending.resolve({ ok: true, foodTickets: 5 }); await operation;
  assert.equal(button.disabled, false); assert.equal(sent.length, 1);
  assert.equal(h.$('#foodShopStatus').textContent, 'Added to food bag · 5 food tickets');
});

localized('food menu locale repaint keeps focused pending feeding button without reads or request replay', async context => {
  const { createPetFoodMenu } = require('../src/surfaces/pet/food-menu.mjs');
  const { FOODS } = require('../src/pet-content');
  const h = dom(), pending = deferred(), sent = [], speech = []; let reads = 0, geometry = 0, satiationWrites = 0;
  const snapshot = { satiation: 40, foodInventory: { berry: 2 }, foodTickets: 6, totalFeeds: 0, basicMeal: { remaining: 3, eligible: true } };
  Object.defineProperty(h.$('#foodList'), 'innerHTML', { set() { this.children = []; }, get() { return ''; } });
  const menu = createPetFoodMenu({ document: h.document, client: { pet_getFeedState: async () => { reads++; return snapshot; }, pet_feed: request => { sent.push(request); return pending.promise; } },
    content: () => ({ FOODS }), setOpen() {}, available: () => true, beforeOpen() {}, closeCommandMenu: async () => {}, expand: async () => { geometry++; return { side: 'right' }; }, changed() {},
    focusReturn() {}, requestFrame: () => 1, cancelFrame() {}, updateSatBar() { satiationWrites++; }, feeding: { clock: { read: () => 0 }, now: () => 1000, nonce: () => 'locale-food', present() {}, say: value => speech.push(value) } });
  context.after(() => menu.dispose()); await menu.open();
  const operation = menu.feed.feedPet('berry');
  const button = h.$('#foodList').children.find(node => node.dataset.food === 'berry'); h.document.activeElement = button;
  const baseline = [reads, geometry, satiationWrites];
  setLocale('en');
  assert.equal(h.$('#foodList').children.find(node => node.dataset.food === 'berry'), button);
  assert.equal(button.children[1].children[0].textContent, 'Berries');
  assert.equal(button.children[1].children[1].textContent, 'Check the previous feeding result');
  assert.equal(button.disabled, true); assert.equal(h.document.activeElement, button);
  assert.deepEqual([reads, geometry, satiationWrites], baseline); assert.equal(sent.length, 1);
  pending.resolve({ ok: false, reason: 'out-of-stock' }); await operation;
  assert.equal(speech[0], 'This food is out of stock.'); assert.equal(sent.length, 1);
});

localized('pet status copy preserves expanded badge, canonical activities and keyboard focus', async context => {
  const { createStatusFooter } = require('../src/surfaces/pet/status-footer.mjs');
  const { element } = require('../test-support/manual-growth-dom');
  const stage = element(), label = element(), next = element(), badge = element(), text = element(), count = element();
  badge.querySelector = selector => selector === '.context-label' ? text : count;
  const footer = createStatusFooter({ stage, label, next, badge }); context.after(() => footer.dispose());
  footer.syncActivity({ id: 'focus-read', state: 'focused', icon: '•', label: '读书' });
  footer.showContext({ copy: '专注 · 音乐 · AI协作', context: 'mixed', calmVisual: false, opacity: .8 });
  await badge.emit('click');
  const flags = { ...stage.attributes }, badgeState = { ...badge.dataset }, opacity = badge.style.opacity;
  setLocale('en');
  assert.equal(label.textContent, '• Focus · Reading'); assert.match(next.attributes.title, /Choose another companion activity/);
  assert.equal(text.textContent, 'Focus · Music · AI collaboration'); assert.equal(count.textContent, '2');
  assert.deepEqual(badge.dataset, badgeState); assert.equal(badge.attributes['aria-expanded'], 'true');
  assert.equal(badge.style.opacity, opacity); assert.deepEqual(stage.attributes, flags);
  footer.syncActivity({ id: 'custom', state: 'focused', icon: '•', label: '设置' });
  setLocale('zh-CN'); assert.equal(label.textContent, '• 专注 · 设置');
});

localized('session orbit locale repaint does not read clock, resync anchor or touch geometry', context => {
  const { createSessionOrbit } = require('../src/surfaces/pet/session-orbit.mjs');
  const h = dom(); for (const id of ['stage', 'sessionOrbit', 'sessionOrbitArc', 'sessionOrbitStar', 'sessionStatus', 'sessionStatusIcon']) h.$(id).removeAttribute = key => { delete h.$(id).attributes[key]; };
  let at = 0, clockReads = 0, commands = 0;
  const orbit = createSessionOrbit({ document: h.document, now: () => { clockReads++; return at; }, isCalm: () => false, isHidden: () => false, openPanel: () => { commands++; } });
  context.after(() => orbit.dispose());
  orbit.sync({ phase: 'focus', plannedMs: 120000, elapsedMs: 10000, running: true, sessionId: 'same-session' });
  at = 2000; orbit.render();
  const geometry = [h.$('#sessionOrbitArc').attributes['stroke-dashoffset'], h.$('#sessionOrbitStar').attributes.transform], baselineReads = clockReads;
  at = 9000; setLocale('en');
  assert.equal(clockReads, baselineReads); assert.equal(commands, 0);
  assert.match(h.$('#sessionStatus').attributes['aria-label'], /1:48 remaining/);
  assert.deepEqual([h.$('#sessionOrbitArc').attributes['stroke-dashoffset'], h.$('#sessionOrbitStar').attributes.transform], geometry);
  orbit.render(); assert.match(h.$('#sessionStatus').attributes['aria-label'], /1:41 remaining/);
});

localized('skin-aware pet hit label localizes in place with no layout reads and no competing static marker', context => {
  const { createPetHitLayout } = require('../src/surfaces/pet/hit-layout.mjs');
  const { resolvePetStage } = require('../src/core/pet-stage.mjs');
  const { element } = require('../test-support/manual-growth-dom');
  const hit = element(), canvas = element(), root = element(); let geometryReads = 0;
  const layout = createPetHitLayout({ hit, canvas, root, getStage: () => { geometryReads++; return resolvePetStage({ devicePixelRatio: 1 }); } });
  context.after(() => layout.dispose()); layout.update('usagi');
  const baseline = geometryReads, geometry = { ...hit.style };
  setLocale('en');
  assert.match(hit.attributes['aria-label'], /bubu 小奇: click or hold/);
  assert.equal(geometryReads, baseline); assert.deepEqual(hit.style, geometry);
  const html = require('node:fs').readFileSync(`${ROOT}/src/renderer/pet.html`, 'utf8');
  const tag = html.match(/<[^>]*\bid="petHit"[^>]*>/)[0];
  assert.doesNotMatch(tag, /data-i18n/);
  layout.dispose(); setLocale('zh-CN'); assert.match(hit.attributes['aria-label'], /click or hold/);
});

localized('wardrobe locale update retains focused selected options and does not redraw or equip', context => {
  const { createPopoverWardrobeFeature } = require('../src/surfaces/popover/features/wardrobe.mjs');
  const h = controlDom(); let listener, reads = 0, draws = 0, commands = 0;
  const state = { currentSkin: 'pink', skins: [{ id: 'pink', name: '设置' }], appearance: { wornIds: ['hat'], choices: [
    { group: 'headwear', selected: 'hat', options: [{ id: 'hat', label: '设置', available: true }, { id: 'locked', label: '开始专注', available: false, lockReason: { kind: 'skin', skin: 'pink' } }] }
  ] } };
  const feature = createPopoverWardrobeFeature({ ...h, getState: () => { reads++; return state; }, escapeHTML: String,
    surfaceClient: { equipAppearance() { commands++; }, resetAppearance() { commands++; } }, drawPetPreview() { draws++; }, restoreModalFocus() {} });
  feature.mount({ subscribe: callback => { listener = callback; return () => {}; } }); context.after(() => feature.dispose()); feature.render();
  const slots = h.$('#wardrobeSlots'), options = h.$('#wardrobeOptions');
  const slot = slots.querySelector('.wardrobe-slot'), slotLabel = slots.querySelector('.slot-name'); slot.querySelector = () => slotLabel;
  const buttons = options.querySelectorAll('.wardrobe-option'), hint = options.querySelector('.wardrobe-lock');
  const emptyName = options.querySelector('.wardrobe-item-name');
  const preview = options.querySelector('.wardrobe-item-preview');
  buttons[0].querySelector = selector => selector === '.wardrobe-item-name' ? emptyName : null;
  buttons[2].querySelector = () => hint; buttons[2].disabled = true; buttons[1].focus();
  const baseline = [reads, draws, commands], markup = options.innerHTML, selected = buttons[1].getAttribute('aria-pressed');
  setLocale('en'); listener({ localeOnly: true, state, dirty: { all: true } });
  assert.deepEqual([reads, draws, commands], baseline); assert.equal(h.document.activeElement, buttons[1]);
  assert.equal(options.querySelectorAll('.wardrobe-option')[1], buttons[1]); assert.equal(options.innerHTML, markup);
  assert.equal(emptyName.textContent, 'None'); assert.equal(options.querySelector('.wardrobe-item-name'), emptyName);
  assert.equal(options.querySelector('.wardrobe-item-preview'), preview); assert.equal(slotLabel.textContent, 'Headwear');
  assert.equal(buttons[1].getAttribute('aria-pressed'), selected); assert.equal(buttons[1].getAttribute('aria-label'), '设置, equipped');
  assert.equal(buttons[2].getAttribute('aria-label'), '开始专注, locked: Exclusive to 设置'); assert.equal(buttons[2].disabled, true);
  assert.equal(h.$('#wardrobeSummary').textContent, 'Accessories worn: 1');
  feature.render(state); assert.equal(draws, baseline[1], 'locale memoization prevents the next unchanged projection from redrawing');
});

localized('skin picker locale update retains preview, selection, locked control and proper names without redraw', context => {
  const { createPopoverSkinPicker } = require('../src/surfaces/popover/features/skin-picker.mjs');
  const h = controlDom(); let listener, reads = 0, draws = 0, commands = 0;
  h.$('#skinFocus').style.setProperty = () => {};
  const focus = h.$('#skinFocus'), query = focus.querySelector.bind(focus);
  focus.querySelector = selector => query(selector === '#btnSkinApply' ? '.skin-apply' : selector);
  const state = { currentSkin: 'pink', appearance: { wornIds: ['raw-accessory'] }, skins: [
    { id: 'pink', name: '设置', formId: 'dango', formName: '团子兽', unlocked: true, current: true, unlockDesc: '默认皮肤' },
    { id: 'mint', name: '开始专注', formId: 'dango', formName: '团子兽', unlocked: false, current: false, unlockLevel: 3, unlockDesc: 'Lv.3 解锁', progress: { current: 1, target: 3 } }
  ] };
  const feature = createPopoverSkinPicker({ ...h, getState: () => { reads++; return state; }, escapeHTML: String,
    surfaceClient: { switchSkin() { commands++; } }, drawPetPreview() { draws++; }, skinAccent: () => ({}), restoreModalFocus() {} });
  feature.mount({ subscribe: callback => { listener = callback; return () => {}; } }); context.after(() => feature.dispose()); feature.render(state);
  const strip = h.$('#skinStrip'), thumbs = strip.querySelectorAll('.skin-thumb'), details = strip.querySelectorAll('small');
  thumbs.forEach((thumb, index) => { thumb.querySelector = selector => selector === 'small' ? details[index] : null; });
  const species = h.$('#skinSpecies'); species.querySelector('[data-form]').querySelector = () => species.querySelector('small');
  void strip.emit('click', { target: thumbs[1] });
  const apply = focus.querySelector('#btnSkinApply'); apply.disabled = true; apply.focus();
  const baseline = [reads, draws, commands], markup = focus.innerHTML, selected = thumbs[1].getAttribute('aria-selected');
  setLocale('en'); listener({ localeOnly: true, state, dirty: { all: true } });
  assert.deepEqual([reads, draws, commands], baseline); assert.equal(h.document.activeElement, apply);
  assert.equal(focus.querySelector('#btnSkinApply'), apply); assert.equal(focus.innerHTML, markup); assert.equal(apply.disabled, true);
  assert.equal(apply.textContent, 'Locked · Unlocks at Lv.3');
  assert.equal(focus.querySelector('.skin-focus-name').textContent, '开始专注');
  assert.equal(focus.querySelector('.skin-progress-text').textContent, 'Current 1/3');
  assert.equal(thumbs[1].getAttribute('aria-selected'), selected); assert.equal(thumbs[1].getAttribute('aria-label'), '开始专注, locked');
  feature.render(state); assert.equal(draws, baseline[1]);
});

localized('companion keepsake locale copy preserves open letters and original story content', () => {
  const { renderCompanionCollection } = require('../src/surfaces/popover/features/companion-collection.mjs');
  const h = controlDom();
  const journey = { earned: 1, facts: { focus: 3, tasks: 1 }, next: null, chapters: [{ id: 'first-table', symbol: '01', color: 'green', title: '设置', letter: '开始专注 {letter}', unlocked: true }] };
  const repaint = renderCompanionCollection({ $: h.$, escapeHTML: String, journey, tastes: [{ id: 'berry', name: '浆果', emoji: '', label: '初次尝到', count: 1, target: 3 }] });
  const album = h.$('#journeyAlbum'), letter = album.querySelector('details'), text = album.querySelectorAll('p').find(node => node.textContent === '开始专注 {letter}');
  letter.open = true; letter.focus(); const markup = album.innerHTML;
  setLocale('en'); repaint();
  assert.equal(album.querySelector('details'), letter); assert.equal(letter.open, true); assert.equal(h.document.activeElement, letter);
  assert.equal(album.innerHTML, markup); assert.equal(text.textContent, '开始专注 {letter}');
  assert.match(markup, /开始专注 \{letter\}/);
  assert.ok(album.querySelectorAll('[data-collection-copy]').some(node => node.textContent === 'Open letter'));
  assert.ok(h.$('#tasteCollection').querySelectorAll('[data-collection-copy]').some(node => node.textContent === 'Berries'));
});

localized('quick unfinished confirmation status localizes while preserving its task identity and pending command', async context => {
  const { harness, active, emit, settle } = require('../test-support/quick-push-fixture');
  const pending = deferred(), requests = [];
  const h = await harness(context, { initial: active(), client: { completeTask: (id, confirm) => {
    requests.push([id, confirm]); return requests.length === 1
      ? Promise.resolve({ ok: false, reason: 'unfinished-steps-need-confirmation', unfinishedCount: 2 }) : pending.promise;
  } } });
  const button = h.$('#btnCompleteQuickTask'), status = h.$('#panelStatus');
  emit(button, 'click'); await settle();
  assert.equal(status.textContent, '还有 2 个步骤没勾；再按一次确认完成。');
  h.document.activeElement = button; const reads = h.reads();
  setLocale('en');
  assert.equal(status.textContent, t('还有 {count} 个步骤没勾；再按一次确认完成。', { count: 2 }));
  assert.equal(status.dataset.tone, 'warning'); assert.equal(button.textContent, t('仍然完成'));
  assert.equal(h.document.activeElement, button); assert.equal(h.reads(), reads); assert.deepEqual(requests, [['task-a', false]]);
  emit(button, 'click'); await settle();
  assert.equal(h.document.body.attributes['aria-busy'], 'true');
  setLocale('zh-CN'); setLocale('en');
  assert.equal(status.textContent, ''); assert.equal(button.textContent, t('仍然完成'));
  assert.equal(h.document.body.attributes['aria-busy'], 'true'); assert.equal(h.reads(), reads);
  assert.deepEqual(requests, [['task-a', false], ['task-a', true]]);
  pending.resolve({ ok: false, reason: 'session-changed' }); await settle();
  assert.equal(status.textContent, t('计时已换成另一轮，请按更新后的面板继续。'));
  setLocale('zh-CN'); assert.equal(status.textContent, '计时已换成另一轮，请按更新后的面板继续。');
  assert.deepEqual(requests, [['task-a', false], ['task-a', true]]);
});

localized('quick-start validation and sent-draft status retain explicit copy ownership across locale changes', async context => {
  const { harness, settle } = require('../test-support/quick-push-fixture');
  const pending = deferred(), requests = [];
  const h = await harness(context, { client: { kickstart: (...args) => { requests.push(args); return pending.promise; } } });
  h.open(); h.submit(); await settle();
  const status = h.$('#panelStatus'), input = h.$('#quickStartInput'); input.value = '设置 {raw}'; h.document.activeElement = input;
  const reads = h.reads();
  setLocale('en');
  assert.equal(status.textContent, t('下一动作需要 1–200 个字，输入内容还在。'));
  assert.equal(input.value, '设置 {raw}'); assert.equal(h.document.activeElement, input); assert.equal(requests.length, 0);
  h.submit(); await settle(); h.cancel();
  assert.equal(status.textContent, t('输入已收起；已发送的启动仍会按原任务处理。'));
  setLocale('zh-CN');
  assert.equal(status.textContent, '输入已收起；已发送的启动仍会按原任务处理。');
  assert.equal(h.reads(), reads); assert.equal(requests.length, 1); assert.equal(requests[0][1].nextAction, '设置 {raw}');
  pending.resolve({ ok: true }); await settle();
  assert.equal(status.textContent, '输入已收起；已发送的启动仍会按原任务处理。'); assert.equal(requests.length, 1);
});

localized('floating satiation label repaints through the real controller without restarting its hide timer', async context => {
  const { createHarness, settle, snapshot, send } = require('../test-support/pet-sync-fixture');
  const { receivedFoodMessage } = require('../src/surfaces/pet/feeding-copy.mjs');
  const h = createHarness({ initialState: snapshot() }); context.after(() => h.runtime.stop()); await settle();
  send(h, { satiation: 42.5 });
  const label = h.document.getElementById('satLabel'), fill = h.document.getElementById('satFill'), bar = h.document.getElementById('satBar');
  assert.equal(label.textContent, '饱食 43'); assert.equal(fill.style.width, '43%');
  const timers = [...h.timers.timeouts], nextId = h.timers.nextTimeoutId;
  setLocale('en');
  assert.equal(label.textContent, 'Fullness 43'); assert.equal(fill.style.width, '43%'); assert.equal(bar.classList.contains('show'), true);
  assert.deepEqual([...h.timers.timeouts], timers); assert.equal(h.timers.nextTimeoutId, nextId);
  assert.equal(receivedFoodMessage('设置 {food}'), 'Received 设置 {food}. Use the nearby feed button to share it with me.');
  const hide = timers.filter(([, timer]) => timer.delay === 3000).at(-1);
  assert.ok(hide); hide[1].fn(); assert.equal(bar.classList.contains('show'), false);
  setLocale('zh-CN'); assert.equal(label.textContent, '饱食 43'); assert.equal(bar.classList.contains('show'), false);
  h.runtime.stop(); setLocale('en'); assert.equal(label.textContent, '饱食 43');
});

localized('memory source disclosure locale repaint preserves shared SVG, open state and focused summary', context => {
  const { createMemoryManagementView } = require('../src/surfaces/popover/ui/memory-management-view.mjs');
  const h = controlDom(), view = createMemoryManagementView({ $: h.$, escapeHTML: String });
  view.list({ items: [{ id: 'm', version: 1, kind: 'preference', status: 'active', subject: 'Original subject', body: 'Original body', sourceType: 'user-statement', scope: 'work', privacyLevel: 'standard', expiresAt: null, lastUsedAt: null }], status: 'active', loaded: true });
  const list = h.$('#memoryList'), details = list.querySelector('.disclosure'), summary = list.querySelector('summary');
  const icon = list.querySelector('.disclosure-icon'), label = list.querySelectorAll('[data-memory-copy]').find(node => node.textContent === '来源与使用记录');
  assert.ok(details); assert.ok(icon); assert.ok(label); details.open = true; summary.focus();
  setLocale('en'); view.repaintCopy();
  assert.equal(label.textContent, 'Sources and usage'); assert.equal(list.querySelector('.disclosure-icon'), icon);
  assert.equal(details.open, true); assert.equal(h.document.activeElement, summary);
});
