'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveClassification, describeTriage } = require('../src/surfaces/popover/features/inbox-triage.mjs');
const { inboxCard, missingField, repaintInboxCard } = require('../src/surfaces/popover/features/inbox-card.mjs');

const escapeHTML = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const state = { routines: { items: [{ id: 'r1', kind: 'meal', title: '午餐', active: true }, { id: 'r2', kind: 'meal', title: '晚餐', active: true }] } };

test('a draft label overlays the stored one without writing it', () => {
  const impulse = { id: 'i1', text: '吃完了', createdAt: 1, triage: { category: 'log', routineKind: 'meal' }, classification: null };
  assert.deepEqual(effectiveClassification(impulse, {}), { category: 'log', routineKind: 'meal', level: null });
  assert.deepEqual(effectiveClassification(impulse, { category: 'state', level: 35 }), { category: 'state', routineKind: null, level: 35 });
  assert.deepEqual(effectiveClassification(impulse, { routineKind: 'snack' }), { category: 'log', routineKind: 'snack', level: null });
  assert.equal(describeTriage(impulse, state, { category: 'feeling' }).action.kind, 'feeling');
});

test('an unclassified capture offers one-tap picks and keeps it as the low-effort default', () => {
  const html = inboxCard({ id: 'i1', text: '睡觉睡觉', createdAt: 1, classification: null }, state, escapeHTML, undefined);
  assert.match(html, /data-inbox-pick="task"/);
  assert.match(html, /data-inbox-action="keep">先留存</);
  assert.doesNotMatch(html, /留在历史/);
  assert.match(html, /待分类/);
  const picked = inboxCard({ id: 'i1', text: '睡觉睡觉', createdAt: 1, classification: null }, state, escapeHTML, { category: 'note' });
  assert.doesNotMatch(picked, /data-inbox-pick=/);
  assert.match(picked, /未保存/);
});

test('routine inputs stay visible and an ambiguous destination blocks commit', () => {
  assert.equal(missingField({ category: 'log', routineKind: 'meal' }, { matching: state.routines.items, destination: '', title: '' }), 'routine');
  assert.equal(missingField({ category: 'log', routineKind: 'meal' }, { matching: state.routines.items, destination: 'r1', title: '' }), null);
  assert.equal(missingField({ category: 'routine', routineKind: null }, { matching: [], destination: '', title: 'x' }), 'kind');
  assert.equal(missingField({ category: 'state', level: null }, {}), 'level');
  const complete = inboxCard({ id: 'i1', text: '吃完了', createdAt: 1, classification: { category: 'log', routineKind: 'meal', level: null } },
    { routines: { items: [state.routines.items[0]] } }, escapeHTML, undefined);
  assert.match(complete, /<div class="inbox-details" data-missing="">/);
  const ambiguous = inboxCard({ id: 'i1', text: '吃完了', createdAt: 1, classification: { category: 'log', routineKind: 'meal', level: null } }, state, escapeHTML, undefined);
  assert.match(ambiguous, /data-missing="routine"/);
  assert.match(ambiguous, /data-inbox-needs-choice disabled/);
  assert.doesNotMatch(ambiguous, /日常设置|<details class="inbox-details"/);
});

test('retained feeling sources offer explicit associated-source deletion only for a valid missing target', () => {
  const impulse = { id: 'i', text: 'Synthetic source', createdAt: 1,
    resolution: { action: 'feeling', category: 'feeling', targetId: 'm' } };
  const html = inboxCard(impulse, { ...state, moodNotes: [] }, escapeHTML);
  assert.match(html, /来源记录仍保留/);
  assert.match(html, /data-inbox-action="delete-mood-source"/);
  assert.match(html, /删除关联来源/);
  for (const targetId of [null, '', '   ', 'x'.repeat(65)]) {
    assert.doesNotMatch(inboxCard({ ...impulse, resolution: { ...impulse.resolution, targetId } }, state, escapeHTML), /delete-mood-source/);
  }
  assert.doesNotMatch(inboxCard(impulse, { ...state, moodNotes: [{ id: 'm' }] }, escapeHTML), /delete-mood-source|来源记录仍保留/);
  assert.doesNotMatch(inboxCard({ ...impulse, resolution: { ...impulse.resolution, action: 'keep' } }, state, escapeHTML), /delete-mood-source/);
});


