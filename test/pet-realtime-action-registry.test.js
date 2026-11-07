'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = () => import('../src/surfaces/pet/realtime/runtime/action-registry.mjs');

test('one descriptor coordinates body, expression, accessory, prop and particle channels', async () => {
  const { createActionRegistry } = await load();
  const r = createActionRegistry();
  r.register({ id: 'sip-tea', durationMs: 2400, views: ['front', 'three-quarter'],
    channels: { body: { clip: 'sip' }, expression: { expression: 'life.content' }, accessory: { mode: 'keep' },
      prop: { id: 'cup', socket: 'hand.r' }, particle: { effect: 'steam', max: 2 } } });
  const p = r.plan('sip-tea', { view: 'front' });
  assert.equal(p.ok, true);
  assert.deepEqual(p.tracks.map(t => t.channel), ['body', 'expression', 'accessory', 'prop', 'particle']);
  assert.equal(r.interrupts('sip-tea', 'pointer'), true);
  assert.deepEqual(r.plan('sip-tea', { view: 'back' }), { ok: false, reason: 'view-unsupported', fallback: 'front' });
});
test('invalid descriptors fail closed', async () => {
  const { createActionRegistry } = await load();
  const r = createActionRegistry();
  assert.throws(() => r.register({ id: 'x', durationMs: 1, channels: {} }), /body is required/);
  assert.throws(() => r.register({ id: 'x', durationMs: 1, channels: { body: { clip: 'a' }, sound: {} } }), /unknown channel/);
  assert.throws(() => r.register({ id: 'x', durationMs: 1, channels: { body: { clip: 'a' }, prop: { id: 'cup', socket: 'tail' } } }), /prop track invalid/);
  assert.throws(() => r.register({ id: 'x', durationMs: 1, channels: { body: { clip: 'a' }, particle: { effect: 'e', max: 9 } } }), /particle/);
  assert.throws(() => r.register({ id: 'x', durationMs: 0, channels: { body: { clip: 'a' } } }), /durationMs/);
  r.register({ id: 'x', durationMs: 1, channels: { body: { clip: 'a' } } });
  assert.throws(() => r.register({ id: 'x', durationMs: 1, channels: { body: { clip: 'a' } } }), /already/);
  assert.equal(r.plan('nope').reason, 'unknown-action');
});
test('new channels are added by registration, before actions', async () => {
  const { createActionRegistry } = await load();
  const r = createActionRegistry();
  r.registerChannel('sound', { validate: t => typeof t.cue === 'string' });
  r.register({ id: 'wave', durationMs: 900, channels: { body: { clip: 'wave' }, sound: { cue: 'chime' } } });
  assert.deepEqual(r.plan('wave').tracks.map(t => t.channel), ['body', 'sound']);
  assert.throws(() => r.registerChannel('haptic', { validate: () => true }), /before actions/);
});
test('only the runtime backend module references research/ from production JS', () => {
  const root = path.join(__dirname, '../src');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const hits = walk(root).filter(f => /\.(m?js|cjs)$/.test(f) && /research\/animation/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(root, f).split(path.sep).join('/'));
  assert.deepEqual(hits, ['surfaces/pet/realtime/runtime/actor-backend.mjs']);
});
