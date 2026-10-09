'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { LATEST_USER_VERSION } = require('../src/platform/persistence/sqlite/migrations');
const {
  scoreMemory, capMemories, memoryUniqueKey, normalizeSubject, buildRecentActivityDigest
} = require('../src/platform/persistence/sqlite/memory-rules');

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const tempDirs = [];

// Tests never touch the real user directory (AGENTS.md): everything lives in a
// throwaway mkdtemp under the OS temp root.
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `im-adhder-${label}-`));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// A tier is only exercised if it is usable on the current test runtime. tier 2
// (better-sqlite3) is not a dependency, so it is skipped rather than failed.
function tierUsable(driver) {
  try {
    const dir = tempDir(`probe-${driver}`);
    const store = openDatabase({ filePath: path.join(dir, 'probe.sqlite'), driver, logger: () => {} });
    const usable = store.tier === driver;
    store.close();
    return usable;
  } catch (_) {
    return false;
  }
}

function makeStore(driver) {
  const dir = tempDir(driver);
  const store = openDatabase({ filePath: path.join(dir, 'facts.sqlite'), driver, now: () => NOW, logger: () => {} });
  return store;
}

// ── The one contract every tier must satisfy identically ──────────────────────
// node:sqlite, better-sqlite3 and the JSONL fallback all run these exact
// assertions; the upper layers must not be able to tell which tier answered.
function assertRepositoryContract(driver) {
  test(`[${driver}] timeline append is idempotent by id (first write wins)`, () => {
    const store = makeStore(driver);
    assert.deepEqual(store.timeline.append({ id: 'e1', occurredAt: 10, dayKey: '2026-09-10', kind: 'focus.completed' }), { ok: true, inserted: true });
    assert.deepEqual(store.timeline.append({ id: 'e1', occurredAt: 99, dayKey: '2026-09-10', kind: 'task.completed' }), { ok: true, inserted: false });
    const rows = store.timeline.readDay('2026-09-10');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'focus.completed'); // the ignored duplicate did not overwrite
    store.close();
  });

  test(`[${driver}] timeline readRange is ascending and excludes out-of-window days`, () => {
    const store = makeStore(driver);
    store.timeline.append({ id: 'b', occurredAt: 20, dayKey: '2026-09-11', kind: 'focus.completed' });
    store.timeline.append({ id: 'a', occurredAt: 5, dayKey: '2026-09-11', kind: 'focus.completed' });
    store.timeline.append({ id: 'z', occurredAt: 1, dayKey: '2026-09-20', kind: 'focus.completed' });
    const rows = store.timeline.readRange({ fromDayKey: '2026-09-10', toDayKey: '2026-09-12' });
    assert.deepEqual(rows.map(event => event.id), ['a', 'b']);
    store.close();
  });

  test(`[${driver}] prune removes strictly older days and keeps the boundary day`, () => {
    const store = makeStore(driver);
    store.timeline.append({ id: 'old', occurredAt: 1, dayKey: '2026-09-01', kind: 'focus.completed' });
    store.timeline.append({ id: 'edge', occurredAt: 2, dayKey: '2026-09-10', kind: 'focus.completed' });
    store.timeline.append({ id: 'new', occurredAt: 3, dayKey: '2026-09-15', kind: 'focus.completed' });
    store.timeline.prune({ before: '2026-09-10' });
    const rows = store.timeline.readRange({ fromDayKey: '2026-01-01', toDayKey: '2026-12-31' });
    assert.deepEqual(rows.map(event => event.id), ['edge', 'new']);
    store.close();
  });

  // The only retraction this store allows, and only by exact id. ARCHITECTURE「日常与能量」 requires an
  // undone routine tap to leave nothing behind, so the row has to actually go —
  // on every tier, including the one that stores days as append-only text files.
  test(`[${driver}] remove deletes exactly the named row and nothing adjacent`, () => {
    const store = makeStore(driver);
    store.timeline.append({ id: 'keep-a', occurredAt: 1, dayKey: '2026-09-10', kind: 'routine.logged' });
    store.timeline.append({ id: 'drop', occurredAt: 2, dayKey: '2026-09-10', kind: 'routine.logged' });
    store.timeline.append({ id: 'keep-b', occurredAt: 3, dayKey: '2026-09-11', kind: 'routine.logged' });

    assert.deepEqual(store.timeline.remove('drop'), { ok: true, removed: 1 });
    assert.deepEqual(store.timeline.readDay('2026-09-10').map(event => event.id), ['keep-a']);
    assert.deepEqual(store.timeline.readDay('2026-09-11').map(event => event.id), ['keep-b']);

    // Removing twice is not an error: the undo already committed, and the caller
    // swallows the result either way.
    assert.deepEqual(store.timeline.remove('drop'), { ok: true, removed: 0 });
    assert.equal(store.timeline.remove('never-existed').removed, 0);
    assert.equal(store.timeline.remove('').ok, false);

    // Emptying a day removes the day, and the day can be written again afterwards
    // (the JSONL tier deletes the file and caches its ids — both must reset).
    assert.equal(store.timeline.remove('keep-a').removed, 1);
    assert.deepEqual(store.timeline.readDay('2026-09-10'), []);
    store.timeline.append({ id: 'again', occurredAt: 4, dayKey: '2026-09-10', kind: 'routine.logged' });
    assert.deepEqual(store.timeline.readDay('2026-09-10').map(event => event.id), ['again']);
    store.close();
  });

  test(`[${driver}] memory upsert updates in place on unique_key, never appends a duplicate`, () => {
    const store = makeStore(driver);
    assert.equal(store.memories.upsert({ kind: 'rhythm', subject: 'Focus window', body: 'first', source: 'aggregated', confidence: 0.5 }).ok, true);
    assert.equal(store.memories.upsert({ kind: 'rhythm', subject: 'focus  window', body: 'second', source: 'aggregated', confidence: 0.9 }).ok, true);
    const list = store.memories.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].body, 'second');
    assert.equal(list[0].confidence, 0.9);
    store.close();
  });

  test(`[${driver}] memory upsert rejects the model as a source and unknown kinds`, () => {
    const store = makeStore(driver);
    assert.equal(store.memories.upsert({ kind: 'rhythm', subject: 's', body: 'b', source: 'model', confidence: 1 }).ok, false);
    assert.equal(store.memories.upsert({ kind: 'invented', subject: 's', body: 'b', source: 'aggregated', confidence: 1 }).ok, false);
    assert.equal(store.memories.list().length, 0);
    store.close();
  });

  test(`[${driver}] forget and clear remove entries`, () => {
    const store = makeStore(driver);
    const created = store.memories.upsert({ kind: 'context', subject: 'Project X', body: 'ships Friday', source: 'user-confirmed', confidence: 1 });
    assert.equal(store.memories.forget(created.id).removed, 1);
    assert.equal(store.memories.list().length, 0);
    store.memories.upsert({ kind: 'context', subject: 'Y', body: 'b', source: 'user-confirmed', confidence: 1 });
    assert.equal(store.memories.clear().removed, 1);
    assert.equal(store.memories.list().length, 0);
    store.close();
  });

  test(`[${driver}] a user-confirmed upsert persists with no expiry and shows up in the list`, () => {
    const store = makeStore(driver);
    // The shape the memory:remember handler produces via confirmMemory: source is
    // fixed to user-confirmed, confidence to 1, expiry to null (ARCHITECTURE「事实流与长期记忆」 — a fact the
    // user stated never expires). It must round-trip through the store unchanged.
    const created = store.memories.upsert({ kind: 'preference', subject: '安静的下午', body: '下午两点后不排会议。', source: 'user-confirmed', confidence: 1, expiresAt: null });
    assert.equal(created.ok, true);
    const listed = store.memories.list();
    assert.equal(listed.length, 1);
    const row = listed[0];
    assert.equal(row.source, 'user-confirmed');
    assert.equal(row.expiresAt, null);
    // Re-confirming the same kind+subject replaces rather than accretes.
    store.memories.upsert({ kind: 'preference', subject: '安静的下午', body: '改成三点。', source: 'user-confirmed', confidence: 1, expiresAt: null });
    assert.equal(store.memories.list().length, 1);
    store.close();
  });

  test(`[${driver}] selectMemories enforces both the count cap and the char budget`, () => {
    const store = makeStore(driver);
    const body = 'x'.repeat(100);
    for (let i = 0; i < 12; i += 1) {
      store.memories.upsert({ kind: 'preference', subject: `s${i}`, body, source: 'aggregated', confidence: 0.5 });
    }
    assert.equal(store.memories.selectMemories({ now: NOW, limit: 8, charBudget: 100000 }).memories.length, 8);
    // 100-char bodies against a 250 budget: first two fit, the third would exceed.
    assert.equal(store.memories.selectMemories({ now: NOW, limit: 8, charBudget: 250 }).memories.length, 2);
    store.close();
  });

  test(`[${driver}] disclosure lists exactly the memory ids that were returned`, () => {
    const store = makeStore(driver);
    store.memories.upsert({ kind: 'friction', subject: 'admin', body: 'takes 3 tries', source: 'aggregated', confidence: 0.7 });
    const result = store.memories.selectMemories({ now: NOW });
    assert.deepEqual(result.disclosure.memoryIds, result.memories.map(memory => memory.id));
    store.close();
  });

  test(`[${driver}] recentActivityDigest returns an all-zero shape (not null) with no events`, () => {
    const store = makeStore(driver);
    const digest = store.memories.recentActivityDigest({ now: NOW, days: 7 });
    assert.equal(digest.focusMinutes, 0);
    assert.equal(digest.sessionCount, 0);
    assert.deepEqual(digest.topTasks, []);
    assert.deepEqual(digest.frictionSignals, []);
    assert.equal(digest.streakDays, 0);
    assert.deepEqual(digest.disclosure.fields.includes('focusMinutes'), true);
    store.close();
  });

  test(`[${driver}] recentActivityDigest sums focus minutes and top tasks from events`, () => {
    const store = makeStore(driver);
    store.timeline.append({ id: 'f1', occurredAt: NOW - 3600000, dayKey: '2026-09-18', kind: 'focus.completed', durationMs: 1500000, taskId: 't1', payload: { title: 'Write' } });
    store.timeline.append({ id: 'f2', occurredAt: NOW - 1800000, dayKey: '2026-09-18', kind: 'focus.completed', durationMs: 600000, taskId: 't1', payload: { title: 'Write' } });
    store.timeline.append({ id: 'c1', occurredAt: NOW - 600000, dayKey: '2026-09-18', kind: 'task.completed', taskId: 't1', payload: { title: 'Write' } });
    const digest = store.memories.recentActivityDigest({ now: NOW, days: 7 });
    assert.equal(digest.focusMinutes, 35);
    assert.equal(digest.sessionCount, 2);
    assert.equal(digest.completedTaskCount, 1);
    assert.deepEqual(digest.topTasks[0], { title: 'Write', focusMinutes: 35, completed: true });
    store.close();
  });

  test(`[${driver}] a store failure never throws to the caller`, () => {
    const store = makeStore(driver);
    // Invalid events/entries are rejected, not thrown.
    assert.doesNotThrow(() => store.timeline.append(null));
    assert.doesNotThrow(() => store.memories.upsert(undefined));
    assert.equal(store.timeline.append({ id: '' }).ok, false);
    store.close();
  });
}

