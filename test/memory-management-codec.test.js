'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { routeFor, allowedSurfacesFor, validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const input = () => ({ kind: 'preference', subject: '主题', body: '内容', scope: 'work', expiresAt: null, privacyLevel: 'standard' });
const hash = 'a'.repeat(64);
const methods = Object.freeze({ listMemories: 'memory:list', previewMemoryChange: 'memory:change-preview', confirmMemoryChange: 'memory:change-confirm',
  previewMemoryUndo: 'memory:undo-preview', getMemoryReceipt: 'memory:receipt', cancelMemoryChange: 'memory:change-cancel', previewMemoryProposal: 'memory:proposal-preview' });
const decode = (name, payload) => validateIpcPayload(methods[name], payload);

test('versioned memory routes have one guidance owner and popover-only surface authority', () => {
  for (const channel of Object.values(methods)) {
    const route = routeFor(channel); assert.equal(route.capability, 'guidance');
    assert.deepEqual(allowedSurfacesFor(channel), ['popover']);
    assert.equal(route.kind, ['memory:list', 'memory:receipt'].includes(channel) ? 'query' : 'command');
  }
});

test('list is bounded and closed with optional explicit status and stable ID cursor', () => {
  assert.deepEqual(decode('listMemories'), { ok: true, value: {} });
  assert.equal(decode('listMemories', { status: 'removed', limit: 100, cursor: 'memory-20' }).ok, true);
  for (const bad of [{ status: 'all' }, { limit: 101 }, { limit: 0 }, { cursor: '../private' }, { fields: ['body'] }, { sql: 'SELECT *' }, []]) {
    assert.equal(decode('listMemories', bad).ok, false, JSON.stringify(bad));
  }
});

test('memory mutation candidates use a closed grammar and cannot supply provenance or confirmation proof', () => {
  assert.equal(decode('previewMemoryChange', { operation: 'add', expectedVersion: null, input: input() }).ok, true);
  assert.equal(decode('previewMemoryChange', { operation: 'update', targetId: 'm1', expectedVersion: 2, input: input(), resolution: 'reject' }).ok, true);
  for (const operation of ['activate', 'pause', 'remove', 'restore', 'permanent-remove']) assert.equal(decode('previewMemoryChange', { operation, targetId: 'm1', expectedVersion: 3 }).ok, true);
  for (const field of ['sourceType', 'source', 'sourceRefs', 'confirmedAt', 'confidence', 'contextAllowed', 'id', 'version']) {
    assert.equal(decode('previewMemoryChange', { operation: 'add', input: { ...input(), [field]: true } }).ok, false, field);
  }
  for (const bad of [
    { operation: 'undo', targetId: 'm1', expectedVersion: 1 },
    { operation: 'add', targetId: 'm1', input: input() },
    { operation: 'update', targetId: 'm1', input: input() },
    { operation: 'pause', targetId: 'm1', expectedVersion: 0 },
    { operation: 'pause', targetId: 'm1', expectedVersion: 1, input: input() },
    { operation: 'add', input: input(), confirmed: true },
    { operation: 'add', input: { ...input(), body: '字'.repeat(501) } },
    { operation: 'add', input: input(), resolution: 'replace-any' }
  ]) assert.equal(decode('previewMemoryChange', bad).ok, false, JSON.stringify(bad));
  const getter = {}; Object.defineProperty(getter, 'operation', { enumerable: true, get() { assert.fail('getters must never be executed'); } });
  assert.equal(decode('previewMemoryChange', getter).ok, false);
  assert.equal(decode('previewMemoryChange', { operation: 'add', input: input(), [Symbol('proof')]: true }).ok, false);
});

test('confirmation binds exact preview hash/version while undo, receipt and cancel accept only identities', () => {
  assert.equal(decode('confirmMemoryChange', { previewId: 'p1', previewHash: hash, expectedVersion: null }).ok, true);
  for (const bad of [{ previewId: 'p1', previewHash: hash }, { previewId: 'p1', previewHash: 'bad', expectedVersion: 2 },
    { previewId: 'p1', previewHash: hash, expectedVersion: 2, operation: 'permanent-remove' }]) assert.equal(decode('confirmMemoryChange', bad).ok, false);
  for (const name of ['previewMemoryUndo', 'getMemoryReceipt']) {
    assert.equal(decode(name, { receiptId: 'r1' }).ok, true);
    assert.equal(decode(name, { receiptId: 'r1', memoryId: 'm1' }).ok, false);
  }
  assert.equal(decode('cancelMemoryChange', { previewId: 'p1' }).ok, true);
  assert.equal(decode('previewMemoryProposal', { conversationId: 'c1', proposalId: 'p1' }).ok, true);
  assert.equal(decode('previewMemoryProposal', { conversationId: 'c1', proposalId: 'p1', body: input() }).ok, false);
});

test('chat candidate edits allow only bounded editable fields and an exact replacement preview identity', () => {
  const request = { conversationId: 'c1', proposalId: 'p1', input: input(), replacePreviewId: 'preview-old' };
  assert.deepEqual(decode('previewMemoryProposal', request), { ok: true, value: request });
  for (const field of ['sourceType', 'sourceRefs', 'confirmedAt', 'status', 'validFrom', 'id', 'version', 'confidence']) {
    assert.equal(decode('previewMemoryProposal', { ...request, input: { ...input(), [field]: true } }).ok, false, field);
  }
  for (const edit of [{ ...input(), body: '字'.repeat(501) }, { ...input(), subject: '字'.repeat(201) },
    { ...input(), scope: 'team' }, { ...input(), expiresAt: -1 }, { kind: 'preference', subject: '少字段', body: '内容' }]) {
    assert.equal(decode('previewMemoryProposal', { ...request, input: edit }).ok, false);
  }
  assert.equal(decode('previewMemoryProposal', { ...request, replacePreviewId: '../other' }).ok, false);
  const accessor = { ...input() }; Object.defineProperty(accessor, 'body', { enumerable: true, get() { assert.fail('must not read accessor'); } });
  assert.equal(decode('previewMemoryProposal', { ...request, input: accessor }).ok, false);
});

test('production preload and scoped client forward memory payloads to only named reviewed routes', async () => {
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload-popover.js'), 'utf8'), {
    require(name) { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(key, value) { assert.equal(key, 'focuspix'); bridge = value; } },
      ipcRenderer: { invoke: async (channel, payload) => ({ channel, payload }), on() {}, removeListener() {} } }; }
  });
  const client = createPopoverSurfaceClient(bridge);
  for (const [method, channel] of Object.entries(methods)) {
    const payload = method === 'listMemories' ? { status: 'active', limit: 20 } : { id: 'fixture' };
    assert.deepEqual(await client[method](payload), { channel, payload });
  }
  assert.equal(client.invoke, undefined); assert.equal(client.ipcRenderer, undefined);
});
