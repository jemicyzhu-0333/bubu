'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverMemoryList } = require('../src/surfaces/popover/features/memory-list.mjs');
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const NOW = 1791111600000;
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function memory(overrides = {}) {
  return { id: 'm1', version: 3, kind: 'preference', subject: '工作安排', body: '下午先做简单的事', status: 'active', sourceType: 'user-statement',
    sourceRefs: [{ kind: 'message', id: 'source-message', revision: null }], confirmedAt: NOW - 100, validFrom: NOW - 1000, expiresAt: null,
    scope: 'work', privacyLevel: 'standard', createdAt: NOW - 1000, updatedAt: NOW - 100, lastUsedAt: null, useCount: 0,
    contextAllowed: true, conflictIds: [], ...overrides };
}
function dom() {
  const production = path.join(__dirname, '../src/renderer/popover.html');
  const markup = fs.readFileSync(fs.existsSync(production) ? production : path.join(__dirname, '../fragments/memory-section.html'), 'utf8');
  const nodes = {}, listeners = new Map();
  const make = (id, tag = '') => {
    const classes = new Set(tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) || []);
    const value = { id, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, open: true, dataset: {}, attributes: {}, tabIndex: 0, focused: 0,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); }, removeEventListener(type) { listeners.delete(`${id}:${type}`); },
      setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused++; } };
    nodes[`#${id}`] = value; return value;
  };
  for (const match of markup.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) make(match[1], match[0]);
  for (const id of ['settingGroupAi', 'settingsMask', 'btnSettingsClose', 'btnSettings']) if (!nodes[`#${id}`]) make(id);
  nodes['#settingsMask'].classList.remove('hidden'); nodes['#settingGroupAi'].open = true;
  return { markup, nodes, listeners, $: selector => nodes[selector] || null,
    fire: (id, type, event = {}) => listeners.get(`${id}:${type}`)?.({ currentTarget: nodes[`#${id}`], ...event }) };
}
function harness(initial = [memory()]) {
  const d = dom(), calls = [], previews = new Map(), receipts = new Map();
  let rows = structuredClone(initial), serial = 0, hidden;
  const client = {
    onPopoverHidden(fn) { hidden = fn; return () => { hidden = null; }; },
    async listMemories(args) { calls.push(['list', args]); return { ok: true, availability: 'available', items: structuredClone(rows.filter(row => row.status === args.status)), nextCursor: null }; },
    async previewMemoryChange(args) {
      calls.push(['preview', args]);
      const before = args.targetId ? rows.find(row => row.id === args.targetId) : null;
      if (before && args.expectedVersion !== before.version) return { ok: false, reason: 'memory-version-conflict' };
      const after = args.operation === 'permanent-remove' ? null : args.operation === 'add' ? memory({ ...args.input, id: 'm-new', version: 1, sourceType: 'user-statement' })
        : args.operation === 'update' ? { ...before, ...args.input, version: before.version + 1, sourceType: 'user-edit' }
          : { ...before, status: ({ activate: 'active', pause: 'paused', remove: 'removed', restore: 'paused' })[args.operation], version: before.version + 1 };
      const value = { previewId: `p${++serial}`, previewHash: String(serial % 10).repeat(64), expectedVersion: before?.version || null,
        operation: args.operation, expiresAt: NOW + 300000, before: structuredClone(before), after: structuredClone(after),
        affectedIds: [before?.id || after.id], invalidatedSourceRefs: before?.sourceRefs || [], permanent: args.operation === 'permanent-remove', undoExpiresAt: before && args.operation !== 'permanent-remove' ? NOW + 600000 : null };
      previews.set(value.previewId, value); return { ok: true, preview: structuredClone(value) };
    },
    async confirmMemoryChange(args) {
      calls.push(['confirm', args]);
      const existing = [...receipts.values()].find(value => value.commandId === args.previewId); if (existing) return { ok: true, receipt: structuredClone(existing), replayed: true };
      const p = previews.get(args.previewId);
      if (!p || p.previewHash !== args.previewHash || p.expectedVersion !== args.expectedVersion) return { ok: false, reason: 'memory-preview-conflict' };
      rows = rows.filter(row => row.id !== p.before?.id); if (p.after) rows.push(p.after);
      const value = { version: 1, receiptId: `r${++serial}`, commandId: p.previewId, ownerId: 'owner1', store: 'memory', operation: p.operation,
        memoryId: p.before?.id || p.after.id, beforeVersion: p.expectedVersion, afterVersion: p.after?.version || null, affectedIds: p.affectedIds,
        previewHash: p.previewHash, committedAt: NOW, undoExpiresAt: p.undoExpiresAt, revertsReceiptId: null, permanent: p.permanent, eventId: 'event1' };
      receipts.set(value.receiptId, value); return { ok: true, receipt: structuredClone(value), historyStatus: 'pending' };
    },
    async getMemoryReceipt(args) { calls.push(['receipt', args]); return { ok: true, receipt: structuredClone(receipts.get(args.receiptId)), historyStatus: 'pending' }; },
    async cancelMemoryChange(args) { calls.push(['cancel', args]); previews.delete(args.previewId); return { ok: true }; },
    async previewMemoryUndo(args) {
      calls.push(['undo', args]); const r = receipts.get(args.receiptId), before = rows.find(row => row.id === r.memoryId);
      const value = { previewId: `p${++serial}`, previewHash: 'e'.repeat(64), expectedVersion: before.version, operation: 'undo', before,
        after: memory({ id: before.id, version: before.version + 1 }), affectedIds: [before.id], invalidatedSourceRefs: [], permanent: false, undoExpiresAt: null };
      previews.set(value.previewId, value); return { ok: true, preview: structuredClone(value) };
    },
    async previewMemoryProposal(args) {
      calls.push(['candidate', args]);
      if (args.replacePreviewId) previews.delete(args.replacePreviewId);
      return client.previewMemoryChange({ operation: 'add', expectedVersion: null,
        input: args.input || { kind: 'preference', subject: '聊天建议', body: '仅在工作时适用', scope: 'work', expiresAt: null, privacyLevel: 'standard' } });
    },
    forgetMemory() { assert.fail('no direct destructive route'); }, clearMemories() { assert.fail('no direct clear route'); }, rememberMemory() { assert.fail('no legacy direct write'); }
  };
  const feature = createPopoverMemoryList({ $: d.$, escapeHTML, surfaceClient: client, now: () => NOW }); feature.mount();
  const draft = (values = {}) => {
    feature.edit(); const data = { memoryDraftKind: 'preference', memoryDraftSubject: '新主题', memoryDraftBody: '新内容', memoryDraftScope: 'global', memoryDraftExpiry: '', memoryDraftPrivacy: 'standard', ...values };
    for (const [id, value] of Object.entries(data)) d.$(`#${id}`).value = value;
  };
  return { dom: d, feature, client, calls, previews, receipts, draft, hide: () => hidden?.(), rows: () => rows, setRows: value => { rows = value; },
    status: () => d.$('#memoryStatus').textContent, list: () => d.$('#memoryList').innerHTML, review: () => d.$('#memoryReviewContent').innerHTML };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('opening loads records with essential scope visible and trace details available on demand', async () => {
  const h = harness(); assert.equal(h.calls.length, 0); await h.feature.load();
  assert.deepEqual(h.calls[0], ['list', { status: 'active', limit: 20 }]);
  for (const text of ['本人陈述', '工作', '不设到期', '尚无使用记录', 'source-message', '版本 3']) assert.ok(h.list().includes(text), text);
  const details = h.list().match(/<details[^>]*>[\s\S]*?<\/details>/)[0];
  assert.doesNotMatch(details, /<details[^>]* open/);
  assert.match(details, /<details class="memory-meta disclosure"><summary><svg class="disclosure-icon"[^>]*aria-hidden="true"[^>]*stroke-width="1\.5"[\s\S]*?<span data-memory-copy="\d+">来源与使用记录<\/span><\/summary>/);
  for (const text of ['source-message', '版本 3', '尚无使用记录']) assert.ok(details.includes(text));
  const primary = h.list().replace(details, '');
  for (const text of ['工作安排', '下午先做简单的事', '本人陈述', '工作', '修改']) assert.ok(primary.includes(text));
  assert.doesNotMatch(h.dom.markup, /id="btnClearMemories"/);
});

test('four tabs use canonical statuses; candidates never claim active before a receipt', async () => {
  const h = harness([memory({ status: 'candidate', sourceType: 'model-proposed', contextAllowed: false })]);
  await h.feature.selectStatus('candidate'); assert.match(h.list(), /模型建议，尚未确认/);
  await h.feature.requestAction('activate', 'm1', 3); assert.equal(h.rows()[0].status, 'candidate'); assert.match(h.review(), /尚未提交/);
  await h.feature.confirm(); await settle(); assert.equal(h.rows()[0].status, 'active'); assert.match(h.dom.$('#memoryReceiptText').textContent, /回执/);
});

test('manual add previews first and never supplies sourceType, sourceRefs or fabricated confirmation', async () => {
  const h = harness(); await h.feature.load(); h.draft(); await h.feature.remember({ preventDefault() {} });
  const request = h.calls.find(([kind]) => kind === 'preview')[1];
  assert.equal(request.operation, 'add'); assert.equal(request.expectedVersion, null);
  assert.deepEqual(Object.keys(request.input).sort(), ['body', 'expiresAt', 'kind', 'privacyLevel', 'scope', 'subject']);
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0); await h.feature.confirm(); await settle();
  assert.equal(h.rows().some(item => item.id === 'm-new'), true); assert.match(h.dom.$('#memoryReceiptText').textContent, /时间线记录待同步/);
});