// Tier 1 (node:sqlite): verified available on the real runtime (Electron 44) and
// on this test runtime. Tier 3 (JSONL) always runs. Tier 2 is skipped unless the
// optional native driver is installed and loads.
assertRepositoryContract('jsonl');

if (tierUsable('node:sqlite')) {
  assertRepositoryContract('node:sqlite');
} else {
  test('[node:sqlite] tier skipped: require(node:sqlite) unavailable on this runtime', { skip: true }, () => {});
}

if (tierUsable('better-sqlite3')) {
  assertRepositoryContract('better-sqlite3');
} else {
  test('[better-sqlite3] tier skipped: optional native driver not installed', { skip: true }, () => {});
}

// ── SQL-tier specifics (guarded by node:sqlite availability) ──────────────────
const sqlDriver = tierUsable('node:sqlite') ? 'node:sqlite' : null;

test('sql tier persists WAL journal mode and the migrated user_version', { skip: sqlDriver ? false : 'node:sqlite unavailable' }, () => {
  const dir = tempDir('sql-pragmas');
  const filePath = path.join(dir, 'facts.sqlite');
  const store = openDatabase({ filePath, driver: sqlDriver, now: () => NOW, logger: () => {} });
  assert.equal(store.tier, 'node:sqlite');
  assert.equal(store.healthy, true);
  assert.equal(store.userVersion, LATEST_USER_VERSION);
  store.close();

  // Black-box: reopen the file directly and confirm the persisted header.
  const sqlite = require('node:sqlite');
  const raw = new sqlite.DatabaseSync(filePath);
  assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, LATEST_USER_VERSION);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables.includes('timeline_events') && tables.includes('agent_memories'), true);
  raw.close();
});

