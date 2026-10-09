'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openMemoryAuthority } = require('../src/bootstrap/memory-authority');
const { eventCalendar } = require('../src/application/workflows/apply-ai-change-set');
const at = Date.UTC(2026, 9, 4, 1);

test('memory timeline preserves committed local day and offset through delayed delivery, timezone change and replay', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-time-calendar-'));
  let serial = 0, zone = 'America/Los_Angeles';
  const store = openDatabase({ filePath: path.join(directory, 'facts.sqlite'), driver: 'node:sqlite', now: () => at });
  const authority = openMemoryAuthority({ factStore: store, storage: { ownerId: 'calendar-owner', identityAvailable: true },
    userDataPath: directory, now: () => at, idFactory: kind => `${kind}-${++serial}`,
    timeContextFor: time => eventCalendar(time, zone) });
  try {
    const p = authority.service.preview({ operation: 'add', input: { kind: 'preference', subject: 'fixture', body: 'fixture' } }).preview;
    const applied = authority.service.confirm({ previewId: p.previewId, previewHash: p.previewHash, expectedVersion: null });
    assert.equal(applied.ok, true, applied.reason);
    assert.equal(authority.service.outbox().items[0].localDayKey, '2026-10-03');
    zone = 'Asia/Shanghai';
    assert.equal(authority.drain().ok, true);
    const rows = store.timeline.queryRange({ fromDayKey: '2026-10-03', toDayKey: '2026-10-03' }).items;
    assert.equal(rows.length, 1); assert.equal(rows[0].timezone, 'America/Los_Angeles');
    assert.equal(rows[0].utcOffsetMinutes, -420); assert.equal(rows[0].localDayKey, '2026-10-03');
    assert.equal(store.timeline.queryRange({ fromDayKey: '2026-10-04', toDayKey: '2026-10-04' }).items.length, 0);
    assert.equal(authority.drain().delivered, 0);
  } finally { authority.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