test('ID-preserving edit binds the exact target and version even when subject changes', async () => {
  const h = harness(); await h.feature.load(); h.feature.edit('m1'); h.dom.$('#memoryDraftSubject').value = '修改后的主题';
  await h.feature.remember(); const request = h.calls.find(([kind]) => kind === 'preview')[1];
  assert.equal(request.targetId, 'm1'); assert.equal(request.expectedVersion, 3); assert.equal(request.operation, 'update');
  await h.feature.confirm(); await settle(); assert.equal(h.rows()[0].id, 'm1'); assert.equal(h.rows()[0].subject, '修改后的主题');
});

test('pause, recycle and restore are distinct reviewed transitions; restore remains paused', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('pause', 'm1', 3); await h.feature.confirm(); await settle();
  await h.feature.selectStatus('paused'); await h.feature.requestAction('remove', 'm1', 4); await h.feature.confirm(); await settle();
  await h.feature.selectStatus('removed'); assert.match(h.list(), /正文仍留在本机回收区/);
  await h.feature.requestAction('restore', 'm1', 5); await h.feature.confirm(); await settle(); assert.equal(h.rows()[0].status, 'paused');
});

test('permanent forget discloses expanded lineage and requires explicit acknowledgement of non-undoable limits', async () => {
  const h = harness([memory({ status: 'removed' })]); await h.feature.selectStatus('removed');
  const original = h.client.previewMemoryChange;
  h.client.previewMemoryChange = async args => { const result = await original(args); result.preview.affectedIds.push('derived-memory'); return result; };
  await h.feature.requestAction('permanent-remove', 'm1', 3);
  assert.match(h.review(), /derived-memory/); assert.match(h.review(), /message:source-message/);
  assert.match(h.dom.markup, /无法从应用内撤销/); assert.match(h.dom.markup, /不能删除已发送给外部模型服务商的副本/);
  await h.feature.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  h.dom.$('#memoryPermanentAcknowledge').checked = true; await h.feature.confirm(); await settle(); assert.equal(h.rows().length, 0);
});