test('sql tier migration is idempotent across reopens', { skip: sqlDriver ? false : 'node:sqlite unavailable' }, () => {
  const dir = tempDir('sql-idempotent');
  const filePath = path.join(dir, 'facts.sqlite');
  const first = openDatabase({ filePath, driver: sqlDriver, now: () => NOW, logger: () => {} });
  first.memories.upsert({ kind: 'pattern', subject: 'kept', body: 'survives reopen', source: 'user-confirmed', confidence: 1 });
  first.close();
  const second = openDatabase({ filePath, driver: sqlDriver, now: () => NOW, logger: () => {} });
  assert.equal(second.userVersion, LATEST_USER_VERSION);
  assert.equal(second.memories.list().length, 1); // data intact, tables not recreated
  second.close();
});

test('sql tier preserves corrupt authority bytes and reports unavailable without empty fallback', { skip: sqlDriver ? false : 'node:sqlite unavailable' }, () => {
  const dir = tempDir('sql-corrupt');
  const filePath = path.join(dir, 'facts.sqlite');
  const original = Buffer.from('definitely not a sqlite database');
  fs.writeFileSync(filePath, original);
  const store = openDatabase({ filePath, driver: sqlDriver, now: () => NOW });
  assert.equal(store.healthy, false);
  assert.equal(store.tier, 'none');
  assert.equal(store.timeline.queryRange({ fromDayKey: '2026-09-18', toDayKey: '2026-09-18' }).availability, 'unavailable');
  assert.equal(store.timeline.supportsConfirmedChanges, false);
  assert.deepEqual(fs.readFileSync(filePath), original);
  assert.deepEqual(fs.readdirSync(dir), ['facts.sqlite']);
  store.close();
});

