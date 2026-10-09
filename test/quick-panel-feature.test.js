'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildQuickPanelView } = require('../src/application/queries/quick-panel-view');
const { allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');

const ROOT = path.resolve(__dirname, '..');

function task(id, title, steps = [], extra = {}) {
  return { id, title, steps, ...extra };
}

test('quick panel falls back only when its projection is unavailable', () => {
  assert.deepEqual(buildQuickPanelView(null), { mode: 'fallback' });
  assert.deepEqual(buildQuickPanelView(), { mode: 'fallback' });
});

test('active quick panel projects the session task and all unfinished steps by id', () => {
  const view = buildQuickPanelView({
    tasks: [task('t-1', '写发布说明', [
      { id: 's-done', title: '列提纲', done: true },
      { id: 's-1', title: '写第一段', done: false },
      { id: 's-2', title: '补截图', done: false },
      { id: 's-3', title: '检查链接', done: false },
      { id: 's-4', title: '通知同事', done: false }
    ], { seriesId: 'series-1' })],
    pomodoro: {
      running: true,
      paused: false,
      mode: 'focus',
      sessionId: 'session-1',
      taskId: 't-1',
      elapsedMs: 65_000,
      remainingMs: 1_435_000
    },
    focusMinutes: { chosen: 25 }
  });

  assert.equal(view.mode, 'active');
  assert.deepEqual(view.task, { id: 't-1', title: '写发布说明', seriesId: 'series-1' });
  assert.deepEqual(view.steps.map(step => step.id), ['s-1', 's-2', 's-3', 's-4']);
  assert.equal(view.session.running, true);
  assert.equal(view.session.elapsedMs, 65_000);
  assert.equal(Object.isFrozen(view.steps), true);
});

test('paused break remains active without inventing a task', () => {
  const view = buildQuickPanelView({
    tasks: [],
    pomodoro: {
      running: false,
      paused: true,
      mode: 'break',
      sessionId: 'break-1',
      taskId: null,
      elapsedMs: 30_000,
      remainingMs: 270_000
    }
  });
  assert.equal(view.mode, 'active');
  assert.equal(view.session.kind, 'break');
  assert.equal(view.session.paused, true);
  assert.equal(view.task, null);
  assert.deepEqual(view.steps, []);
});

test('idle quick panel reuses ranked recommendation candidates without duplicating ids', () => {
  const tasks = [
    task('t-1', '综合优先'),
    task('t-2', '容易开始'),
    task('t-3', '第三项'),
    task('t-4', '不应出现')
  ];
  const view = buildQuickPanelView({
    tasks,
    pomodoro: { running: false, paused: false },
    focusMinutes: { chosen: 45 },
    recommendations: {
      candidates: [
        { task: tasks[0], role: '综合优先', reason: '快到期', recommendedStartMinutes: 25 },
        { task: tasks[0], role: '重复项' },
        { task: tasks[1], role: '最容易开始' },
        { task: tasks[2], role: '第三项' },
        { task: tasks[3], role: '第四项' }
      ]
    }
  });

  assert.equal(view.mode, 'idle');
  assert.equal(view.chosenMinutes, 45);
  assert.deepEqual(view.candidates.map(candidate => candidate.id), ['t-1', 't-2', 't-3']);
});

test('impulse surface is allowed only the existing commands needed by the quick panel', () => {
  for (const channel of [
    'state:get', 'impulses:add', 'impulse:hide',
    'tasks:complete', 'tasks:complete-step', 'tasks:update',
    'pomodoro:start', 'pomodoro:pause', 'pomodoro:resume', 'pomodoro:stop'
  ]) {
    assert.ok(allowedSurfacesFor(channel).includes('impulse'), `${channel} must allow impulse`);
  }
  assert.equal(allowedSurfacesFor('tasks:delete').includes('impulse'), false);
  assert.equal(allowedSurfacesFor('settings:update').includes('impulse'), false);
});

test('quick panel HTML exposes three exclusive modes and the feature uses a scoped client', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/impulse.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'src/surfaces/impulse/quick-panel.mjs'), 'utf8');
  for (const id of ['activePanel', 'idlePanel', 'fallbackPanel', 'impInput', 'stepInput', 'quickCandidates',
    'quickStartForm', 'quickStartTitle', 'quickStartInput', 'quickStartConfirm', 'quickStartCancel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /type="module" src="\.\.\/surfaces\/impulse\/entry\.mjs"/);
  assert.doesNotMatch(source, /window\.bubu/);

  const module = await import(pathToFileURL(path.join(ROOT, 'src/surfaces/impulse/quick-panel.mjs')).href);
  assert.equal(module.formatDuration(65_000), '01:05');
  assert.equal(module.commandMessage({ reason: 'task-completed' }), '这件任务已经完成。');
});

test('title-only candidate action uses the complete canonical task instead of its recommendation copy', () => {
  const canonical = task('t', 'Canonical title', [], { description: 'Full content', nextAction: null, updatedAt: 100 });
  const view = buildQuickPanelView({ tasks: [canonical], now: 1000, startState: {},
    pomodoro: {}, recommendations: { candidates: [{ task: { ...canonical, description: 'Stale copy' } }] } });
  assert.deepEqual(view.candidates[0].quickStartAction, { taskId: 't', intent: 'clarify-and-start', enabled: true,
    reason: null, taskVersion: entityFingerprint(canonical) });
});