test('double confirm is single-flight and any editor input invalidates the visible preview', async () => {
  const h = harness(), p = pending(); await h.feature.load(); h.draft(); await h.feature.remember();
  h.dom.fire('memoryDraft', 'input'); await h.feature.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  await h.feature.remember(); const original = h.client.confirmMemoryChange;
  h.client.confirmMemoryChange = async args => { h.calls.push(['flight', args]); return p.promise; };
  const first = h.feature.confirm(); await h.feature.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'flight').length, 1);
  p.resolve(await original(h.calls.find(([kind]) => kind === 'flight')[1])); await first; await settle();
});

test('stale row actions and changed targets never retarget a pending confirmation', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('pause', 'm1', 2);
  assert.equal(h.calls.filter(([kind]) => kind === 'preview').length, 0);
  await h.feature.requestAction('pause', 'm1', 3); h.setRows([memory({ version: 4, body: '后续修改' })]); await h.feature.load();
  await h.feature.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
});

test('unavailable storage is distinct from empty and never calls a destructive fallback', async () => {
  const h = harness(); h.client.listMemories = async () => ({ ok: false, availability: 'unavailable' }); await h.feature.load();
  assert.match(h.list(), /不能据此判断没有记忆/); assert.equal(h.dom.$('#btnNewMemory').disabled, true);
});