// ── Pure rules shared by every tier ───────────────────────────────────────────
test('capMemories evicts lowest-scored first and never evicts unexpired user-confirmed', () => {
  const memories = [];
  for (let i = 0; i < 12; i += 1) {
    memories.push({ id: `agg${i}`, source: 'aggregated', kind: 'rhythm', confidence: 0.1 + i / 100, updatedAt: NOW, useCount: 0, expiresAt: null });
  }
  memories.push({ id: 'user1', source: 'user-confirmed', kind: 'preference', confidence: 0.01, updatedAt: NOW, useCount: 0, expiresAt: null });
  const evicted = capMemories(memories, { limit: 10, now: NOW });
  assert.equal(evicted.length, 3);
  assert.equal(evicted.includes('user1'), false); // protected despite lowest confidence
  assert.equal(evicted.includes('agg0'), true); // lowest-scored aggregated goes first
});

test('scoreMemory rewards confidence, recency and use, with a recency floor', () => {
  const fresh = scoreMemory({ confidence: 1, updatedAt: NOW, useCount: 0, kind: 'rhythm' }, NOW);
  const ancient = scoreMemory({ confidence: 1, updatedAt: NOW - 365 * 24 * 3600000, useCount: 0, kind: 'rhythm' }, NOW);
  assert.ok(fresh > ancient);
  assert.ok(ancient >= 0.2 * 1); // recency floor keeps old but confident memory in play
  const used = scoreMemory({ confidence: 1, updatedAt: NOW, useCount: 10, kind: 'rhythm' }, NOW);
  assert.ok(used > fresh);
});

