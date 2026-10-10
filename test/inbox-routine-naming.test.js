'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPTURE_TRIAGE_TASK, validateCaptureTriageResult } = require('../src/core/llm/tasks');
const { routineTitleOf, routineTitleSource, describeTriage } = require('../src/surfaces/popover/features/inbox-triage.mjs');
const { impulseInbox: { annotateImpulseTriage } } = require('../src/capabilities/work');
const base = { category: 'log', confidence: 92, title: '兵力填报', routineKind: 'custom', level: null, reason: '记录已发生的事' };
const capture = { id: 'i1', text: '我刚刚完成了兵力填报', createdAt: 1000, triage: base };

test('the existing triage response preserves a log activity name and accepts older null names', () => {
  assert.equal(validateCaptureTriageResult(base).title, '兵力填报');
  assert.equal(validateCaptureTriageResult({ ...base, title: null }).title, null);
  assert.equal(validateCaptureTriageResult({ ...base, title: '   ' }).title, null);
  assert.throws(() => validateCaptureTriageResult({ ...base, title: 'x'.repeat(81) }), /title/);
  assert.equal(validateCaptureTriageResult({ ...base, category: 'feeling' }).title, null);
  assert.deepEqual(CAPTURE_TRIAGE_TASK.buildInput({ impulseText: capture.text, routines: ['never send'] }), { impulseText: capture.text });
  const state = { impulses: [{ ...capture, triage: undefined }] };
  const result = annotateImpulseTriage(state, { impulseId: 'i1', expectedText: capture.text, triage: { ...validateCaptureTriageResult(base), at: 2000 } });
  assert.equal(result.ok, true);
  assert.equal(routineTitleOf(state.impulses[0]), '兵力填报');
  assert.equal(state.impulses[0].text, capture.text);
});

test('edited titles including empty strings survive model suggestions, kind and target changes', () => {
  assert.equal(routineTitleOf(capture), '兵力填报');
  assert.equal(routineTitleSource(capture), 'ai');
  for (const patch of [{}, { routineKind: 'meeting' }, { routineId: 'new' }, { routineId: 'r1' }]) {
    assert.equal(routineTitleOf(capture, { ...patch, title: '我的名称' }), '我的名称');
    assert.equal(routineTitleOf(capture, { ...patch, title: '' }), '');
    assert.equal(routineTitleSource(capture, { ...patch, title: '' }), 'edited');
  }
  assert.equal(routineTitleOf(capture, { routineKind: 'meeting' }), capture.text);
  assert.equal(routineTitleSource(capture, { routineKind: 'meeting' }), 'capture');
});

test('missing AI names use original language without fabricated category labels or semantic stripping', () => {
  for (const text of ['我刚刚完成了兵力填报', 'I just finished the deployment', 'أكملت إعداد التقرير', '報告書の提出が終わった', 'J’ai terminé le rapport']) {
    const item = { ...capture, text, triage: { ...base, title: null } };
    assert.equal(routineTitleOf(item), text);
    assert.equal(routineTitleSource(item), 'capture');
  }
  assert.equal(routineTitleOf({ ...capture, triage: null }), capture.text);
  assert.equal(routineTitleOf({ ...capture, text: 'x'.repeat(39) + '📝', triage: null }), 'x'.repeat(39));
});

test('description follows an explicit new target and never implies automatic reminders', () => {
  const state = { routines: { items: [{ id: 'r1', kind: 'custom', title: '洗衣服', active: true }] } };
  assert.equal(describeTriage(capture, state).text, '选择要记录的日常');
  const existing = describeTriage(capture, state, { routineId: 'r1' });
  assert.equal(existing.text, '记录到「洗衣服」');
  assert.equal(existing.action.label, '记录一次');
  const creating = describeTriage(capture, state, { routineId: 'new' });
  assert.equal(creating.action.label, '创建并记一次');
  assert.equal(creating.hint, '仅手动记录');
  assert.match(creating.text, /兵力填报/);
  assert.equal(describeTriage(capture, state, { category: 'routine', routineKind: 'custom' }).hint, '提醒需另行设置');
});