test('late list/preview responses after collapse cannot paint or enable a stale confirmation', async () => {
  const h = harness(), list = pending(); h.client.listMemories = () => list.promise; const loading = h.feature.load();
  h.feature.close(); const before = h.list(); list.resolve({ ok: true, availability: 'available', items: [memory()], nextCursor: null }); await loading; assert.equal(h.list(), before);
  h.client.listMemories = async () => ({ ok: true, availability: 'available', items: [memory()], nextCursor: null }); await h.feature.load();
  const read = pending(); h.client.previewMemoryChange = () => read.promise;
  const previewing = h.feature.requestAction('pause', 'm1', 3); await settle(); h.feature.close();
  read.resolve({ ok: true, preview: { previewId: 'late', previewHash: 'a'.repeat(64), operation: 'pause', expectedVersion: 3, before: memory(), after: memory({ status: 'paused' }), affectedIds: ['m1'] } }); await previewing;
  assert.equal(h.dom.$('#memoryReview').classList.contains('hidden'), true); assert.ok(h.calls.some(([kind, args]) => kind === 'cancel' && args.previewId === 'late'));
});

test('lost confirm retries the exact bound command; mismatched receipt does not report success', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('pause', 'm1', 3);
  h.client.confirmMemoryChange = async args => { h.calls.push(['lost', args]); throw new Error('lost'); };
  await h.feature.confirm(); assert.match(h.status(), /尚未确认/);
  const expected = h.calls.find(([kind]) => kind === 'lost')[1];
  h.client.confirmMemoryChange = async args => { assert.deepEqual(args, expected); return { ok: true, receipt: { receiptId: 'wrong', store: 'memory', commandId: 'another', previewHash: args.previewHash, beforeVersion: 3 } }; };
  await h.feature.confirm({ retry: true }); assert.match(h.status(), /尚未确认/);
});

