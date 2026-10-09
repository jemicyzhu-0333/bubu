'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dom } = require('../test-support/manual-growth-dom');
const { setLocale, getLocale, t } = require('../src/surfaces/shared/interface/i18n.mjs');
const { createPopoverDom } = require('../src/surfaces/popover/ui/dom.mjs');
const { createPopoverFocusTimer } = require('../src/surfaces/popover/features/focus-timer.mjs');
const { createPopoverNowCard } = require('../src/surfaces/popover/features/now-card.mjs');
const sessionDuration = require('../src/capabilities/execution/contract/session-duration.mjs');

test('explicit status callbacks repaint product copy while arbitrary details remain verbatim', context => {
  const before = getLocale(); context.after(() => setLocale(before)); setLocale('en');
  const h = dom(), owner = createPopoverDom({ document: h.document, window: {} });
  context.after(() => owner.dispose());
  owner.setStatusLine('#taskPanelStatus', () => t('暂无可切换的任务。'));
  owner.setStatusLine('#raw', '设置 {minutes}');
  assert.equal(h.$('#taskPanelStatus').textContent, 'No other tasks available.');
  setLocale('zh-CN'); assert.equal(h.$('#taskPanelStatus').textContent, '暂无可切换的任务。');
  assert.equal(h.$('#raw').textContent, '设置 {minutes}');
  owner.setStatusLine('#taskPanelStatus', ''); setLocale('en');
  assert.equal(h.$('#taskPanelStatus').textContent, '');
  assert.equal(h.$('#taskPanelStatus').classList.contains('hidden'), true);
  owner.setStatusLine('#taskPanelStatus', () => t('暂无可切换的任务。'));
  owner.dispose(); setLocale('zh-CN'); assert.equal(h.$('#taskPanelStatus').textContent, 'No other tasks available.');
});

test('Now candidate failure retains source semantics through its actual focus status owner', async context => {
  const before = getLocale(); context.after(() => setLocale(before)); setLocale('en');
  const h = dom();
  const state = { tasks: [], settings: { pomodoroMinutes: 25, breakMinutes: 5 } };
  const session = { running: false, paused: false, status: 'idle' };
  const owner = createPopoverDom({ document: h.document, window: {} }); context.after(() => owner.dispose());
  const timer = createPopoverFocusTimer({ document: h.document, $: h.$, $$: () => [], getState: () => state,
    getSession: () => session, pad2: value => String(value).padStart(2, '0'), setStatusLine: owner.setStatusLine,
    sessionDuration, surfaceClient: {}, focusActionMessage: () => '', currentTask: () => null });
  context.after(() => timer.dispose());
  let reads = 0;
  const now = createPopoverNowCard({ document: h.document, $: h.$, getState: () => state,
    getSession: () => session, escapeHTML: String, surfaceClient: { pickOneTask: async () => { reads++; return { candidates: [] }; } },
    taskLaunchBlockReason: () => null, focusActionMessage: () => '', taskActionMessage: () => '', scoreSummary: () => '',
    syncBlocker: () => '', canReceiveFocus: () => true, celebrate() {}, completeTask() {}, openTaskEditor() {},
    runQuickStart() {}, showFocusStatus: timer.showFocusActionStatus });
  now.mount(); context.after(() => now.dispose()); h.$('#candidatePanel').classList.add('hidden');
  await h.$('#btnChooseCandidates').emit('click'); await Promise.resolve();
  assert.equal(h.$('#focusActionStatus').textContent, 'No other tasks available.');
  setLocale('zh-CN'); timer.renderPomoStructure({ copyOnly: true });
  assert.equal(h.$('#focusActionStatus').textContent, '暂无可切换的任务。');
  assert.equal(reads, 1);
});
