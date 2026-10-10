'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dom } = require('../test-support/manual-growth-dom');
const { createActivityMirrorSettings } = require('../src/surfaces/popover/features/activity-mirror-settings.mjs');
const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
const { AGENT_PLUGIN_TOOLS } = require('../src/content/agent-plugin');
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(context, copy = async () => ({ ok: true }), extra = {}) {
  const h = dom(), timers = new Map(); let timer = 0;
  const state = { revision: 1, activityMirror: { enabled: true, receiver: 'listening', activity: 'ai', tools: AGENT_PLUGIN_TOOLS.map(tool => ({ ...tool, command: `fixture-${tool.id}`, lastSignalAt: null })) }, settings: { activityMirrorEnabled: true } };
  const store = { subscribe() { return () => {}; }, refresh: extra.refresh };
  const feature = createActivityMirrorSettings({ ...h, getState: () => state, escapeHTML: text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'), surfaceClient: { copyAgentPluginCommand: copy, updateSettings: extra.updateSettings }, setTimer: fn => { timers.set(++timer, fn); return timer; }, clearTimer: id => timers.delete(id) });
  feature.mount(store); context.after(() => { feature.dispose(); setLocale('zh-CN'); });
  const select = async id => { h.$('#activityHookTool').value = id; await h.$('#activityHookTool').emit('change'); };
  const click = () => h.$('#activityHookList').emit('click', { target: { closest: () => h.$('#activityHookCopy') } });
  return { ...h, state, feature, store, timers, select, click };
}
test('AI foreground and copy never substitute for a signal; real history is scoped per selected tool', async context => {
  const h = harness(context);
  assert.equal(h.$('#activityHookSignal').classList.contains('received'), false);
  await h.click(); await settle();
  assert.equal(h.$('#activityHookSignal').classList.contains('received'), false);
  h.state.activityMirror.tools[0].lastSignalAt = Date.now() - 86_400_000; h.feature.render();
  assert.equal(h.$('#activityHookSignal').classList.contains('received'), true);
  assert.match(h.$('#activityHookSignal').attributes['aria-label'], /不代表当前在线/);
  assert.match(h.$('#activityHookSignalDetail').textContent, /不代表当前在线/);
  await h.select('codex'); assert.equal(h.$('#activityHookSignal').classList.contains('received'), false);
  await h.select('claude-code'); h.state.activityMirror.receiver = 'port-in-use'; h.feature.render();
  assert.equal(h.$('#activityHookSignal').classList.contains('received'), false);
  assert.equal(h.$('#activityHookState').textContent, '暂时无法接收信号');
});
test('selected help retains every descriptor step, uses unchanged command, and preserves selection across projection and locale', async context => {
  const h = harness(context); await h.select('codex');
  assert.match(h.$('#activityHookSteps').innerHTML, /\/plugins/); assert.match(h.$('#activityHookSteps').innerHTML, /信任插件里的两条 hook/);
  assert.equal(h.$('#activityHookCommand').textContent, 'fixture-codex');
  h.$('#activityHookHelp').open = true; h.feature.render(); setLocale('en');
  assert.equal(h.$('#activityHookTool').value, 'codex'); assert.equal(h.$('#activityHookHelp').open, true);
  assert.equal(h.$('#activityHookCopy').attributes['aria-label'], 'Copy setup command');
  h.state.activityMirror.tools = h.state.activityMirror.tools.filter(tool => tool.id !== 'codex'); h.feature.render();
  assert.equal(h.$('#activityHookTool').value, 'claude-code');
});
test('copy is single-flight across rerenders and switching tools suppresses both stale success and errors', async context => {
  const pending = deferred(); const calls = []; const h = harness(context, id => { calls.push(id); return pending.promise; });
  await h.click(); h.feature.render(); await h.click(); assert.deepEqual(calls, ['claude-code']);
  await h.select('codex'); assert.equal(h.$('#activityHookCopy').disabled, true);
  pending.resolve({ ok: true }); await settle();
  assert.equal(h.$('#activityHookCopy').disabled, false); assert.equal(h.$('#activityHookState').textContent, '还没有收到信号'); assert.equal(h.timers.size, 0);
  const rejection = deferred(); const other = harness(context, () => rejection.promise); await other.click(); await other.select('codex'); rejection.reject(Error('fixture')); await settle();
  assert.equal(other.$('#activityHookState').textContent, '还没有收到信号');
});
test('only an explicit successful copy receipt shows a brief check; failed or missing receipts allow retry', async context => {
  let response; const h = harness(context, async () => response);
  for (response of [undefined, { ok: false }, { ok: 'yes' }]) {
    await h.click(); await settle(); assert.equal(h.$('#activityHookState').textContent, '操作失败，请重试'); assert.equal(h.$('#activityHookCopy').disabled, false); assert.equal(h.timers.size, 0);
  }
  response = { ok: true }; await h.click(); await settle();
  assert.equal(h.$('#activityHookState').textContent, '已复制'); assert.equal(h.$('#activityHookCopy').attributes['aria-label'], '已复制');
  const reset = [...h.timers.values()][0]; reset(); assert.equal(h.$('#activityHookState').textContent, '还没有收到信号');
});
test('disposed copy completion and expired timers cannot alter a remount or a newer selection', async context => {
  const pending = deferred(); const h = harness(context, () => pending.promise); await h.click();
  h.feature.dispose(); h.feature.mount(h.store); await h.select('codex'); pending.resolve({ ok: true }); await settle();
  assert.equal(h.$('#activityHookState').textContent, '还没有收到信号'); assert.equal(h.timers.size, 0);
  const other = harness(context); await other.click(); await settle(); const oldTimer = [...other.timers.values()][0];
  await other.select('codex'); await other.click(); await settle(); oldTimer();
  assert.equal(other.$('#activityHookState').textContent, '已复制'); other.feature.dispose(); assert.equal(other.timers.size, 0); oldTimer();
});

test('a superseded check timer cannot clear a newer receipt for the same selected tool', async context => {
  const h = harness(context); await h.click(); await settle(); const firstTimer = [...h.timers.values()][0];
  await h.click(); await settle(); firstTimer();
  assert.equal(h.$('#activityHookState').textContent, '已复制'); assert.equal(h.timers.size, 1);
});

test('copy and signal status stay accessible without a visible filler line; only errors expose the status row', async context => {
  let result = { ok: true }; const h = harness(context, async () => result);
  assert.equal(h.$('#activityHookState').classList.contains('sr-only'), true);
  await h.click(); await settle();
  assert.equal(h.$('#activityHookState').textContent, '已复制'); assert.equal(h.$('#activityHookState').classList.contains('sr-only'), true);
  assert.equal(h.$('#activityHookCopy').attributes['aria-label'], '已复制');
  result = { ok: false }; await h.click(); await settle();
  assert.equal(h.$('#activityHookState').textContent, '操作失败，请重试'); assert.equal(h.$('#activityHookState').classList.contains('sr-only'), false);
  await h.select('codex'); assert.equal(h.$('#activityHookState').classList.contains('sr-only'), true);
});

test('copy receipt accent belongs only to the successful button and clears on retry or tool change', async context => {
  let response = { ok: true }; const h = harness(context, async () => response);
  assert.equal(h.$('#activityHookCopy').classList.contains('is-copied'), false);
  await h.click(); await settle();
  assert.equal(h.$('#activityHookCopy').classList.contains('is-copied'), true);
  assert.equal(h.$('#activityHookSignal').classList.contains('received'), false);
  response = { ok: false }; await h.click(); await settle();
  assert.equal(h.$('#activityHookCopy').classList.contains('is-copied'), false);
  response = { ok: true }; await h.click(); await settle(); await h.select('codex');
  assert.equal(h.$('#activityHookCopy').classList.contains('is-copied'), false);
});

test('ordinary activity and disabled states are quiet while actual receiver faults remain visible', context => {
  const h = harness(context);
  for (const activity of ['none', 'music', 'coding', 'ai']) {
    h.state.activityMirror.activity = activity; h.feature.render();
    assert.equal(h.$('#activityMirrorStatus').textContent, ''); assert.equal(h.$('#activityMirrorStatus').hidden, true);
  }
  h.state.activityMirror.receiver = 'port-in-use'; h.feature.render();
  assert.match(h.$('#activityMirrorStatus').textContent, /端口被占用/); assert.equal(h.$('#activityMirrorStatus').hidden, false);
  h.state.activityMirror.receiver = 'listen-failed'; h.feature.render();
  assert.match(h.$('#activityMirrorStatus').textContent, /通知暂时收不到/); assert.equal(h.$('#activityMirrorStatus').hidden, false);
  h.state.activityMirror.enabled = false; h.feature.render();
  assert.equal(h.$('#activityMirrorStatus').textContent, ''); assert.equal(h.$('#activityMirrorStatus').hidden, true);
});

test('toggle reports busy and definite refusal without retrying or confusing it with uncertainty', async context => {
  const pending = deferred(); let writes = 0, reads = 0;
  const h = harness(context, undefined, { updateSettings: () => { writes++; return pending.promise; }, refresh: () => { reads++; } });
  await h.$('#activityMirrorToggle').emit('click'); await h.$('#activityMirrorToggle').emit('click');
  assert.equal(writes, 1); assert.equal(h.$('#activityMirrorToggle').attributes['aria-busy'], 'true');
  assert.equal(h.$('#activityMirrorStatus').textContent, '正在保存…');
  pending.resolve({ ok: false }); await settle();
  assert.equal(h.$('#activityMirrorToggle').disabled, false); assert.equal(h.$('#activityMirrorToggle').attributes['aria-busy'], 'false');
  assert.equal(h.$('#activityMirrorStatus').textContent, '设置没有保存，请重试。'); assert.equal(reads, 0);
});

test('missing toggle receipt holds a mutation lock until existing projection refresh returns verified current state', async context => {
  const read = deferred(); let writes = 0, reads = 0;
  const h = harness(context, undefined, { updateSettings: async () => { writes++; return undefined; }, refresh: () => { reads++; return read.promise; } });
  await h.$('#activityMirrorToggle').emit('click'); await settle();
  assert.equal(h.$('#activityMirrorToggle').disabled, true); assert.equal(h.$('#activityMirrorToggle').attributes['aria-busy'], 'true');
  assert.match(h.$('#activityMirrorStatus').textContent, /暂未确认/); await h.$('#activityMirrorToggle').emit('click');
  assert.equal(writes, 1); assert.equal(reads, 1);
  h.state.settings.activityMirrorEnabled = false; h.state.activityMirror.enabled = false; h.state.revision++;
  read.resolve(h.state); await settle();
  assert.equal(h.$('#activityMirrorToggle').disabled, false); assert.equal(h.$('#activityMirrorToggle').attributes['aria-busy'], 'false');
  assert.equal(h.$('#activityMirrorToggle').textContent, '关'); assert.equal(h.$('#activityMirrorStatus').hidden, true);
});

test('transport or malformed readback stays unknown and reopening retries only the read', async context => {
  let writes = 0, reads = 0, valid = false;
  const h = harness(context, undefined, { updateSettings: async () => { writes++; throw Error('lost receipt'); }, refresh: async () => { reads++; if (reads === 2) throw Error('read unavailable'); return valid ? h.state : { revision: 3, settings: { activityMirrorEnabled: 'yes' } }; } });
  await h.$('#activityMirrorToggle').emit('click'); await settle();
  assert.equal(h.$('#activityMirrorToggle').disabled, true); assert.equal(h.$('#activityMirrorToggle').attributes['aria-busy'], 'false');
  assert.match(h.$('#activityMirrorStatus').textContent, /暂未确认/);
  h.$('#settingGroupSensory').open = true; await h.$('#settingGroupSensory').emit('toggle'); await settle();
  assert.equal(h.$('#activityMirrorToggle').disabled, true);
  valid = true; await h.$('#settingGroupSensory').emit('toggle'); await settle();
  assert.equal(writes, 1); assert.equal(reads, 3); assert.equal(h.$('#activityMirrorToggle').disabled, false);
});

test('a prior-lifetime read cannot unlock a remounted toggle and a pending write is never replayed', async context => {
  const write = deferred(), oldRead = deferred(), freshRead = deferred(); let writes = 0, reads = 0;
  const h = harness(context, undefined, { updateSettings: () => { writes++; return write.promise; }, refresh: () => ++reads === 1 ? oldRead.promise : freshRead.promise });
  await h.$('#activityMirrorToggle').emit('click'); h.feature.dispose(); h.feature.mount(h.store);
  await h.$('#activityMirrorToggle').emit('click'); assert.equal(writes, 1); assert.equal(reads, 0);
  write.resolve({ ok: true }); await settle(); assert.equal(reads, 1);
  h.feature.dispose(); h.feature.mount(h.store); oldRead.resolve(h.state); await settle();
  assert.equal(h.$('#activityMirrorToggle').disabled, true); assert.equal(reads, 2);
  freshRead.resolve(h.state); await settle(); assert.equal(h.$('#activityMirrorToggle').disabled, false); assert.equal(writes, 1);
});