test('partial permanent forgetting blocks mutations and reconciles only through read-only receipt', async () => {
  const h = harness([memory({ status: 'removed' })]); await h.feature.selectStatus('removed'); await h.feature.requestAction('permanent-remove', 'm1', 3);
  h.dom.$('#memoryPermanentAcknowledge').checked = true; const original = h.client.confirmMemoryChange;
  h.client.confirmMemoryChange = async args => { const applied = await original(args); return { ok: false, forgettingCommitted: true, cleanupPending: true, receiptId: applied.receipt.receiptId }; };
  await h.feature.confirm(); assert.match(h.status(), /永久遗忘已生效/);
  assert.doesNotMatch(h.review(), /下午先做简单的事/); assert.doesNotMatch(h.list(), /下午先做简单的事/);
  await h.feature.requestAction('restore', 'm1', 3); await h.feature.confirm({ retry: true });
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
  await h.feature.refreshReceipt(); await settle(); assert.equal(h.calls.filter(([kind]) => kind === 'receipt').length, 1);
  assert.match(h.dom.$('#memoryReceiptText').textContent, /永久移除/);
});

test('undo opens a fresh preview and never commits until another explicit confirmation', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('pause', 'm1', 3); await h.feature.confirm(); await settle();
  await h.feature.undo(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 1);
  assert.equal(h.dom.$('#btnConfirmMemoryChange').textContent, '确认这次撤销'); await h.feature.confirm(); await settle();
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 2);
});

test('keyboard tabs use roving focus, and Escape discards only the local review/editor', async () => {
  const h = harness(); await h.feature.load(); let prevented = 0, stopped = 0;
  h.dom.fire('memoryTabs', 'keydown', { key: 'ArrowRight', preventDefault() { prevented++; } }); await settle();
  assert.equal(h.dom.$('#memoryTabCandidate').focused, 1); assert.equal(h.dom.$('#memoryTabCandidate').attributes['aria-selected'], 'true');
  h.draft(); h.dom.fire('memorySection', 'keydown', { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(h.dom.$('#memoryDraft').classList.contains('hidden'), true); assert.equal(stopped, 1); assert.equal(prevented, 2);
});

test('chat candidates use only owned proposal IDs and remain unapplied until a receipt', async () => {
  const h = harness(); await h.feature.load(); await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'p-model' });
  assert.deepEqual(h.calls.find(([kind]) => kind === 'candidate')[1], { conversationId: 'c1', proposalId: 'p-model' });
  assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0); assert.match(h.review(), /聊天建议/);
  assert.equal(h.dom.$('#memoryDraft').classList.contains('hidden'), false);
  assert.equal(h.dom.$('#memoryDraftBody').value, '仅在工作时适用');
});

test('editing a chat candidate invalidates old confirmation and re-previews the same canonical proposal', async () => {
  const h = harness([]); await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'p-model' });
  const old = [...h.previews.values()][0];
  h.dom.$('#memoryDraftBody').value = '我修改后的说法'; h.dom.$('#memoryDraftScope').value = 'personal';
  h.dom.fire('memoryDraft', 'input'); await h.feature.confirm();
  assert.equal(h.previews.has(old.previewId), false); assert.equal(h.rows().length, 0);
  assert.equal(h.dom.$('#memoryReview').classList.contains('hidden'), true);
  assert.equal(h.dom.$('#btnConfirmMemoryChange').disabled, true);
  await h.feature.remember();
  const request = h.calls.filter(([kind]) => kind === 'candidate').at(-1)[1];
  assert.equal(request.conversationId, 'c1'); assert.equal(request.proposalId, 'p-model');
  assert.equal(request.input.body, '我修改后的说法'); assert.equal(request.input.scope, 'personal');
  assert.equal(request.input.sourceRefs, undefined); assert.equal(request.input.sourceType, undefined);
  assert.equal(h.rows().length, 0); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  await h.feature.confirm(); await settle(); assert.equal(h.rows()[0].body, '我修改后的说法');
});

