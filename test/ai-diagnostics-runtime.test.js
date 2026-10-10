'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiDiagnostics, LIMITS, SESSION_MS } = require('../src/capabilities/guidance/application/ai-diagnostics');
const { createAiDiagnosticsRuntime, hasDiagnosticsCapability } = require('../src/bootstrap/ai-diagnostics');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
function fixture(available = true) {
  let at = 1000, source = true;
  const timers = [];
  const inspector = createAiDiagnostics({ available, now: () => at, schedule: callback => { timers.push(callback); return timers.length; }, cancelSchedule() {}, isSourceCurrent: () => source });
  return { inspector, timers, time: value => { at = value; }, invalidate: () => { source = false; } };
}
test('explicit package capability only; default capture off; no configuration/env/version bypass', () => {
  for (const metadata of [{}, { version: '0.0.2-dev.3' }, { bubuCapabilities: { schemaVersion: 1, aiDiagnostics: 'true' } }]) assert.equal(hasDiagnosticsCapability(metadata), false);
  assert.equal(hasDiagnosticsCapability({ bubuCapabilities: { schemaVersion: 1, aiDiagnostics: true } }), true);
  const { inspector } = fixture(false);
  assert.equal(inspector.status().active, false); assert.equal(inspector.start().ok, false); assert.equal(inspector.begin('capture-triage'), null);
});
test('session opt-in, clear/stop/expiry and prior callbacks never resurrect content', () => {
  const { inspector: d, timers, time } = fixture();
  assert.equal(d.begin('capture-triage'), null); d.start();
  const run = d.begin('capture-triage'); run.observe('output', { text: 'private output' });
  assert.equal(d.list().records.length, 1); d.clear(); run.observe('output', { text: 'late' }); run.finish('accepted');
  assert.equal(d.list().records.length, 0); assert.equal(d.status().active, true);
  // clear does not accidentally invalidate the original expiry timer.
  timers[0](); assert.equal(d.status().active, false);
  d.start(); const next = d.begin('impulse-energy'); next.observe('output', { text: 'next' }); d.stop(); next.observe('output', { text: 'late' });
  assert.equal(d.list().records.length, 0); d.start(); d.begin('capture-triage'); time(1000 + SESSION_MS); assert.equal(d.status().active, false); assert.equal(d.list().records.length, 0);
});
test('old cancelled timer cannot close a newly started session; source and dispose clear', () => {
  const f = fixture(); f.inspector.start(); f.inspector.start(); f.timers[0](); assert.equal(f.inspector.status().active, true);
  const run = f.inspector.begin('capture-triage', { id: 'source' }); run.observe('output', { text: 'sensitive' });
  f.invalidate(); const item = f.inspector.list().records[0];
  assert.equal(f.inspector.detail({ id: item.id }).record.contentRemoved, true);
  run.observe('output', { text: 'cannot return' }); run.finish('accepted');
  assert.doesNotMatch(JSON.stringify(f.inspector.detail({ id: item.id })), /sensitive|cannot return/);
  f.inspector.dispose(); assert.equal(f.inspector.start().ok, false);
});
test('diagnostic data is detached, field bounded and visible truncation covers every loss', () => {
  const { inspector: d } = fixture(); d.start(); const run = d.begin('capture-triage');
  const value = { reason: 'before' }; run.observe('validated', { value }); value.reason = 'after';
  run.observe('validated', { value: Array(41).fill('x') });
  const id = d.list().records[0].id, detail = d.detail({ id });
  assert.equal(detail.record.events[0].data.value.reason, 'before'); assert.equal(detail.record.truncated, true);
  detail.record.events[0].data.value.reason = 'mutated'; assert.equal(d.detail({ id }).record.events[0].data.value.reason, 'before');
});
test('recognized echoed credentials are masked; unsupported metadata never stored; export never has bodies', () => {
  const { inspector: d } = fixture(); d.start(); const run = d.begin('capture-triage');
  run.observe('output', { text: 'Authorization: Basic abcdef\nCookie: session=hidden\nhttps://example.invalid/?token=hidden\nhttps://ordinary.example/path\nsk-abcdefghijklmnop',
    apiKey: 'credential', endpoint: 'https://secret.example', headers: { Cookie: 'secret' } });
  run.observe('validated', { value: { category: 'note', reason: 'private reason', apiKey: 'nope' } });
  run.finish('suggestion-saved', true);
  const record = d.detail({ id: d.list().records[0].id }).record, all = JSON.stringify(record);
  assert.equal(record.redacted, true); assert.doesNotMatch(all, /abcdef|session=hidden|token=hidden|secret.example|abcdefghijklmnop|credential|nope/);
  assert.match(all, /ordinary.example/); assert.doesNotMatch(d.exportMetadata().text, /private reason|ordinary.example|output.*text|"value"/);
});
test('run/count/UTF-8 event bytes remain bounded and eviction cannot repopulate', () => {
  const { inspector: d } = fixture(); d.start(); const first = d.begin('capture-triage');
  for (let i = 0; i < 120; i++) { const run = d.begin('impulse-energy'); for (let j = 0; j < 55; j++) run.observe('output', { text: '中'.repeat(12000) }); }
  assert.ok(d.status().count <= LIMITS.runs);
  const records = d.list().records.map(row => d.detail({ id: row.id }).record);
  const bytes = records.reduce((sum, row) => sum + row.events.reduce((n, event) => n + Buffer.byteLength(JSON.stringify(event)), 0), 0);
  assert.ok(bytes <= LIMITS.bytes); assert.ok(records.every(row => row.events.length <= LIMITS.events && row.truncated));
  first.observe('output', { text: 'cannot return' }); assert.ok(d.list().records.every(row => row.id !== 'run-1'));
});
test('closed IPC is popover only and production cannot start through handler', () => {
  const runtime = createAiDiagnosticsRuntime({ readSnapshot: () => ({ impulses: [], tasks: [] }), metadata: {} });
  const routes = new Map(); runtime.register((channel, handler) => routes.set(channel, handler));
  for (const channel of routes.keys()) assert.deepEqual(allowedSurfacesFor(channel), ['popover']);
  assert.equal(routes.get('ai:diagnostics-start')().reason, 'diagnostics-unavailable');
  assert.equal(validateIpcPayload('ai:diagnostics-start', { enabled: true }).ok, false);
  assert.equal(validateIpcPayload('ai:diagnostics-detail', { id: 'run-1', path: '/tmp' }).ok, false);
  assert.equal(validateIpcPayload('ai:diagnostics-detail', { id: 'run-1' }).ok, true);
});

