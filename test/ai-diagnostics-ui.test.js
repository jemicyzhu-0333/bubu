'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiDiagnostics } = require('../src/surfaces/popover/features/ai-diagnostics.mjs');
const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function element(tag = 'div', writes = null) {
  const listeners = new Map(); let text = '';
  return {
    tagName: tag.toUpperCase(), children: [], value: '', hidden: false, open: false, disabled: false,
    focusCount: 0, selectCount: 0, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { text = String(value); writes?.push(text); this.children = []; },
    set innerHTML(_) { throw Error('HTML injection sink forbidden'); },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { text = ''; this.children = items; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for (const fn of listeners.get(type) || []) fn({ target: this, currentTarget: this }); },
    focus() { this.focusCount++; }, select() { this.selectCount++; }
  };
}
function fixture(extra = {}, initial = {}) {
  const nodes = new Map(), calls = [], timers = new Map(), timerDelays = new Map(), writes = [];
  let timerId = 0, visible = true, onHidden, clock = 100;
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const document = Object.assign(element('document'), { hidden: false, createElement: tag => element(tag, writes), createElementNS: (_namespace, tag) => element(tag, writes) });
  let state = { ok: true, available: true, active: false, epoch: 0, count: 0, expiresAt: null, ...initial };
  let records = [];
  const client = {
    diagnosticsStatus: async () => ({ ...state }),
    diagnosticsList: async () => ({ ...state, records }),
    diagnosticsDetail: async ({ id }) => ({ ...state, record: { ...records.find(item => item.id === id), events: [], truncated: false } }),
    diagnosticsStart: async () => { state = { ...state, active: true, epoch: state.epoch + 1, expiresAt: 1_800_000 }; return { ...state }; },
    diagnosticsStop: async () => { records = []; state = { ...state, active: false, epoch: state.epoch + 1, count: 0, expiresAt: null }; return { ...state }; },
    diagnosticsClear: async () => { records = []; state = { ...state, epoch: state.epoch + 1, count: 0 }; return { ...state }; },
    diagnosticsExport: async () => ({ ok: true, text: '{"version":1,"count":1}' }),
    onPopoverHidden: listener => { onHidden = listener; return () => { onHidden = null; }; }, ...extra
  };
  for (const name of Object.keys(client).filter(name => name.startsWith('diagnostics'))) {
    const fn = client[name]; client[name] = (...args) => { calls.push([name, ...args]); return fn(...args); };
  }
  const feature = createAiDiagnostics({ document, $, surfaceClient: client, isVisible: () => visible, now: () => clock,
    setTimer: (fn, delay) => { timers.set(++timerId, fn); timerDelays.set(timerId, delay); return timerId; },
    clearTimer: id => { timers.delete(id); timerDelays.delete(id); } });
  $('#settingGroupAi').open = true;
  feature.mount();
  return { $, document, feature, client, timers, timerDelays, writes, calls, hidden: () => onHidden?.(),
    setClock(value) { clock = value; },
    setVisible(value) { visible = value; },
    setState(patch) { state = { ...state, ...patch }; },
    setRecords(items) { records = items; state.count = items.length; },
    async open() { $('#aiDiagnosticsGroup').open = true; $('#aiDiagnosticsGroup').emit('toggle'); await settle(); },
    async select(id) { $('#aiDiagnosticsRuns').value = id; $('#aiDiagnosticsRuns').emit('change'); await settle(); },
    async click(name) { $(`#aiDiagnostics${name}`).emit('click'); await settle(); }
  };
}
const sample = { id: 'run-1', task: 'capture-triage', startedAt: 100, endedAt: 110, state: 'finished', outcome: { code: 'applied', changed: true } };

test('production gate stays hidden and no read or start enables recording', async context => {
  const h = fixture({}, { available: false }); context.after(() => h.feature.dispose());
  await settle(); await h.open(); await h.click('Start');
  assert.equal(h.$('#aiDiagnosticsGroup').hidden, true);
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStart').length, 0);
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsList').length, 0);
  assert.equal(h.timers.size, 0);
});