test('candidate replacement binds only its own old preview and cancel/close cannot turn it into a manual add', async () => {
  const h = harness([]); await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'p-model' });
  const old = [...h.previews.values()][0]; await h.feature.remember();
  assert.equal(h.calls.filter(([kind]) => kind === 'candidate').at(-1)[1].replacePreviewId, old.previewId);
  assert.equal(h.previews.has(old.previewId), false); assert.equal(h.previews.size, 1);
  h.feature.cancelReview(); assert.equal(h.previews.size, 0); assert.equal(h.dom.$('#memoryDraft').classList.contains('hidden'), true);
  const count = h.calls.length; await h.feature.remember(); await h.feature.confirm(); assert.equal(h.calls.length, count); assert.equal(h.rows().length, 0);
  await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'p-model' }); h.hide();
  assert.equal(h.previews.size, 0); assert.equal(h.dom.$('#memoryDraft').classList.contains('hidden'), true);
});

test('editing other fields preserves the exact server expiry even when datetime display omits seconds', async () => {
  const expiry = NOW + 3600123, h = harness([memory({ expiresAt: expiry })]);
  await h.feature.load(); h.feature.edit('m1'); h.dom.$('#memoryDraftBody').value = '改了内容'; await h.feature.remember();
  assert.equal(h.calls.find(([kind]) => kind === 'preview')[1].input.expiresAt, expiry);
});

test('chat correction edits the true target/version and cannot retarget during another preview', async () => {
  const h = harness(); await h.feature.load();
  h.client.previewMemoryProposal = async args => {
    h.calls.push(['candidate', args]);
    return h.client.previewMemoryChange({ operation: 'update', targetId: 'm1', expectedVersion: 3,
      input: args.input || { kind: 'preference', subject: '修正的主题', body: '模型提出的修改', scope: 'personal', expiresAt: null } });
  };
  await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'update1' });
  assert.match(h.dom.$('#memoryDraftTarget').textContent, /保持 ID m1 · 当前版本 3/);
  h.dom.$('#memoryDraftBody').value = '我再次修改'; h.dom.fire('memoryDraft', 'input'); await h.feature.remember();
  assert.equal(h.calls.filter(([kind]) => kind === 'candidate').at(-1)[1].input.validFrom, undefined);
  assert.equal(h.rows()[0].body, '下午先做简单的事'); await h.feature.confirm(); await settle();
  assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].id, 'm1'); assert.equal(h.rows()[0].body, '我再次修改');
  const g = harness(); await g.feature.load();
  g.client.previewMemoryProposal = async () => g.client.previewMemoryChange({ operation: 'update', targetId: 'm1', expectedVersion: 3,
    input: { kind: 'preference', subject: '修正', body: '仍未保存', scope: 'work', expiresAt: null } });
  await g.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'update1' }); g.dom.fire('memoryDraft', 'input');
  const original = g.client.previewMemoryProposal;
  g.client.previewMemoryProposal = async () => { const result = await original(); result.preview.before.id = 'other'; result.preview.after.id = 'other'; return result; };
  await g.feature.remember(); await g.feature.confirm();
  assert.equal(g.calls.filter(([kind]) => kind === 'confirm').length, 0); assert.equal(g.previews.size, 0);
});

test('chat forget requires expanded-scope acknowledgment and preserves exact recovery after close', async () => {
  const h = harness(); await h.feature.load();
  h.client.previewMemoryProposal = async () => {
    const result = await h.client.previewMemoryChange({ operation: 'permanent-remove', targetId: 'm1', expectedVersion: 3 });
    result.preview.affectedIds.push('linked-memory'); return result;
  };
  await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'forget1' });
  assert.equal(h.dom.$('#memoryDraft').classList.contains('hidden'), true); assert.match(h.review(), /linked-memory.*source-message/s);
  await h.feature.confirm(); assert.equal(h.calls.filter(([kind]) => kind === 'confirm').length, 0);
  h.dom.$('#memoryPermanentAcknowledge').checked = true;
  const original = h.client.confirmMemoryChange, attempts = [];
  h.client.confirmMemoryChange = async args => { attempts.push(structuredClone(args)); throw new Error('lost result'); };
  await h.feature.confirm(); h.feature.close(); await h.feature.load();
  await h.feature.reviewMemoryCandidate({ conversationId: 'c2', proposalId: 'other' });
  h.client.confirmMemoryChange = async args => { attempts.push(structuredClone(args)); return original(args); };
  await h.feature.confirm({ retry: true }); await settle();
  assert.deepEqual(attempts[1], attempts[0]); assert.equal(attempts[0].permanentAcknowledged, true);
  assert.equal(h.rows().length, 0); assert.doesNotMatch(h.review(), /下午先做简单的事/);
});