test('memoryUniqueKey folds subject case and whitespace so the same fact collides', () => {
  assert.equal(memoryUniqueKey('rhythm', '  Focus   Window '), memoryUniqueKey('rhythm', 'focus window'));
  assert.equal(normalizeSubject('  A  B '), 'a b');
});

test('buildRecentActivityDigest is deterministic and self-consistent for friction counts', () => {
  const events = [
    { kind: 'task.stuck', taskId: 't1', dayKey: '2026-09-18' },
    { kind: 'task.stuck', taskId: 't2', dayKey: '2026-09-18' },
    { kind: 'task.avoided', taskId: 't1', dayKey: '2026-09-18' }
  ];
  const digest = buildRecentActivityDigest(events, { fromDayKey: '2026-09-12', toDayKey: '2026-09-18' });
  const stuck = digest.frictionSignals.find(signal => signal.kind === 'task.stuck');
  assert.equal(stuck.count, 2);
});

test('an unusable logger costs the trace, never the tier', () => {
  // Tracing runs inside the tier loop, so a non-callable logger would throw,
  // read as "tier-failed", and walk every tier down to the empty no-op store —
  // total loss of history from a caller-side slip, which ARCHITECTURE「事实流与长期记忆」 forbids.
  const store = openDatabase({ filePath: ':memory:', logger: { info() {}, warn() {} } });
  assert.notEqual(store.tier, 'none');
  assert.equal(store.healthy, true);
  store.close();
});

// 专注时长记在 session.segment 上；session.completed 只是一个没有时长的点。
// 只读点事件时，“最近一周专注了多少”永远是 0。
test('the digest reads focused time from session segments and names tasks on this machine', () => {
  const events = [
    { kind: 'session.segment', sessionId: 's1', taskId: 't1', dayKey: '2026-09-18', durationMs: 20 * 60000 },
    { kind: 'session.segment', sessionId: 's1', taskId: 't1', dayKey: '2026-09-18', durationMs: 5 * 60000 },
    { kind: 'session.completed', sessionId: 's1', taskId: 't1', dayKey: '2026-09-18' },
    { kind: 'session.segment', sessionId: 's2', taskId: 't-gone', dayKey: '2026-09-17', durationMs: 40 * 60000 },
    { kind: 'task.completed', taskId: 't1', dayKey: '2026-09-18' }
  ];
  const titles = { t1: '写周报' };
  const digest = buildRecentActivityDigest(events, {
    fromDayKey: '2026-09-12', toDayKey: '2026-09-18', resolveTaskTitle: id => titles[id] || null
  });
  assert.equal(digest.focusMinutes, 65);
  assert.equal(digest.sessionCount, 2, 'segments of one session count once');
  assert.equal(digest.streakDays, 2);
  assert.deepEqual(digest.topTasks, [{ title: '写周报', focusMinutes: 25, completed: true }],
    'a task that cannot be named on this machine is not sent as its id');
  const unnamed = buildRecentActivityDigest(events, { fromDayKey: '2026-09-12', toDayKey: '2026-09-18' });
  assert.deepEqual(unnamed.topTasks, []);
  assert.ok(!JSON.stringify(unnamed).includes('t-gone'));
});