test('history has a compact header action panel and no expandable action footer', () => {
  const html = inboxCard({ id: 'i', text: 'Recorded something', createdAt: 1,
    resolution: { action: 'log', category: 'log', targetId: 'r1' } }, state, escapeHTML);
  assert.match(html, /<time[^>]*>[^<]*<\/time><details class="inbox-options">/);
  assert.doesNotMatch(html, /inbox-card-actions|inbox-history-actions|inbox-details/);
  assert.equal((html.match(/data-inbox-action="delete"/g) || []).length, 1);
});

test('a sole custom routine requires an explicit destination while new title drafts survive', () => {
  const item = { id: 'i', text: '完成填报', createdAt: 1, triage: { category: 'log', routineKind: 'custom', title: '填报' } };
  const custom = { routines: { items: [{ id: 'other', kind: 'custom', title: '浇花', active: true }] } };
  const html = inboxCard(item, custom, escapeHTML);
  assert.match(html, /<option value="" selected/);
  assert.match(html, /data-inbox-needs-choice disabled/);
  const selected = inboxCard(item, custom, escapeHTML, { routineId: 'new', title: '工作填报' });
  assert.match(selected, /value="工作填报"/);
  assert.doesNotMatch(selected, /data-inbox-needs-choice/);
  assert.doesNotMatch(selected, /日常设置|创建「其他日常」/);
});


test('only the generated routine name carries one compact AI tag', () => {
  for (const category of ['log', 'routine']) {
    const item = { id: 'i', text: '我刚刚完成了兵力填报', createdAt: 1,
      triage: { category, routineKind: 'custom', title: '兵力填报' } };
    const html = inboxCard(item, { routines: { items: [] } }, escapeHTML);
    assert.match(html, /<span class="inbox-source"><\/span>/);
    assert.equal((html.match(/class="inbox-ai-tag"/g) || []).length, 1);
    assert.match(html, /class="inbox-ai-tag"[^>]*(?<!hidden)>AI<\/span>/);
    assert.doesNotMatch(html, /日常名称 · AI 建议|<span class="inbox-source">AI 建议/);
    assert.match(html, /<p class="impulse-text">我刚刚完成了兵力填报<\/p>/);
  }
});

test('edited, empty, missing and mismatched AI names never receive a visible AI tag', () => {
  const item = { id: 'i', text: '我刚刚完成了兵力填报', createdAt: 1,
    triage: { category: 'log', routineKind: 'custom', title: '兵力填报' } };
  for (const [source, draft] of [
    [item, { title: '我的填报' }], [item, { title: '' }], [item, { title: '兵力填报' }],
    [item, { routineKind: 'meeting' }], [{ ...item, triage: { ...item.triage, title: null } }, {}],
    [{ ...item, triage: null, classification: { category: 'log', routineKind: 'custom' } }, {}]
  ]) {
    const html = inboxCard(source, state, escapeHTML, draft);
    assert.match(html, /class="inbox-ai-tag"[^>]* hidden>AI/);
    assert.doesNotMatch(html, /<span class="inbox-source">AI 建议/);
  }
  const fallback = inboxCard({ ...item, triage: { ...item.triage, title: null } }, state, escapeHTML);
  assert.match(fallback, /value="我刚刚完成了兵力填报"/);
});