test('test entry is default off; capture requires one explicit start and only visible inspector polls', async context => {
  const h = fixture(); context.after(() => h.feature.dispose()); await settle();
  assert.equal(h.$('#aiDiagnosticsGroup').hidden, false);
  assert.equal(h.$('#aiDiagnosticsStatus').textContent, '未开启记录');
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStart').length, 0);
  assert.equal(h.timers.size, 0);
  await h.open(); assert.equal(h.timers.size, 1);
  await h.click('Start');
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStart').length, 1);
  assert.equal(h.$('#aiDiagnosticsStart').disabled, true);
  assert.equal(h.$('#aiDiagnosticsStop').disabled, false);
  h.feature.dismiss(); assert.equal(h.timers.size, 0);
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStop').length, 0);
});

test('provider text and all recorded stages render as literal text; locale switch preserves content', async context => {
  const text = '<img src=x onerror=alert(1)>关 & 私密原文';
  const events = [
    { phase: 'output', at: 101, data: { text } },
    { phase: 'repaired', at: 102, data: { value: { category: 'state' } } },
    { phase: 'validated', at: 103, data: { value: { confidence: 0.5 } } },
    { phase: 'rejected', at: 104, data: { code: 'invalid-output', field: 'confidence' } },
    { phase: 'gate', at: 105, data: { confidence: 0.5, minimum: 0.8, accepted: false, code: 'low-confidence' } },
    { phase: 'application', at: 106, data: { code: 'not-applied', changed: false } }
  ];
  const h = fixture({ diagnosticsDetail: async () => ({ ok: true, epoch: 1, record: { ...sample, events, truncated: true } }) }, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => { h.feature.dispose(); setLocale('zh-CN'); });
  h.setRecords([sample]); await h.open(); await h.select(sample.id);
  const content = h.$('#aiDiagnosticsDetail').textContent;
  for (const phrase of [text, '服务商返回原文', '格式修复候选', '已通过结构校验', '校验未通过', '应用前检查', '最终应用结果', '部分内容未保留']) assert.ok(content.includes(phrase), phrase);
  setLocale('en');
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes(text));
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes('Original provider reply'));
  assert.equal(h.$('#aiDiagnosticsRuns').value, sample.id);
});

test('stop is single-flight and invalidates delayed detail before its response', async context => {
  const detail = deferred(), stop = deferred();
  const h = fixture({ diagnosticsDetail: () => detail.promise, diagnosticsStop: () => stop.promise }, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open(); await h.select(sample.id);
  h.$('#aiDiagnosticsStop').emit('click'); h.$('#aiDiagnosticsStop').emit('click');
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStop').length, 1);
  detail.resolve({ ok: true, epoch: 1, record: { ...sample, events: [{ phase: 'output', data: { text: 'late private' } }] } });
  h.setState({ active: false, epoch: 2, count: 0, expiresAt: null }); h.setRecords([]);
  stop.resolve({ ok: true, available: true, active: false, epoch: 2, count: 0, expiresAt: null }); await settle();
  assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  assert.equal(h.$('#aiDiagnosticsRuns').value, '');
  assert.equal(h.$('#aiDiagnosticsFeedback').textContent, '记录已停止并清除。');
});

test('clear and expiry erase displayed data and an older epoch cannot restore it', async context => {
  const h = fixture({}, { active: true, epoch: 1, expiresAt: 1_800_000 }); context.after(() => h.feature.dispose());
  h.setRecords([sample]); await h.open(); await h.select(sample.id);
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes(sample.id));
  await h.click('Clear'); assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  assert.match(h.$('#aiDiagnosticsStatus').textContent, /记录中/);
  h.setRecords([sample]); await h.feature.refresh(); await h.select(sample.id);
  h.setState({ active: false, epoch: 3, expiresAt: null }); h.setRecords([]);
  await h.feature.refresh(); assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  h.setState({ active: true, epoch: 1, count: 1 }); h.setRecords([sample]);
  await h.feature.refresh(); assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  assert.equal(h.$('#aiDiagnosticsStatus').textContent, '未开启记录');
});

