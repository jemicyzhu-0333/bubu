'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { drawActionParticle, LOCAL_EFFECTS } = require('../src/core/pet-action-particles.mjs');
const { EFFECT_RENDER_TYPES } = require('../src/core/pet-effect-visuals.mjs');
globalThis.Path2D = class { constructor(d) { this.d = d; } };
test.after(() => { delete globalThis.Path2D; });
const recorder = () => { const calls = []; return { calls, globalAlpha: 1, save() {}, restore() {}, translate() {}, scale() {},
 fill(p) { calls.push(['fill', p.d]); }, stroke(p) { calls.push(['stroke', p.d]); },
 fillText(...args) { calls.push(['text', ...args]); }, fillRect(...args) { calls.push(['rect', ...args]); }, strokeRect(...args) { calls.push(['rect', ...args]); } }; };

test('every registered particle has a native soft brush without falling back to square cells', () => {
  for (const type of EFFECT_RENDER_TYPES) {
    const context = recorder(), particle = { type, x: 10, y: 20, vx: 1, vy: -1, size: 4, life: 30, baseLife: 46, color: '#aabbcc' };
    const before = { ...particle };
    assert.equal(drawActionParticle(context, particle, { soft: true }), true, type);
    assert.ok(context.calls.length > 0, type);
    assert.ok(context.calls.every(([kind]) => kind !== 'rect'), type);
    assert.deepEqual(particle, before, 'painting cannot advance particle timing or physics');
  }
});
test('native cup and ground effects are not duplicated by floating ambient particles', () => {
  for (const [actionId, effect] of Object.entries(LOCAL_EFFECTS)) {
    const context = recorder();
    assert.equal(drawActionParticle(context, { actionId, effect, type: 'bubble', x: 0, y: 0, life: 30 }, { soft: true }), true);
    assert.deepEqual(context.calls, []);
  }
  const old = recorder(); drawActionParticle(old, { type: 'puff', x: 0, y: 0, life: 30 });
  assert.equal(old.calls[0][0], 'rect', 'the existing Usagi brush is unaffected');
});
