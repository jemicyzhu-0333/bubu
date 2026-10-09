'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUnitOfWork, createDeleteMoodNoteCommand, createInboxHistoryQuery } = require('../src/application');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { aiChangeLedger } = require('../src/capabilities/guidance');
const { receiptFixture, summaryFixture, NOW } = require('../test-support/ai-change-ledger-fixture');
const { createTimelineMoodDeletion } = require('../src/surfaces/popover/features/timeline-mood-deletion.mjs');
const { inboxCard } = require('../src/surfaces/popover/features/inbox-card.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = (id, targetId = 'mood') => ({ id, text: `Synthetic ${id}`, createdAt: NOW - 1000,
  classification: { category: 'feeling', routineKind: null, level: null },
  resolution: { action: 'feeling', category: 'feeling', at: NOW, targetId } });
function receipts() {
  let ledger = aiChangeLedger.createLedger();
  for (const [index, id] of ['local-source', 'archived-source', 'unrelated-source'].entries()) {
    const receipt = receiptFixture(index + 1);
    receipt.details.evidenceRefs = [{ kind: 'inbox', id, revision: null }];
    ledger = aiChangeLedger.appendReceipt(ledger, { receipt, events: [summaryFixture(receipt)], now: NOW }).ledger;
  }
  return ledger;
}
test('actual config and fact SQLite reopen exposes retained exact-target source and fresh confirmation completes cleanup', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mood-source-restart-'));
  const configOptions = { userDataPath: dir, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => NOW, driver: 'node:sqlite' };
  const factOptions = { filePath: path.join(dir, 'facts.sqlite'), driver: 'node:sqlite' };
  let repository = createSqliteStateAdapter(configOptions), store = openDatabase(factOptions);
  t.after(() => { repository.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let state = repository.snapshot();
  state.moodNotes = [{ id: 'mood', text: 'Synthetic private mood', at: NOW - 1000 }];
  state.impulses = [source('local-source')]; state.aiCollaboration = receipts();
  repository.commit(state, { now: NOW });
  store.inboxArchive.put([source('archived-source'), source('unrelated-source', 'other-mood')]);
  const firstCommand = createDeleteMoodNoteCommand({ unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW }, durability: repository.authoritativeWrites,
    inboxArchive: { ...store.inboxArchive, removeByTarget: () => ({ ok: false, removed: 0 }) } });
  const result = firstCommand.execute({ id: 'mood' });
  assert.equal(result.reason, 'mood-delete-partial'); assert.equal(result.localDeleted, true);
  const beforeRestart = repository.snapshot();
  assert.equal(beforeRestart.moodNotes.length, 0); assert.equal(beforeRestart.impulses.length, 0);
  assert.equal(beforeRestart.aiCollaboration.receipts[0].details, null);
  assert.equal(beforeRestart.aiCollaboration.receipts[1].details, null);
  assert.ok(beforeRestart.aiCollaboration.receipts[2].details);
  repository.close(); store.close();
  repository = createSqliteStateAdapter(configOptions); store = openDatabase(factOptions);
  const query = createInboxHistoryQuery({ readSnapshot: repository.snapshot, archive: store.inboxArchive });
  const loaded = query.page({});
  assert.equal(loaded.available, true);
  const row = loaded.items.find(item => item.id === 'archived-source');
  assert.equal(row.resolution.targetId, 'mood');
  const html = inboxCard(row, repository.snapshot(), String);
  assert.match(html, /来源记录仍保留/); assert.match(html, /删除关联来源/);
  assert.doesNotMatch(html, /已存情绪|上次删除失败/);
  const calls = [], revision = repository.revision();
  const command = createDeleteMoodNoteCommand({ unitOfWork: createUnitOfWork({ repository }), clock: { now: () => NOW },
    durability: repository.authoritativeWrites, inboxArchive: store.inboxArchive });
  const controller = createTimelineMoodDeletion({ hasMood: id => repository.snapshot().moodNotes.some(note => note.id === id),
    findSource: id => loaded.items.find(item => item.id === id), render() {}, refresh() {},
    sendDelete: id => { calls.push(id); return command.execute({ id }); } });
  assert.deepEqual(calls, [], 'opening history never authorizes cleanup');
  assert.equal(controller.activateSource(row.id, 'mood', '2026-10-04'), 'armed');
  assert.deepEqual(calls, [], 'first activation only asks fresh confirmation');
  assert.equal(controller.activateSource(row.id, 'mood', '2026-10-04'), 'sending'); await tick();
  assert.deepEqual(calls, ['mood']); assert.equal(controller.view().phase, 'complete');
  assert.equal(repository.revision(), revision, 'retry does not fabricate another canonical commit');
  assert.deepEqual(store.inboxArchive.idsByTarget('feeling', 'mood').ids, []);
  assert.deepEqual(store.inboxArchive.idsByTarget('feeling', 'other-mood').ids, ['unrelated-source']);
  assert.deepEqual(repository.snapshot().aiCollaboration.receipts[2], beforeRestart.aiCollaboration.receipts[2]);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), false);
  controller.dispose();
});