test('hidden window erases local body and export; late responses do not reopen or repopulate it', async context => {
  const detail = deferred();
  const h = fixture({ diagnosticsDetail: () => detail.promise }, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open(); await h.select(sample.id);
  h.hidden(); detail.resolve({ ok: true, epoch: 1, record: { ...sample, events: [{ phase: 'output', data: { text: 'secret' } }] } }); await settle();
  assert.equal(h.$('#aiDiagnosticsGroup').open, false);
  assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  assert.equal(h.$('#aiDiagnosticsExportText').value, ''); assert.equal(h.timers.size, 0);
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStop').length, 0);
});

test('export is user-initiated and uses only main-process sanitized summary', async context => {
  const h = fixture({}, { active: true, epoch: 1, expiresAt: 1_800_000 }); context.after(() => h.feature.dispose());
  h.setRecords([sample]); await h.open(); await h.select(sample.id);
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsExport').length, 0);
  await h.click('Export');
  assert.equal(h.$('#aiDiagnosticsExportText').value, '{"version":1,"count":1}');
  assert.equal(h.$('#aiDiagnosticsExportText').selectCount, 1);
  assert.equal(h.$('#aiDiagnosticsExportPanel').hidden, false);
  h.feature.dismiss(); assert.equal(h.$('#aiDiagnosticsExportText').value, '');
});

test('expired or dismissed export is never displayed; rejected actions show closed safe error text', async context => {
  const pending = deferred();
  const h = fixture({ diagnosticsExport: () => pending.promise }, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open();
  h.$('#aiDiagnosticsExport').emit('click'); h.setState({ active: false, epoch: 2, count: 0, expiresAt: null }); h.setRecords([]);
  pending.resolve({ ok: true, text: '{"old":true}' }); await settle();
  assert.equal(h.$('#aiDiagnosticsExportText').value, '');
  h.client.diagnosticsStart = async () => { throw Error('raw secret'); };
  await h.click('Start');
  assert.equal(h.$('#aiDiagnosticsFeedback').textContent, '操作结果暂未确认，可刷新核对。');
  assert.ok(!h.$('#aiDiagnosticsFeedback').textContent.includes('raw secret'));
});

test('redaction, truncation and energy contribution use factual bounded wording', async context => {
  const h = fixture({ diagnosticsDetail: async () => ({ ok: true, epoch: 1, record: {
    ...sample, redacted: true, truncated: true, events: [
      { phase: 'energy', at: 120, data: { recordedDelta: 8, effectiveContribution: null, sampledAt: null, code: 'energy-signal-recorded' } }
    ]
  } }) }, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open(); await h.select(sample.id);
  const content = h.$('#aiDiagnosticsDetail').textContent;
  for (const phrase of ['已遮罩可识别凭据', '记录已截断', '当时已记录能量信号', '未记录实际贡献']) assert.ok(content.includes(phrase), phrase);
  assert.doesNotMatch(content, /完全脱敏|匿名|实际贡献.*8/);
});

test('unchanged polling keeps provider text nodes stable for reading and selection', async context => {
  const h = fixture({}, { active: true, epoch: 1, expiresAt: 1_800_000 }); context.after(() => h.feature.dispose());
  h.setRecords([sample]); await h.open(); await h.select(sample.id);
  const first = h.$('#aiDiagnosticsDetail').children[0];
  await h.feature.refresh();
  assert.equal(h.$('#aiDiagnosticsDetail').children[0], first);
});

test('the real recorder envelopes support start, inspect, export, missing records and stop through the UI', async context => {
  const { aiDiagnostics } = require('../src/capabilities/guidance');
  let at = 100;
  const recorder = aiDiagnostics.createAiDiagnostics({ available: true, now: () => at, schedule: () => 1, cancelSchedule() {} });
  const h = fixture({ diagnosticsStatus: recorder.status, diagnosticsStart: recorder.start,
    diagnosticsStop: recorder.stop, diagnosticsList: recorder.list, diagnosticsDetail: recorder.detail,
    diagnosticsClear: recorder.clear, diagnosticsExport: recorder.exportMetadata });
  context.after(() => { h.feature.dispose(); recorder.dispose(); });
  await h.open(); await h.click('Start');
  const run = recorder.begin('capture-triage');
  run.observe('output', { text: 'private synthetic response' });
  run.observe('gate', { code: 'low-confidence', accepted: false, confidence: 0.5, minimum: 0.8 });
  run.finish('not-applied', false);
  await h.feature.refresh(); await h.select(recorder.list().records[0].id);
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes('private synthetic response'));
  await h.click('Export');
  assert.ok(h.$('#aiDiagnosticsExportText').value.includes('low-confidence'));
  assert.ok(!h.$('#aiDiagnosticsExportText').value.includes('private synthetic response'));
  await h.select(recorder.list().records[0].id);
  recorder.clear(); await h.select('run-1');
  assert.equal(h.$('#aiDiagnosticsFeedback').textContent, '这次请求的记录已不可用。');
  at += 30 * 60 * 1000;
  await h.feature.refresh();
  assert.equal(h.$('#aiDiagnosticsStatus').textContent, '未开启记录');
  assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  await h.click('Start'); await h.click('Stop');
  assert.equal(recorder.status().active, false);
});

test('source changes invalidate old content and retain a clearly labelled historical command receipt', async context => {
  const { aiDiagnostics } = require('../src/capabilities/guidance');
  let current = true;
  const recorder = aiDiagnostics.createAiDiagnostics({ available: true, now: () => 100, schedule: () => 1,
    cancelSchedule() {}, isSourceCurrent: () => current });
  const h = fixture({ diagnosticsStatus: recorder.status, diagnosticsStart: recorder.start,
    diagnosticsStop: recorder.stop, diagnosticsList: recorder.list, diagnosticsDetail: recorder.detail,
    diagnosticsClear: recorder.clear, diagnosticsExport: recorder.exportMetadata });
  context.after(() => { h.feature.dispose(); recorder.dispose(); setLocale('zh-CN'); });
  await h.open(); await h.click('Start');
  const run = recorder.begin('enrich', { kind: 'task', id: 'synthetic-task', fingerprint: 'before' });
  run.observe('output', { text: 'source-linked private content' });
  run.observe('repaired', { value: { text: 'repaired private content' } });
  run.observe('validated', { value: { text: 'validated private content' } });
  run.finish('proposal-command-succeeded', null);
  const id = recorder.list().records[0].id;
  await h.feature.refresh(); await h.select(id);
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes('source-linked private content'));
  current = false;
  await h.feature.refresh();
  assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  await h.select(id);
  const content = h.$('#aiDiagnosticsDetail').textContent;
  assert.ok(content.includes('来源已变化，原文记录已清除'));
  assert.ok(content.includes('提案命令已完成，实际变化未记录'));
  assert.doesNotMatch(content, /private content/);
  assert.equal(recorder.detail({ id }).record.outcome.changed, null);
  setLocale('en');
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes('The source changed. Original content records were cleared'));
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes('The proposal command completed. Actual changes were not recorded'));
});

