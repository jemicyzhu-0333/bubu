'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiConfiguration } = require('../src/surfaces/popover/features/ai-configuration.mjs');
const { createAiConnectionTest } = require('../src/surfaces/popover/features/ai-connection-test.mjs');
const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
function harness(overrides = {}) {
  const elements = new Map(), listeners = new Map(), calls = [], cancellations = [];
  const document = { hidden: false, addEventListener: (kind, fn) => listeners.set(kind, fn),
    removeEventListener: kind => listeners.delete(kind) };
  const $ = id => {
    if (!elements.has(id)) {
      const handlers = new Map();
      elements.set(id, { value: '', textContent: '', dataset: {}, disabled: false,
        setAttribute() {}, addEventListener: (kind, fn) => handlers.set(kind, fn),
        removeEventListener: kind => handlers.delete(kind), fire: kind => handlers.get(kind)?.({}) });
    }
    return elements.get(id);
  };
  const state = { settings: { aiModel: 'saved-model', aiBaseUrl: 'https://example.com/v1' }, ai: { enabled: false } };
  const client = { testAiConnection: async value => { calls.push({ ...value }); return { ok: true, durationMs: 12 }; },
    cancelAiConnectionTest: async id => { cancellations.push(id); }, updateSettings: async () => ({ ok: true }),
    saveAiCredential: async () => ({ ok: true }), ...overrides };
  const feature = createAiConfiguration({ $, document, getState: () => state, surfaceClient: client });
  const input = (id, value) => { $(id).value = value; $(id).fire('input'); };
  feature.mount(); feature.render();
  return { $, document, listeners, calls, cancellations, state, feature, input, client };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('manual test uses unsaved drafts without persisting or clearing them; status stays separate from Save', async () => {
  setLocale('zh-CN');
  let writes = 0;
  const h = harness({ updateSettings: async () => { writes++; return { ok: true }; },
    saveAiCredential: async () => { writes++; return { ok: true }; } });
  h.input('#aiModelInput', 'draft-model'); h.input('#aiApiKeyInput', 'synthetic-draft-key');
  h.$('#aiTestConnection').fire('click'); await turn();
  assert.equal(writes, 0); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].model, 'draft-model'); assert.equal(h.calls[0].secret, 'synthetic-draft-key');
  assert.equal(h.$('#aiApiKeyInput').value, 'synthetic-draft-key');
  assert.equal(h.$('#aiConfigStatus').dataset.state, 'dirty');
  assert.equal(h.$('#aiConnectionTestStatus').dataset.state, 'success');
  assert.match(h.$('#aiConnectionTestStatus').textContent, /连接成功/);
  h.feature.dispose();
});

test('second pending click cancels once without duplicate network test; late success is ignored', async () => {
  let resolve, sends = 0;
  const h = harness({ testAiConnection: () => { sends++; return new Promise(done => { resolve = done; }); } });
  h.$('#aiTestConnection').fire('click');
  assert.equal(h.$('#aiTestConnection').textContent, '取消测试');
  h.$('#aiTestConnection').fire('click');
  assert.equal(sends, 1); assert.equal(h.cancellations.length, 1);
  resolve({ ok: true, durationMs: 1 }); await turn();
  assert.equal(h.$('#aiConnectionTestStatus').textContent, '测试已取消');
  h.feature.dispose();
});

test('editing a field retires pending result; new test owns feedback while old completion is ignored', async () => {
  const resolvers = [];
  const h = harness({ testAiConnection: value => { h.calls.push({ ...value }); return new Promise(done => resolvers.push(done)); } });
  h.$('#aiTestConnection').fire('click');
  h.input('#aiModelInput', 'new-model');
  assert.equal(h.cancellations.length, 1);
  h.$('#aiTestConnection').fire('click');
  assert.notEqual(h.calls[0].requestId, h.calls[1].requestId);
  resolvers[0]({ ok: true, durationMs: 1 }); await turn();
  assert.equal(h.$('#aiConnectionTestStatus').dataset.state, 'testing');
  resolvers[1]({ ok: false, reason: 'authentication', httpStatus: 401 }); await turn();
  assert.equal(h.$('#aiConnectionTestStatus').textContent, '密钥认证失败 · HTTP 401');
  assert.equal(h.$('#aiModelInput').value, 'new-model');
  h.feature.dispose();
});

test('closing settings, hiding window and disposing retire pending results without discarding drafts', async () => {
  for (const kind of ['close', 'hidden', 'dispose']) {
    let resolve;
    const h = harness({ testAiConnection: () => new Promise(done => { resolve = done; }) });
    h.input('#aiModelInput', 'keep-this'); h.$('#aiTestConnection').fire('click');
    if (kind === 'close') h.feature.cancelTest();
    else if (kind === 'hidden') { h.document.hidden = true; h.listeners.get('visibilitychange')(); }
    else h.feature.dispose();
    resolve({ ok: true, durationMs: 3 }); await turn();
    assert.equal(h.cancellations.length, 1);
    assert.equal(h.$('#aiModelInput').value, 'keep-this');
    assert.equal(h.$('#aiConnectionTestStatus').textContent, '');
    h.feature.dispose();
  }
});

test('save cancels an in-flight test and the test action stays disabled until the save finishes', async () => {
  let testResolve, saveResolve;
  const h = harness({ testAiConnection: () => new Promise(done => { testResolve = done; }),
    updateSettings: () => new Promise(done => { saveResolve = done; }) });
  h.$('#aiTestConnection').fire('click');
  const saving = h.feature.save();
  assert.equal(h.cancellations.length, 1);
  assert.equal(h.$('#aiTestConnection').disabled, true);
  testResolve({ ok: true, durationMs: 1 }); saveResolve({ ok: true }); await saving; await turn();
  assert.equal(h.$('#aiTestConnection').disabled, false);
  assert.equal(h.$('#aiConnectionTestStatus').textContent, '');
  h.feature.dispose();
});

test('arbitrary IPC error/body text cannot enter the DOM; classified HTTP status remains useful', async () => {
  const h = harness({ testAiConnection: async () => { throw new Error('synthetic-secret provider body'); } });
  h.$('#aiTestConnection').fire('click'); await turn();
  assert.equal(h.$('#aiConnectionTestStatus').textContent, '测试失败，请检查配置与网络');
  assert.equal(h.$('#aiConnectionTestStatus').textContent.includes('synthetic'), false);
  h.feature.dispose();
});

test('separate feature instances cannot reuse a cancellation request identity', async () => {
  const ids = [];
  for (let index = 0; index < 2; index++) {
    const h = harness({ testAiConnection: async draft => { ids.push(draft.requestId); return { ok: true, durationMs: 0 }; } });
    h.$('#aiTestConnection').fire('click'); await turn(); h.feature.dispose();
  }
  assert.notEqual(ids[0], ids[1]);
});

test('empty model has an actionable local error without contacting the main process', async () => {
  const h = harness();
  h.input('#aiModelInput', ''); h.$('#aiTestConnection').fire('click'); await turn();
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('#aiConnectionTestStatus').textContent, '模型名称无效');
  h.feature.dispose();
});