test('late forget preview after close releases its ticket without revealing the prior source', async () => {
  const h = harness(), pendingRead = pending(); await h.feature.load();
  const result = await h.client.previewMemoryChange({ operation: 'permanent-remove', targetId: 'm1', expectedVersion: 3 });
  h.client.previewMemoryProposal = () => pendingRead.promise;
  const reading = h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'forget1' }); await settle(); h.feature.close();
  pendingRead.resolve(result); await reading;
  assert.equal(h.previews.size, 0); assert.equal(h.dom.$('#memoryReview').classList.contains('hidden'), true);
  assert.doesNotMatch(h.review(), /source-message/);
});

test('late candidate replacement after close releases only returned ticket and does not reveal old body', async () => {
  const h = harness([]); await h.feature.reviewMemoryCandidate({ conversationId: 'c1', proposalId: 'p-model' });
  h.dom.$('#memoryDraftBody').value = '旧编辑'; h.dom.fire('memoryDraft', 'input');
  const delayed = pending(), original = h.client.previewMemoryProposal;
  h.client.previewMemoryProposal = async args => { const result = await original(args); await delayed.promise; return result; };
  const running = h.feature.remember(); await settle(); h.feature.close();
  h.client.previewMemoryProposal = original; await h.feature.reviewMemoryCandidate({ conversationId: 'c2', proposalId: 'new-model' });
  const freshId = [...h.previews.values()].at(-1).previewId; delayed.resolve(); await running;
  assert.equal(h.previews.size, 1); assert.equal(h.previews.has(freshId), true);
  assert.doesNotMatch(h.review(), /旧编辑/);
});

test('recycle deadline and linked cleanup scope are disclosed, and expired entries cannot restore', async () => {
  const h = harness([memory({ status: 'removed', recycleUntil: NOW + 86400000 })]); await h.feature.selectStatus('removed');
  assert.match(h.list(), /回收保留至/); assert.match(h.list(), /到期后自动永久清理/);
  h.setRows([memory({ status: 'removed', recycleUntil: NOW - 1 })]); await h.feature.load();
  assert.match(h.list(), /永久清理待完成/); await h.feature.requestAction('restore', 'm1', 3);
  assert.equal(h.calls.filter(([kind]) => kind === 'preview').length, 0);
  assert.doesNotMatch(h.list(), /下午先做简单的事/);
  await h.feature.requestAction('permanent-remove', 'm1', 3); assert.equal(h.calls.filter(([kind]) => kind === 'preview').length, 1);
  h.setRows([memory()]); await h.feature.selectStatus('active'); await h.feature.requestAction('remove', 'm1', 3);
  assert.match(h.review(), /到期后将自动永久清理本条/); assert.match(h.review(), /将暂停清理并另行核对扩大后的范围/);
});

test('markup escapes memory content and disposal removes listeners without deleting data', async () => {
  const h = harness([memory({ subject: '<script>bad()</script>', body: '<img onerror="bad()">' })]); await h.feature.load();
  assert.doesNotMatch(h.list(), /<script>|<img/); assert.match(h.list(), /&lt;script&gt;/);
  h.feature.dispose(); assert.equal(h.dom.listeners.size, 0); assert.equal(h.rows().length, 1);
});

