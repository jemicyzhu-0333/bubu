'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createElectronStoreAdapter } = require('../src/platform/persistence/electron-store-adapter');
const { createAuthoritativeConfigWriter } = require('../src/platform/persistence/authoritative-config-writer');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { appendFixture, NOW } = require('../test-support/ai-change-ledger-fixture');
const normalize = version => value => ({ ...value, schemaVersion: version, count: value.count ?? 0 });
function fixture(t, value = { schemaVersion: 16, count: 1 }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-config-')), handles = [];
  const mirror = path.join(directory, 'config.json'), database = path.join(directory, 'config.sqlite'), identity = database + '.identity.sqlite';
  if (value !== null) fs.writeFileSync(mirror, JSON.stringify(value, null, 2));
  t.after(() => { handles.forEach(handle => handle.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  const open = options => { const repo = createElectronStoreAdapter({ userDataPath: directory, schemaVersion: 16,
    normalize: normalize(16), now: () => NOW, ...options }); handles.push(repo); return repo; };
  return { directory, mirror, database, identity, open, handles };
}
function faultFactory(fault, observed = { open: 0 }) {
  return options => openSqliteConfigAuthority(options, {
    selectDriver: () => ({ open(filePath, settings = {}) {
      fault({ type: 'open', filePath, readOnly: settings.readOnly === true });
      const db = new DatabaseSync(filePath, settings); observed.open++;
      return { db, filePath, readOnly: settings.readOnly === true };
    } }),
    makeHandle: ({ db, filePath, readOnly }) => ({
      exec(sql) { fault({ type: 'before', sql, filePath, readOnly }); const result = db.exec(sql); fault({ type: 'after', sql, filePath, readOnly }); return result; },
      run(sql, params = []) { fault({ type: 'before', sql, filePath, readOnly }); const result = db.prepare(sql).run(...params); fault({ type: 'after', sql, filePath, readOnly }); return result; },
      get: (sql, params = []) => db.prepare(sql).get(...params), all: (sql, params = []) => db.prepare(sql).all(...params),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`),
      close() { db.close(); observed.open--; }
    })
  });
}
function raw(f, callback) { const db = new DatabaseSync(f.database); try { return callback(db); } finally { db.close(); } }

test('Windows directory EPERM permits canonical AI and manual saves preserving receipt/outbox through restart', t => {
  const state = normalizePersistedState({}, { now: NOW }), f = fixture(t, state);
  const io = { ...fs, openSync(filePath, ...args) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) throw Object.assign(new Error('directory unsupported'), { code: 'EPERM' });
    return fs.openSync(filePath, ...args);
  } };
  const repo = f.open({ io, platform: 'win32', schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState });
  const ledger = appendFixture().ledger;
  repo.update(draft => { draft.aiCollaboration = ledger; }, { now: NOW, durability: 'authoritative' });
  repo.update(draft => { draft.xp += 1; }, { now: NOW });
  assert.equal(repo.authoritativeWrites.status().available, true); assert.equal(repo.authoritativeWrites.verify().ok, true);
  const version = repo.revision(); repo.close();
  const again = f.open({ io, platform: 'win32', schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState });
  assert.equal(again.revision(), version); assert.deepEqual(again.snapshot().aiCollaboration, ledger);
  assert.equal(again.get('xp'), state.xp + 1);
});

test('new profile crash after SQL commit before first JSON mirror resumes from durable absence binding', t => {
  const f = fixture(t, null);
  const first = f.open({ mirrorWriterFactory: () => ({ write() { throw new Error('interrupted mirror'); } }) });
  first.update(draft => { draft.count = 42; });
  const revision = first.revision(); assert.equal(fs.existsSync(f.mirror), false); first.close();
  const next = f.open(); assert.equal(next.get('count'), 42); assert.equal(next.revision(), revision);
  assert.equal(JSON.parse(fs.readFileSync(f.mirror)).count, 42); assert.equal(next.mirror.status().pending, false);
});

test('existing mirror write failure remains committed and retries do not repeat business mutation', t => {
  const f = fixture(t), original = fs.readFileSync(f.mirror); let fail = true;
  const repo = f.open({ mirrorWriterFactory: options => {
    const writer = createAuthoritativeConfigWriter(options);
    return { write(value, settings) { if (fail) throw new Error('mirror disk failure'); return writer.write(value, settings); } };
  } });
  repo.update(draft => { draft.count++; }); assert.equal(repo.get('count'), 2); assert.equal(repo.revision(), 1);
  assert.deepEqual(fs.readFileSync(f.mirror), original); assert.equal(repo.authoritativeWrites.status().mirrorPending, true);
  fail = false; assert.equal(repo.mirror.retry().ok, true); assert.equal(repo.revision(), 1);
  repo.close(); assert.equal(f.open().get('count'), 2);
});

test('changed, malformed and removed mirrors are preserved and never replace canonical SQL', t => {
  for (const mode of ['changed', 'malformed', 'missing']) {
    const f = fixture(t), repo = f.open(); repo.update(draft => { draft.count = 2; });
    if (mode === 'missing') fs.unlinkSync(f.mirror); else fs.writeFileSync(f.mirror, mode === 'changed' ? '{"schemaVersion":999,"count":999}' : '{broken');
    const evidence = mode === 'missing' ? null : fs.readFileSync(f.mirror);
    assert.equal(repo.mirror.retry().reason, 'config-mirror-conflict');
    repo.update(draft => { draft.count = 3; }); assert.equal(repo.get('count'), 3); assert.equal(repo.authoritativeWrites.status().available, true);
    repo.close(); const again = f.open(); assert.equal(again.get('count'), 3); assert.equal(again.mirror.status().reason, 'config-mirror-conflict');
    if (evidence) assert.deepEqual(fs.readFileSync(f.mirror), evidence); else assert.equal(fs.existsSync(f.mirror), false);
  }
});

test('COMMIT error after landing reconciles exact revision/hash; known failed commit remains retryable', t => {
  for (const phase of ['before', 'after']) {
    const f = fixture(t); let armed = false;
    const repo = f.open({ authorityFactory: faultFactory(event => {
      if (armed && event.filePath === f.database && event.type === phase && event.sql === 'COMMIT') { armed = false; throw new Error('commit fault'); }
    }) });
    armed = true;
    if (phase === 'before') { assert.throws(() => repo.update(draft => { draft.count = 2; }), /commit fault/); assert.equal(repo.get('count'), 1); }
    else assert.equal(repo.update(draft => { draft.count = 2; }).count, 2);
    repo.update(draft => { draft.count = 3; }); assert.equal(repo.get('count'), 3);
    assert.equal(repo.revision(), phase === 'before' ? 1 : 2);
  }
});

test('unknown landed outcome disables further writes until reopening and closes every connection', t => {
  const f = fixture(t), observed = { open: 0 }; let armed = false, failedRead = false;
  const repo = f.open({ authorityFactory: faultFactory(event => {
    if (armed && event.filePath === f.database && event.type === 'after' && event.sql === 'COMMIT') { armed = false; failedRead = true; throw new Error('landed'); }
    if (failedRead && event.type === 'open' && event.readOnly && event.filePath === f.database) throw new Error('readback unavailable');
  }, observed) });
  armed = true; assert.throws(() => repo.update(draft => { draft.count = 2; }), /outcome-unknown/);
  assert.equal(repo.authoritativeWrites.status().available, false);
  assert.throws(() => repo.update(draft => { draft.count = 3; }), /outcome-unknown/);
  repo.close(); assert.equal(observed.open, 0);
  assert.equal(f.open().get('count'), 2);
});

test('payload migration reads SQL, retains one exact source backup and creates no save history', t => {
  const f = fixture(t), first = f.open(); first.update(draft => { draft.count = 7; }); first.close();
  const sqlSource = raw(f, db => db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
  fs.writeFileSync(f.mirror, '{"schemaVersion":16,"count":999}'); const mirror = fs.readFileSync(f.mirror);
  const next = f.open({ schemaVersion: 17, normalize: value => ({ ...value, schemaVersion: 17, newField: [] }) });
  assert.equal(next.get('count'), 7); assert.equal(next.migration.sourceVersion, 16);
  raw(f, db => assert.deepEqual(Buffer.from(db.prepare("SELECT source_bytes FROM config_evidence WHERE kind='payload-migration'").get().source_bytes), Buffer.from(sqlSource)));
  for (let index = 0; index < 5; index++) next.update(draft => { draft.count++; });
  raw(f, db => assert.equal(db.prepare('SELECT COUNT(*) AS count FROM config_evidence').get().count, 2));
  assert.deepEqual(fs.readFileSync(f.mirror), mirror);
});

test('failed payload migration preserves old canonical state and the separately committed exact backup', t => {
  const f = fixture(t); f.open().close(); const source = raw(f, db => db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
  const observed = { open: 0 }; let changed = false;
  assert.throws(() => f.open({ schemaVersion: 17, normalize: normalize(17), authorityFactory: faultFactory(event => {
    if (event.type === 'after' && event.sql?.startsWith('UPDATE config_snapshot SET revision=')) changed = true;
    if (changed && event.type === 'before' && event.sql === 'COMMIT') throw new Error('migration refused');
  }, observed) }), /migration refused/);
  assert.equal(observed.open, 0);
  raw(f, db => { assert.equal(db.prepare('SELECT payload_version FROM config_snapshot').get().payload_version, 16);
    assert.deepEqual(Buffer.from(db.prepare("SELECT source_bytes FROM config_evidence WHERE kind='payload-migration'").get().source_bytes), Buffer.from(source)); });
  assert.equal(f.open({ schemaVersion: 17, normalize: normalize(17) }).snapshot().schemaVersion, 17);
});

test('missing identity/authority, wrong authority, future and malformed SQL never reimport the mirror', t => {
  for (const mode of ['missing-identity', 'missing-main', 'zero-main', 'wrong-main', 'future', 'malformed']) {
    const f = fixture(t), first = f.open(); first.update(draft => { draft.count = 42; }); first.close();
    if (mode === 'missing-identity') fs.renameSync(f.identity, f.identity + '.retained');
    else if (mode === 'missing-main') fs.renameSync(f.database, f.database + '.retained');
    else if (mode === 'zero-main') fs.writeFileSync(f.database, '');
    else if (mode === 'wrong-main') { const other = fixture(t); other.open().close(); fs.copyFileSync(other.database, f.database); }
    else raw(f, db => db.exec(mode === 'future' ? 'PRAGMA user_version=99' : 'CREATE TABLE unexpected(id TEXT)'));
    const mirror = fs.readFileSync(f.mirror), before = fs.existsSync(f.database) ? fs.readFileSync(f.database) : null;
    assert.throws(() => f.open(), /config-|database/);
    assert.deepEqual(fs.readFileSync(f.mirror), mirror);
    if (before) assert.deepEqual(fs.readFileSync(f.database), before); else assert.equal(fs.existsSync(f.database), false);
  }
});

test('live schema change invalidates cached connections and stale snapshots cannot overwrite newer receipts', t => {
  const f = fixture(t), first = f.open(), second = f.open();
  const stale = first.snapshot(), revision = first.revision();
  second.update(draft => { draft.count = 2; draft.aiCollaboration = { receipts: [{ appliedRevision: 10 }] }; });
  assert.throws(() => first.commit(stale, { expectedRevision: revision }), /revision-conflict/);
  assert.equal(first.get('count'), 2);
  raw(f, db => db.exec('CREATE TABLE unexpected(id TEXT)'));
  assert.throws(() => first.snapshot(), /schema-invalid/); assert.equal(first.authoritativeWrites.status().available, false);
});

test('legacy receipt revisions seed persisted CAS and exact import bytes stay out of identity', t => {
  const state = normalizePersistedState({}, { now: NOW }); state.aiCollaboration = appendFixture().ledger;
  const f = fixture(t, state), bytes = fs.readFileSync(f.mirror);
  const repo = f.open({ schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState });
  assert.equal(repo.revision(), Math.max(...state.aiCollaboration.receipts.map(receipt => receipt.appliedRevision)));
  raw(f, db => assert.deepEqual(Buffer.from(db.prepare("SELECT source_bytes FROM config_evidence WHERE kind='import'").get().source_bytes), bytes));
  const marker = new DatabaseSync(f.identity);
  assert.equal(marker.prepare('PRAGMA table_info(config_identity)').all().some(row => /bytes|body|json/.test(row.name)), false); marker.close();
});

test('a mirror changed while its replacement is prepared is preserved instead of overwritten', t => {
  const f = fixture(t); let armed = false;
  const io = { ...fs, writeFileSync(target, bytes, ...args) {
    fs.writeFileSync(target, bytes, ...args);
    if (armed && typeof target === 'number') { armed = false; fs.writeFileSync(f.mirror, '{"external":"preserve this fixture"}'); }
  } };
  const repo = f.open({ io }); armed = true;
  repo.update(draft => { draft.count = 2; });
  assert.equal(repo.get('count'), 2); assert.deepEqual(JSON.parse(fs.readFileSync(f.mirror)), { external: 'preserve this fixture' });
  assert.equal(repo.mirror.status().reason, 'config-mirror-conflict');
});

test('construction errors after opening the authority close persistent read connections', t => {
  const f = fixture(t); f.open().close(); const observed = { open: 0 };
  assert.throws(() => f.open({ authorityFactory: faultFactory(() => {}, observed),
    normalize() { throw new Error('validation stopped'); } }), /validation stopped/);
  assert.equal(observed.open, 0);
  assert.throws(() => f.open({ authorityFactory: faultFactory(() => {}, observed),
    mirrorWriterFactory() { throw new Error('mirror factory stopped'); } }), /mirror factory stopped/);
  assert.equal(observed.open, 0);
});

test('landed COMMIT errors require a real counter-only FULL commit preserving business and mirror identity', t => {
  const f = fixture(t); let armed = false, landed = false, proofCommits = 0, committedRow;
  const repo = f.open({ mirrorWriterFactory: () => ({ write() { throw new Error('mirror remains pending'); } }), authorityFactory: faultFactory(event => {
    if (armed && event.filePath === f.database && event.type === 'after' && event.sql === 'COMMIT') {
      armed = false; landed = true; committedRow = raw(f, db => ({ ...db.prepare('SELECT * FROM config_snapshot').get() })); throw new Error('lost commit response');
    }
    if (landed && event.filePath === f.database && event.type === 'after' && event.sql === 'COMMIT') proofCommits++;
  }) });
  const revision = repo.revision(); armed = true;
  repo.update(draft => { draft.count = 2; draft.aiCollaboration = { receipts: [{ receiptId: 'receipt', appliedRevision: revision + 1 }], outbox: [{ id: 'event' }] }; });
  const after = raw(f, db => ({ ...db.prepare('SELECT * FROM config_snapshot').get() }));
  assert.equal(proofCommits, 1); assert.equal(after.verification_count, committedRow.verification_count + 1);
  assert.deepEqual({ ...after, verification_count: committedRow.verification_count }, committedRow);
  assert.equal(repo.revision(), revision + 1);
});

test('failed post-error proof stays unknown, and restart needs a fresh successful proof before exposure', t => {
  const f = fixture(t); let armed = false, landed = false;
  const repo = f.open({ authorityFactory: faultFactory(event => {
    if (armed && event.filePath === f.database && event.type === 'after' && event.sql === 'COMMIT') { armed = false; landed = true; throw new Error('landed response failure'); }
    if (landed && event.filePath === f.database && event.type === 'before' && event.sql === 'COMMIT') throw new Error('proof flush failed');
  }) });
  const revision = repo.revision(); armed = true;
  assert.throws(() => repo.update(draft => { draft.count = 2; }), /outcome-unknown/);
  assert.equal(repo.authoritativeWrites.status().available, false); repo.close();
  const landedCounter = raw(f, db => db.prepare('SELECT verification_count FROM config_snapshot').get().verification_count);
  const observed = { open: 0 };
  assert.throws(() => f.open({ authorityFactory: faultFactory(event => {
    if (event.filePath === f.database && event.type === 'before' && event.sql === 'COMMIT') throw new Error('restart flush failed');
  }, observed) }), /outcome-unknown/); assert.equal(observed.open, 0);
  const recovered = f.open(); assert.equal(recovered.get('count'), 2); assert.equal(recovered.revision(), revision + 1);
  assert.equal(raw(f, db => db.prepare('SELECT verification_count FROM config_snapshot').get().verification_count), landedCounter + 1);
});

test('initial import COMMIT error cannot publish READY until the same snapshot gets a successful FULL proof', t => {
  for (const denyProof of [false, true]) {
    const f = fixture(t); let first = true, landed = false;
    const open = () => f.open({ authorityFactory: faultFactory(event => {
      if (event.filePath === f.database && event.type === 'after' && event.sql === 'COMMIT' && first) { first = false; landed = true; throw new Error('initial response failed'); }
      if (denyProof && landed && event.filePath === f.database && event.type === 'before' && event.sql === 'COMMIT') throw new Error('initial proof failed');
    }) });
    if (denyProof) {
      assert.throws(open, /outcome-unknown/);
      const marker = new DatabaseSync(f.identity, { readOnly: true });
      assert.equal(marker.prepare('SELECT phase FROM config_identity').get().phase, 'INITIALIZING'); marker.close();
      assert.equal(f.open().get('count'), 1);
    } else { const repo = open(); assert.equal(repo.get('count'), 1); assert.equal(repo.revision(), 0); }
    assert.equal(raw(f, db => db.prepare('SELECT verification_count FROM config_snapshot').get().verification_count), 1);
  }
});

test('startup rejects future payload and unknown drift before proof writes, and counter maximum never overflows', t => {
  for (const kind of ['future-payload', 'current-drift', 'maximum']) {
    const f = fixture(t); f.open().close();
    if (kind === 'future-payload') f.open({ schemaVersion: 17, normalize: normalize(17) }).close();
    if (kind === 'maximum') raw(f, db => db.prepare('UPDATE config_snapshot SET verification_count=?').run(Number.MAX_SAFE_INTEGER));
    const bytes = fs.readFileSync(f.database), originalMirror = fs.readFileSync(f.mirror); let writes = 0;
    const authorityFactory = faultFactory(event => { if (event.type === 'open' && event.filePath === f.database && !event.readOnly) writes++; });
    const options = kind === 'current-drift' ? { normalize: value => ({ ...value, unexpected: true }), authorityFactory } : { authorityFactory };
    assert.throws(() => f.open(options), /future-schema|failed validation|outcome-unknown/);
    assert.equal(writes, 0); assert.deepEqual(fs.readFileSync(f.database), bytes); assert.deepEqual(fs.readFileSync(f.mirror), originalMirror);
  }
});
