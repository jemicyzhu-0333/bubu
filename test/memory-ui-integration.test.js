'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, openForgettingLedger } = require('../src/platform/persistence/sqlite/sqlite-database');
const { createMemoryService } = require('../src/application/ai/memory-service');
const { createPopoverMemoryList } = require('../src/surfaces/popover/features/memory-list.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const channels = { listMemories: 'memory:list', previewMemoryChange: 'memory:change-preview', confirmMemoryChange: 'memory:change-confirm',
  previewMemoryUndo: 'memory:undo-preview', getMemoryReceipt: 'memory:receipt', cancelMemoryChange: 'memory:change-cancel' };
const NOW = Date.UTC(2026, 9, 4, 12);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ui-authority-'));
  const ownerId = 'memory-ui-fixture-owner'; let serial = 0;
  const store = openDatabase({ filePath: path.join(directory, 'facts.sqlite'), driver: 'node:sqlite', now: () => NOW });
  const ledger = openForgettingLedger({ filePath: path.join(directory, 'forgetting.sqlite'), ownerId, create: true, restoreState: 'current-local', lockAcquired: true });
  const opened = store.openMemoryAuthority({ ownerId, forgettingLedger: ledger.ledger, now: () => NOW });
  assert.equal(opened.ok, true, opened.reason);
  const service = createMemoryService({ repository: opened.repository, now: () => NOW, idFactory: kind => `${kind}-${++serial}`,
    onInvalidate: options.onInvalidate });
  const calls = [], client = {};
  for (const [name, method] of Object.entries({ listMemories: 'list', previewMemoryChange: 'preview', confirmMemoryChange: 'confirmReviewed',
    previewMemoryUndo: 'previewUndo', getMemoryReceipt: 'receipt', cancelMemoryChange: 'cancel' })) client[name] = async payload => {
      const decoded = validateIpcPayload(channels[name], payload); assert.equal(decoded.ok, true, `${name}: ${JSON.stringify(decoded)}`);
      const result = service[method](decoded.value); calls.push({ name, payload: structuredClone(payload), result: structuredClone(result) }); return result;
    };
  const dom = createCollaborationDom(); dom.$('#settingsMask').classList.remove('hidden'); dom.$('#settingGroupAi').open = true;
  const feature = createPopoverMemoryList({ $: dom.$, surfaceClient: client, now: () => NOW,
    escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') }); feature.mount();
  return { feature, service, dom, client, calls,
    last: name => calls.filter(call => call.name === name).at(-1),
    draft(subject, body = '本人选择的内容') { feature.edit(); for (const [id, value] of Object.entries({ memoryDraftKind: 'preference', memoryDraftSubject: subject,
      memoryDraftBody: body, memoryDraftScope: 'work', memoryDraftExpiry: '', memoryDraftPrivacy: 'standard' })) dom.$(`#${id}`).value = value; },
    close() { feature.dispose(); store.close(); ledger.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('memory UI reviews real SQLite versioned add/edit/pause/undo/recycle/restore/permanent removal with canonical receipts', async () => {
  const h = fixture();
  try {
    await h.feature.load(); h.draft('报告时间'); await h.feature.remember();
    assert.equal(h.service.list().items.length, 0); await h.feature.confirm(); await tick();
    let row = h.service.list().items[0]; const id = row.id;
    assert.equal(row.sourceType, 'user-statement'); assert.equal(row.status, 'active'); assert.equal(h.service.outbox().items.length, 1);
    h.feature.edit(id); h.dom.$('#memoryDraftSubject').value = '改后的报告安排'; await h.feature.remember();
    assert.equal(h.last('previewMemoryChange').result.ok, true); await h.feature.confirm(); await tick();
    row = h.service.list().items[0]; assert.equal(row.id, id); assert.equal(row.version, 2); assert.equal(row.sourceType, 'user-edit');
    await h.feature.requestAction('pause', id, 2); await h.feature.confirm(); await tick();
    const paused = h.service.contextReader.readContextSnapshot({ ids: null });
    assert.equal(paused.ok, true); assert.deepEqual(paused.items, []);
    assert.equal(h.service.contextReader.readContextSnapshot({ ids: [id] }).reason, 'memory-context-invalid-selection');
    const count = h.service.outbox().items.length; await h.feature.undo(); assert.equal(h.service.outbox().items.length, count);
    await h.feature.confirm(); await tick(); assert.equal(h.service.list().items[0].status, 'active');
    await h.feature.requestAction('remove', id, 4); await h.feature.confirm(); await tick();
    await h.feature.selectStatus('removed'); await h.feature.requestAction('restore', id, 5); await h.feature.confirm(); await tick();
    assert.equal(h.service.list().items[0].status, 'paused'); await h.feature.selectStatus('paused');
    await h.feature.requestAction('remove', id, 6); await h.feature.confirm(); await tick(); await h.feature.selectStatus('removed');
    await h.feature.requestAction('permanent-remove', id, 7); assert.equal(h.service.list().items.length, 1);
    h.dom.$('#memoryPermanentAcknowledge').checked = true; await h.feature.confirm(); await tick();
    assert.equal(h.service.list().items.length, 0); assert.ok(h.service.forgettingState().memoryIds.includes(id));
    assert.match(h.dom.$('#memoryReceiptText').textContent, /永久移除/);
    assert.equal(h.dom.$('#btnUndoMemoryChange').classList.contains('hidden'), true);
  } finally { h.close(); }
});

test('actual pending candidate activation and duplicate refusal remain user-reviewed in UI', async () => {
  const h = fixture();
  try {
    const candidate = h.service.proposeCandidate({ operation: 'add', input: { kind: 'preference', subject: '候选', body: '原始建议', scope: 'work', sourceRefs: [{ kind: 'message', id: 'chat-source', revision: null }] } });
    const p = candidate.preview; h.service.confirm({ previewId: p.previewId, previewHash: p.previewHash, expectedVersion: p.expectedVersion });
    const row = h.service.list().items[0];
    const candidates = h.service.contextReader.readContextSnapshot({ ids: null });
    assert.equal(candidates.ok, true); assert.deepEqual(candidates.items, []);
    await h.feature.selectStatus('candidate'); assert.match(h.dom.$('#memoryList').innerHTML, /模型建议，尚未确认/);
    await h.feature.requestAction('activate', row.id, row.version);
    const unconfirmed = h.service.contextReader.readContextSnapshot({ ids: [row.id] });
    assert.equal(unconfirmed.reason, 'memory-context-invalid-selection'); assert.equal(Object.hasOwn(unconfirmed, 'items'), false);
    await h.feature.confirm(); await tick();
    const activated = h.service.contextReader.readContextSnapshot({ ids: [row.id] });
    assert.equal(activated.ok, true); assert.deepEqual(activated.items.map(item => item.id), [row.id]);
    assert.equal(h.service.list().items[0].sourceType, 'user-edit');
    await h.feature.selectStatus('active'); h.draft('候选', '不同的内容'); await h.feature.remember();
    assert.equal(h.last('previewMemoryChange').result.reason, 'memory-duplicate');
    assert.match(h.dom.$('#memoryStatus').textContent, /已有同主题/); assert.equal(h.dom.$('#memoryDraftBody').value, '不同的内容');
    assert.equal(h.service.list().items.length, 1);
    await h.feature.replaceDuplicate(row.id);
    assert.equal(h.last('previewMemoryChange').payload.operation, 'update');
    assert.equal(h.last('previewMemoryChange').payload.targetId, row.id);
    assert.equal(h.last('previewMemoryChange').payload.input.body, '不同的内容');
    await h.feature.confirm(); await tick(); assert.equal(h.service.list().items[0].id, row.id);
  } finally { h.close(); }
});

test('receipt refresh keeps memory UI blocked until pending context invalidation actually succeeds', async () => {
  let unavailable = true, attempts = 0;
  const h = fixture({ onInvalidate() { attempts++; if (unavailable) throw new Error('consumer unavailable'); } });
  try {
    await h.feature.load(); h.draft('Synthetic pending effect'); await h.feature.remember();
    await h.feature.confirm(); await tick();
    const receiptId = h.last('confirmMemoryChange').result.receipt.receiptId;
    assert.equal(h.dom.$('#btnNewMemory').disabled, true);
    await h.feature.refreshReceipt(); await tick();
    assert.equal(h.dom.$('#btnNewMemory').disabled, true);
    assert.equal(attempts, 2);
    unavailable = false;
    await h.feature.refreshReceipt(); await tick();
    assert.equal(h.dom.$('#btnNewMemory').disabled, false);
    assert.equal(attempts, 3); assert.equal(h.last('getMemoryReceipt').result.receipt.receiptId, receiptId);
    assert.equal(h.service.list().items[0].version, 1); assert.equal(h.service.outbox().items.length, 1);
  } finally { h.close(); }
});

test('receipt refresh shows actual SQLite timeline synchronization state', async () => {
  const h = fixture();
  try {
    await h.feature.load(); h.draft('Synthetic receipt state'); await h.feature.remember();
    await h.feature.confirm(); await tick();
    assert.match(h.dom.$('#memoryReceiptText').textContent, /时间线记录待同步/);
    await h.feature.refreshReceipt(); await tick();
    assert.match(h.dom.$('#memoryReceiptText').textContent, /时间线记录待同步/);
    const eventId = h.last('confirmMemoryChange').result.receipt.eventId;
    assert.equal(h.service.acknowledgeOutbox({ eventId }).ok, true);
    await h.feature.refreshReceipt(); await tick();
    assert.match(h.dom.$('#memoryReceiptText').textContent, /时间线已同步/);
  } finally { h.close(); }
});