test('live edit and locale repaint preserve draft provenance without replacing the input', () => {
  const { setLocale, getLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  const previous = getLocale();
  const item = { id: 'i', text: '原文', createdAt: 1,
    triage: { category: 'log', routineKind: 'custom', title: '填报' } };
  const attributes = {};
  const tag = { hidden: false, setAttribute(name, value) { attributes[name] = value; } };
  const nodes = { '.inbox-title-text': {}, '.inbox-source': {}, '.inbox-ai-tag': tag };
  const row = { querySelector: selector => nodes[selector] };
  try {
    for (const locale of ['zh-CN', 'en']) {
      setLocale(locale);
      repaintInboxCard(row, item, state, {});
      assert.equal(tag.hidden, false);
      assert.equal(nodes['.inbox-source'].textContent, '');
      assert.equal(attributes['aria-label'], locale === 'en' ? 'Name suggested by AI' : 'AI 建议的名称');
      for (const title of ['我的填报', '', '填报']) {
        repaintInboxCard(row, item, state, { title });
        assert.equal(tag.hidden, true);
        const rebuilt = inboxCard(item, state, escapeHTML, { title, routineId: 'new' });
        assert.match(rebuilt, /class="inbox-ai-tag"[^>]* hidden>AI/);
      }
    }
  } finally { setLocale(previous); }
});

test('runtime triage feedback stays compact with focus, tap and hover help rather than title-only errors', () => {
  const labels = { running: '分类中', skipped: '未启用', uncertain: '未确定', failed: '分类失败', interrupted: '已停止', unknown: '待分类' };
  for (const [status, label] of Object.entries(labels)) {
    const item = { id: 'synthetic-status', text: 'Synthetic capture', createdAt: 1,
      triageStatus: { state: status, reason: 'provider-timeout' } };
    const html = inboxCard(item, state, escapeHTML, {});
    assert.match(html, new RegExp(`class="inbox-source-label">${label}<`));
    assert.match(html, /<details class="inline-help inbox-triage-help"><summary aria-label="分拣状态说明"/);
    assert.doesNotMatch(html, /data-inbox-action="retry"|本地模板|本地回复/);
    const draft = inboxCard(item, state, escapeHTML, { category: 'feeling' });
    assert.match(draft, /未保存/); assert.doesNotMatch(draft, /inbox-triage-help/);
    const confirmed = inboxCard({ ...item, classification: { category: 'note' } }, state, escapeHTML);
    assert.match(confirmed, /已确认/); assert.doesNotMatch(confirmed, /inbox-triage-help/);
  }
});

test('status details are localized authored copy and never render raw error payloads', () => {
  const { triageFeedback } = require('../src/surfaces/popover/features/inbox-triage-feedback.mjs');
  const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  const item = { id: 'synthetic-status', text: 'Synthetic capture', createdAt: 1,
    triageStatus: { state: 'failed', reason: 'https://private.invalid/SYNTHETIC_SECRET' } };
  assert.equal(triageFeedback(item).detail, '本次分类未成功，可检查 AI 设置或手动选择类型。');
  assert.doesNotMatch(inboxCard(item, state, escapeHTML), /private.invalid|SYNTHETIC_SECRET/);
  const label = {}, detail = { dataset: {} }, summary = { setAttribute(name, value) { this[name] = value; } }, source = {};
  const nodes = { '.inbox-source': source, '.inbox-source-label': label, '.inbox-triage-help p': detail, '.inbox-triage-help summary': summary };
  const row = { querySelector: name => nodes[name] || null };
  try {
    setLocale('en'); repaintInboxCard(row, item, state, {});
    assert.equal(label.textContent, 'Classification failed');
    assert.equal(summary['aria-label'], 'Classification status details');
    assert.equal(detail.dataset.i18n, triageFeedback(item).detail);
    assert.match(detail.textContent, /Classification did not succeed/);
    assert.equal(source.textContent, undefined, 'locale repaint does not replace the help owner or focused summary');
  } finally { setLocale('zh-CN'); }
});