test('the entry explicitly limits scope and empty-state copy never implies all AI is recorded', async context => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  const entry = html.slice(html.indexOf('id="aiDiagnosticsGroup"'), html.indexOf('<!-- 长期记忆'));
  const disclosure = '记录范围：随手记分拣、能量判断、任务拆解/补全和卡点建议。聊天与协作暂不在记录范围。';
  assert.ok(entry.includes(`data-i18n="${disclosure}"`));
  const { t } = require('../src/surfaces/shared/interface/i18n.mjs');
  const h = fixture(); context.after(() => { h.feature.dispose(); setLocale('zh-CN'); });
  await h.open();
  assert.equal(h.$('#aiDiagnosticsEmpty').textContent, '开始记录后，上述范围内的新请求才会出现在这里。');
  await h.click('Start');
  assert.equal(h.$('#aiDiagnosticsEmpty').textContent, '尚无记录。开启后发生的上述请求会显示在这里。');
  setLocale('en');
  assert.match(t(disclosure), /Chat and collaboration are not currently recorded\./);
  assert.equal(h.$('#aiDiagnosticsEmpty').textContent, 'No records yet. Requests in the scope above will appear here while recording.');
});

for (const change of ['expiry', 'source-invalidation']) {
  for (const operation of ['selection', 'auto-refresh']) {
    test(`a delayed ${operation} detail cannot flash content after unseen ${change}`, async context => {
      const pending = deferred();
      const h = fixture({}, { active: true, epoch: 1, expiresAt: 1_800_000 });
      context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open();
      if (operation === 'auto-refresh') await h.select(sample.id);
      h.client.diagnosticsDetail = () => pending.promise;
      if (operation === 'selection') {
        h.$('#aiDiagnosticsRuns').value = sample.id;
        h.$('#aiDiagnosticsRuns').emit('change');
      } else void h.feature.refresh();
      await settle();
      h.setState({ epoch: 2, active: change !== 'expiry', expiresAt: change === 'expiry' ? null : 1_800_000 });
      if (change === 'expiry') h.setRecords([]);
      pending.resolve({ ok: true, available: true, active: true, epoch: 1, expiresAt: 1_800_000,
        record: { ...sample, events: [{ phase: 'output', at: 100, data: { text: 'EXPIRED_SYNTHETIC_PRIVATE' } }] } });
      await settle();
      assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
      assert.ok(h.writes.every(text => !text.includes('EXPIRED_SYNTHETIC_PRIVATE')), 'stale body must never reach a text node');
      assert.equal(h.$('#aiDiagnosticsRuns').value, '');
    });
  }
}