test('every canonical disclosed source is checked: task steps and enrich tags, including untargeted drafts', () => {
  for (const task of ['unstick', 'enrich']) {
    for (const targeted of [true, false]) {
      if (task === 'unstick' && !targeted) continue;
      const state = { tasks: [{ id: 'task-1', title: 'Synthetic title', steps: [{ title: 'Private step' }], tags: ['Private tag'] }], impulses: [] };
      const runtime = createAiDiagnosticsRuntime({ readSnapshot: () => state, now: () => 1000, schedule: () => 1, cancelSchedule() {},
        metadata: { bubuCapabilities: { schemaVersion: 1, aiDiagnostics: true } } });
      runtime.start(); const run = runtime.begin(task, targeted ? { taskId: 'task-1' } : {});
      run.observe('output', { text: 'Private step and Private tag' });
      const id = runtime.list().records[0].id, beforeEpoch = runtime.status().epoch;
      if (task === 'unstick') state.tasks[0].steps = []; else state.tasks[0].tags = [];
      runtime.reconcile(); assert.ok(runtime.status().epoch > beforeEpoch);
      const detail = runtime.detail({ id }); assert.equal(detail.record.contentRemoved, true);
      run.observe('output', { text: 'late Private step' }); run.finish('proposal-command-succeeded', null);
      assert.doesNotMatch(JSON.stringify(runtime.detail({ id })), /Private step|Private tag/);
      assert.equal(runtime.detail({ id }).record.outcome.changed, null);
    }
  }
});
