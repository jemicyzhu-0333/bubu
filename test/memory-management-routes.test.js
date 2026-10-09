'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcRoutes } = require('../src/capabilities/guidance');
const { createSqlMemoryRepository } = require('../src/platform/persistence/sqlite/memory-repository');

function routeFor(channel) {
  return ipcRoutes.find(route => route.channel === channel) || null;
}

test('memory:* are guidance routes scoped to the popover with the right command/query split', () => {
  const list = routeFor('memory:list');
  const forget = routeFor('memory:forget');
  const clear = routeFor('memory:clear');
  const remember = routeFor('memory:remember');
  for (const route of [list, forget, clear, remember]) {
    assert.ok(route, 'memory route must be declared by guidance');
    assert.equal(route.capability, 'guidance');
    assert.deepEqual([...route.surfaces], ['popover']);
  }
  // Reading the list is a query; forgetting one, clearing all and confirming a
  // new memory mutate, so they are commands (ARCHITECTURE「事实流与长期记忆」).
  assert.equal(list.kind, 'query');
  assert.equal(forget.kind, 'command');
  assert.equal(clear.kind, 'command');
  assert.equal(remember.kind, 'command');
});

test('memory:remember accepts a confirmable kind and rejects everything off-shape', () => {
  const remember = routeFor('memory:remember');
  const good = remember.decode({ kind: 'preference', subject: '安静的下午', body: '下午两点后不安排会议。' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value, { kind: 'preference', subject: '安静的下午', body: '下午两点后不安排会议。' });
  // source/confidence/expiresAt are the domain's to set, never the payload's, so
  // the codec must not even accept them as fields (ARCHITECTURE「事实流与长期记忆」).
  assert.equal(remember.decode({ kind: 'preference', subject: 's', body: 'b', source: 'user-confirmed' }).ok, false);
  assert.equal(remember.decode({ kind: 'nope', subject: 's', body: 'b' }).ok, false);
  assert.equal(remember.decode({ kind: 'preference', subject: '', body: 'b' }).ok, false);
  assert.equal(remember.decode({ kind: 'preference', subject: 's' }).ok, false);
});

test('legacy forget/clear retain closed compatibility shapes and list uses versioned management filters', () => {
  assert.equal(routeFor('memory:forget').decode({ memoryId: 'm-1' }).ok, true);
  assert.equal(routeFor('memory:forget').decode({}).ok, false);
  assert.equal(routeFor('memory:forget').decode({ memoryId: 'm-1', extra: 1 }).ok, false);
  assert.deepEqual(routeFor('memory:list').decode(undefined), { ok: true, value: {} });
  assert.deepEqual(routeFor('memory:list').decode({ status: 'paused', limit: 20, cursor: null }), { ok: true, value: { status: 'paused', limit: 20, cursor: null } });
  assert.deepEqual(routeFor('memory:clear').decode(undefined), { ok: true, value: undefined });
  assert.equal(routeFor('memory:clear').decode({ any: true }).ok, false);
});

test('memory list/forget/clear return legal results and never throw when the store errors', () => {
  // The fact store swallows its own errors and degrades (ARCHITECTURE「事实流与长期记忆」): a broken handle
  // — the same shape a tier="none" no-op store presents to a handler — must yield
  // a legal result, so memory management can never block focus timing or task ops.
  const throwing = {
    run() { throw new Error('store down'); },
    get() { throw new Error('store down'); },
    all() { throw new Error('store down'); }
  };
  const repo = createSqlMemoryRepository({ handle: throwing, timeline: null, now: () => 0, logger: () => {} });
  assert.deepEqual(repo.list(), []);
  assert.deepEqual(repo.forget('m-1'), { ok: false, removed: 0, reason: 'memory-authority-cutover' });
  assert.deepEqual(repo.clear(), { ok: false, removed: 0, reason: 'memory-authority-cutover' });
});