test('explicit unknown SQL outcome retains the exact confirmation across close and prevents another edit', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('pause', 'm1', 3);
  const original = h.client.confirmMemoryChange, confirmations = [];
  h.client.confirmMemoryChange = async args => {
    confirmations.push(structuredClone(args));
    return confirmations.length === 1 ? { ok: false, reason: 'memory-commit-outcome-unknown', retrySameIdentity: true, outcome: 'unknown' } : original(args);
  };
  await h.feature.confirm(); assert.match(h.status(), /尚未确认/);
  h.feature.close(); await h.feature.load();
  const before = h.calls.filter(([kind]) => kind === 'preview').length;
  await h.feature.requestAction('remove', 'm1', 3);
  assert.equal(h.calls.filter(([kind]) => kind === 'preview').length, before);
  await h.feature.confirm({ retry: true }); await settle();
  assert.equal(confirmations.length, 2); assert.deepEqual(confirmations[1], confirmations[0]);
  assert.equal(h.rows()[0].status, 'paused'); assert.match(h.dom.$('#memoryReceiptText').textContent, /回执/);
});

test('uncertain permanent removal hides cached body without claiming deletion and retains exact acknowledgment', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('permanent-remove', 'm1', 3);
  h.dom.$('#memoryPermanentAcknowledge').checked = true;
  const original = h.client.confirmMemoryChange, confirmations = [];
  h.client.confirmMemoryChange = async args => {
    confirmations.push(structuredClone(args));
    return confirmations.length === 1 ? { ok: false, reason: 'memory-commit-outcome-unknown', retrySameIdentity: true, outcome: 'unknown' } : original(args);
  };
  await h.feature.confirm(); assert.match(h.status(), /尚未确认/);
  assert.equal(h.dom.$('#memoryReview').classList.contains('hidden'), true);
  assert.doesNotMatch(h.list(), /下午先做简单的事/); assert.equal(h.rows().length, 1);
  h.feature.close(); await h.feature.load();
  assert.equal(h.dom.$('#memoryReview').classList.contains('hidden'), true);
  await h.feature.confirm({ retry: true }); await settle();
  assert.deepEqual(confirmations[1], confirmations[0]); assert.equal(confirmations[1].permanentAcknowledged, true);
  assert.equal(h.rows().length, 0);
});

test('cancel returns focus to the replacement list action instead of its detached pre-render node', async () => {
  const h = harness(); await h.feature.load();
  const stale = { dataset: { memoryAction: 'pause', memoryId: 'm1', memoryVersion: '3' }, isConnected: false,
    focus() { throw new Error('detached action must not receive focus'); } };
  let focused = 0;
  const current = { dataset: { memoryAction: 'pause', memoryId: 'm1' }, focus() { focused++; } };
  h.dom.$('#memoryList').querySelectorAll = () => [current];
  h.dom.fire('memoryList', 'click', { target: { closest: () => stale } });
  await new Promise(resolve => setImmediate(resolve));
  h.feature.cancelReview();
  assert.equal(focused, 1);
  h.feature.dispose();
});

test('confirming and unknown memory commits never retain the not-submitted review notice', async () => {
  const h = harness(); await h.feature.load(); await h.feature.requestAction('pause', 'm1', 3);
  assert.match(h.review(), /尚未提交/);
  const result = pending(); h.client.confirmMemoryChange = () => result.promise;
  const confirmation = h.feature.confirm();
  assert.doesNotMatch(h.review(), /尚未提交/);
  assert.match(h.status(), /确认请求正在处理/);
  assert.match(h.review(), /暂停使用/);
  result.resolve({ ok: false, reason: 'memory-commit-outcome-unknown', outcome: 'unknown' }); await confirmation;
  assert.doesNotMatch(h.review(), /尚未提交/);
  assert.match(h.status(), /尚未确认/);
  assert.match(h.review(), /暂停使用/);
  assert.equal(h.dom.$('#btnConfirmMemoryChange').disabled, true);
  assert.equal(h.dom.$('#btnCancelMemoryChange').disabled, true);
  h.feature.dispose();
});
