'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { openConfigAuthority } = require('../src/platform/persistence/sqlite/sqlite-database');
// This is the isolated historical adapter bridge, never production18 admission.
const HISTORICAL_SCHEMA_VERSION = 17;
const { detectCurrentSchemaMigration } = require('../src/core/store-migration');
const NOW = Date.parse('2026-10-07T01:00:00Z');
// A deliberately small, closed historical adapter payload tests the bridge
// without constructing a nominal17 profile from evolving current18 defaults.
const normalize = (value = {}) => ({
  schemaVersion: HISTORICAL_SCHEMA_VERSION,
  level: Number.isSafeInteger(value.level) && value.level >= 1 ? value.level : 1,
  settings: { autoCheckUpdates: typeof value.settings?.autoCheckUpdates === 'boolean'
    ? value.settings.autoCheckUpdates : true }
});
function oldNormalize(value) { const state = normalize(value); delete state.settings.autoCheckUpdates; return state; }
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-migration-'));
  const handles = [];
  t.after(() => { handles.forEach(x => x.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  const open = options => { const adapter = createElectronStoreAdapter({ userDataPath: directory,
    schemaVersion: HISTORICAL_SCHEMA_VERSION, normalize, now: () => NOW, ...options }); handles.push(adapter); return adapter; };
  return { directory, open, file: path.join(directory, 'config.json'), sql: path.join(directory, 'config.sqlite') };
}
test('previous writer shape receives only the explicit update-check setting and an exact JSON backup', t => {
  const f = fixture(t), old = oldNormalize({});
  const bytes = Buffer.from(JSON.stringify(old, null, 4) + '\n'); fs.writeFileSync(f.file, bytes);
  const adapter = f.open();
  assert.equal(adapter.snapshot().settings.autoCheckUpdates, true);
  assert.deepEqual(fs.readFileSync(`${f.file}.schema-${HISTORICAL_SCHEMA_VERSION}-update-check-setting.backup`), bytes);
  const expected = structuredClone(old); expected.settings.autoCheckUpdates = true;
  assert.deepEqual(adapter.snapshot(), expected);
  const revision = adapter.revision(); adapter.close();
  assert.equal(f.open().revision(), revision, 'opening twice does not repeat migration');
});
test('existing SQL authority stores the old canonical payload as migration evidence before upgrading', t => {
  const f = fixture(t), previous = f.open({ normalize: oldNormalize }); previous.close();
  const db = new DatabaseSync(f.sql, { readOnly: true });
  const before = db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json; db.close();
  const adapter = f.open(); assert.equal(adapter.snapshot().settings.autoCheckUpdates, true); adapter.close();
  const check = new DatabaseSync(f.sql, { readOnly: true });
  const rows = check.prepare("SELECT source_bytes FROM config_evidence WHERE kind='payload-migration'").all(); check.close();
  assert.equal(rows.length, 1); assert.equal(Buffer.from(rows[0].source_bytes).toString(), before);
  f.open().close(); const after = new DatabaseSync(f.sql, { readOnly: true });
  assert.equal(after.prepare("SELECT COUNT(*) n FROM config_evidence WHERE kind='payload-migration'").get().n, 1); after.close();
});
test('additive migration cannot conceal an invalid explicit value or unrelated corruption', t => {
  const old = oldNormalize({});
  for (const mutate of [x => { x.settings.autoCheckUpdates = 'yes'; }, x => { x.level = -1; }]) {
    const f = fixture(t), raw = structuredClone(old); mutate(raw); const bytes = JSON.stringify(raw); fs.writeFileSync(f.file, bytes);
    assert.equal(detectCurrentSchemaMigration(raw, normalize(raw), HISTORICAL_SCHEMA_VERSION), null);
    assert.throws(() => f.open(), /failed validation/); assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  }
});
test('backup failure refuses JSON adoption without rewriting its bytes', t => {
  const f = fixture(t), bytes = JSON.stringify(oldNormalize({})); fs.writeFileSync(f.file, bytes);
  const io = { ...fs, copyFileSync() { throw new Error('backup-full'); } };
  assert.throws(() => f.open({ io }), /Cannot back up/); assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
});
test('SQL migration write failure retains the old authority for safe retry', t => {
  const f = fixture(t); f.open({ normalize: oldNormalize }).close();
  assert.throws(() => f.open({ authorityFactory: options => {
    const authority = openConfigAuthority(options);
    return { ...authority, write() { throw new Error('migration-write-failed'); } };
  } }), /migration-write-failed/);
  const old = f.open({ normalize: oldNormalize }); assert.equal(Object.hasOwn(old.snapshot().settings, 'autoCheckUpdates'), false); old.close();
  assert.equal(f.open().snapshot().settings.autoCheckUpdates, true);
});

test('the temporary updater bridge never accepts missing fields in schema18 or future schemas', () => {
  const old = oldNormalize({}); old.schemaVersion = 18;
  const next = structuredClone(old); next.settings.autoCheckUpdates = true;
  assert.equal(detectCurrentSchemaMigration(old, next, 18), null);
});
