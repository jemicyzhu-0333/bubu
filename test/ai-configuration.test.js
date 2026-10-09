'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiConfiguration } = require('../src/surfaces/popover/features/ai-configuration.mjs');

function harness(overrides = {}) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      const handlers = new Map();
      elements.set(id, {
        value: '', textContent: '', dataset: {}, disabled: false,
        addEventListener: (type, fn) => handlers.set(type, fn),
        removeEventListener: type => handlers.delete(type),
        fire: type => handlers.get(type)?.({ key: 'Enter', preventDefault() {} })
      });
    }
    return elements.get(id);
  };
  const state = { settings: { aiModel: 'old', aiBaseUrl: '' }, ai: { enabled: false } };
  const calls = [];
  const client = {
    updateSettings: async patch => { calls.push(patch); return { ok: true }; },
    saveAiCredential: async secret => { calls.push({ secret }); return { ok: true }; },
    ...overrides
  };
  const feature = createAiConfiguration({ $, getState: () => state, surfaceClient: client });
  feature.mount(); feature.render();
  const input = (id, value) => { $(id).value = value; $(id).fire('input'); };
  return { $, state, calls, feature, input };
}

test('AI draft survives projections; explicit save waits for persistence and does not resurrect an old model', async () => {
  let resolve;
  const h = harness({ updateSettings: () => new Promise(done => { resolve = done; }) });
  h.input('#aiModelInput', 'new');
  h.feature.render();
  assert.equal(h.$('#aiModelInput').value, 'new');
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'dirty');
  const pending = h.feature.save();
  assert.equal(h.$('#aiSaveConfig').disabled, true);
  resolve({ ok: true }); await pending;
  assert.equal(h.$('#aiModelInput').value, 'new', 'receipt can precede projection delivery');
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'saved');
  h.state.settings.aiModel = 'new'; h.feature.render();
  h.state.settings.aiModel = 'external'; h.feature.render();
  assert.equal(h.$('#aiModelInput').value, 'external', 'acknowledged projection releases the local value');
  h.feature.dispose();
});

test('editing while save is in flight retains the new model and secret for the next explicit save', async () => {
  let resolve;
  const h = harness({ updateSettings: () => new Promise(done => { resolve = done; }) });
  h.input('#aiModelInput', 'first'); h.input('#aiApiKeyInput', 'first-test-secret');
  const pending = h.feature.save();
  h.input('#aiModelInput', 'second'); h.input('#aiApiKeyInput', 'second-test-secret');
  resolve({ ok: true }); await pending;
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'dirty');
  assert.equal(h.$('#aiModelInput').value, 'second');
  assert.equal(h.$('#aiApiKeyInput').value, 'second-test-secret');
  assert.deepEqual(h.calls, [{ secret: 'first-test-secret' }]);
  h.feature.dispose();
});

test('canonical URL returned by settings replaces the draft without getting stuck on its original spelling', async () => {
  const h = harness({ updateSettings: async () => ({ ok: true, settings: {
    aiModel: 'new', aiBaseUrl: 'https://example.com/v1'
  } }) });
  h.input('#aiModelInput', 'new');
  h.input('#aiBaseUrlInput', 'https://example.com/v1/responses');
  await h.feature.save();
  assert.equal(h.$('#aiBaseUrlInput').value, 'https://example.com/v1');
  h.state.settings = { aiModel: 'new', aiBaseUrl: 'https://example.com/v1' }; h.feature.render();
  h.state.settings.aiBaseUrl = 'https://example.org/v1'; h.feature.render();
  assert.equal(h.$('#aiBaseUrlInput').value, 'https://example.org/v1');
  h.feature.dispose();
});

test('rejected settings never write a credential; projection updates preserve the failure feedback', async () => {
  const h = harness({ updateSettings: async () => ({ ok: false }) });
  h.input('#aiModelInput', 'invalid'); h.input('#aiApiKeyInput', 'test-secret');
  await h.feature.save(); h.feature.render();
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'error');
  assert.equal(h.$('#aiModelInput').value, 'invalid');
  assert.equal(h.$('#aiApiKeyInput').value, 'test-secret');
  h.feature.dispose();
});

test('credential storage failure reports partial persistence and clears the submitted secret', async () => {
  const h = harness({ saveAiCredential: async () => ({ ok: false }) });
  h.input('#aiModelInput', 'new'); h.input('#aiApiKeyInput', 'test-secret');
  await h.feature.save();
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'error');
  assert.match(h.$('#aiConfigStatus').textContent, /配置已保存，密钥未保存/);
  assert.equal(h.$('#aiApiKeyInput').value, '');
  assert.equal(h.$('#aiModelInput').value, 'new');
  h.feature.dispose();
});

test('disposing during a save does not update the detached interface', async () => {
  let resolve;
  const h = harness({ updateSettings: () => new Promise(done => { resolve = done; }) });
  h.input('#aiModelInput', 'new');
  const pending = h.feature.save();
  h.feature.dispose();
  resolve({ ok: true }); await pending;
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'saving');
});