test('independent display expiry erases body and export even when a refresh never resolves', async context => {
  const h = fixture({}, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open();
  await h.click('Export'); await h.select(sample.id);
  assert.ok(h.$('#aiDiagnosticsDetail').textContent.includes(sample.id));
  assert.ok(h.$('#aiDiagnosticsExportText').value);
  h.client.diagnosticsStatus = () => new Promise(() => {});
  void h.feature.refresh();
  assert.equal(h.timers.size, 1, 'poll wait must not remove the independent expiry timer');
  const [timer, callback] = [...h.timers.entries()][0];
  assert.equal(h.timerDelays.get(timer), 1_799_900);
  h.setClock(1_800_000); callback();
  assert.equal(h.$('#aiDiagnosticsDetail').textContent, '');
  assert.equal(h.$('#aiDiagnosticsExportText').value, '');
  assert.equal(h.$('#aiDiagnosticsExportPanel').hidden, true);
  assert.equal(h.$('#aiDiagnosticsStatus').textContent, '未开启记录');
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.filter(([name]) => name === 'diagnosticsStop').length, 0, 'display expiry does not send a business command');
});

test('compact controls show one primary action and localize request names without dropdown outcomes', async context => {
  const h = fixture(); context.after(() => { h.feature.dispose(); setLocale('zh-CN'); });
  await h.open();
  assert.equal(h.$('#aiDiagnosticsStart').hidden, false);
  assert.equal(h.$('#aiDiagnosticsStop').hidden, true);
  assert.equal(h.$('#aiDiagnosticsRisk').hidden, false);
  await h.click('Start'); h.setRecords([{ ...sample, outcome: { code: 'proposal-command-succeeded', changed: null } }]);
  await h.feature.refresh();
  assert.equal(h.$('#aiDiagnosticsStart').hidden, true);
  assert.equal(h.$('#aiDiagnosticsStop').hidden, false);
  const time = new Date(sample.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  assert.equal(h.$('#aiDiagnosticsRuns').children[1].textContent, `${time} · 随手记分拣`);
  assert.doesNotMatch(h.$('#aiDiagnosticsRuns').textContent, /capture-triage|proposal-command-succeeded/);
  setLocale('en');
  assert.equal(h.$('#aiDiagnosticsRuns').children[1].textContent, `${time} · Quick-note classification`);
});

test('provider reply is shown before a default-collapsed metadata and validation disclosure', async context => {
  const h = fixture({ diagnosticsDetail: async () => ({ ok: true, epoch: 1, record: { ...sample, events: [
    { phase: 'attempt', at: 100, data: { attempt: 1 } },
    { phase: 'output', at: 101, data: { text: 'VISIBLE_SYNTHETIC_REPLY' } },
    { phase: 'validated', at: 102, data: { value: { confidence: 0.9 } } }
  ] } }) }, { active: true, epoch: 1, expiresAt: 1_800_000 });
  context.after(() => h.feature.dispose()); h.setRecords([sample]); await h.open(); await h.select(sample.id);
  const children = h.$('#aiDiagnosticsDetail').children;
  assert.equal(children[0].tagName, 'SECTION');
  assert.ok(children[0].textContent.includes('VISIBLE_SYNTHETIC_REPLY'));
  assert.equal(children.at(-1).tagName, 'DETAILS');
  assert.equal(children.at(-1).open, false);
  assert.ok(children.at(-1).textContent.includes('capture-triage'));
  assert.ok(children.at(-1).textContent.includes('已通过结构校验'));
});
