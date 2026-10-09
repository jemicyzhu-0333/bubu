'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
const { createRendererIpcRegistrar } = require('../src/bootstrap/renderer-ipc');
const { registerProcessLifecycle } = require('../src/bootstrap/process-lifecycle');
const { createPowerHost } = require('../src/platform/electron/power');
const { createLifecycleRegistry } = require('../src/bootstrap/lifecycle');
const { createUpdatePreferencesWorkflow } = require('../src/application');
const { assertIpcPayload, allowedSurfacesFor } = require('../src/application/ipc');
const { runtimeFixture, START } = require('../test-support/meal-runtime-fixture');

test('extracted real renderer registrar preserves URL allowlists, closed payloads and contextual admission', async () => {
  const handlers = new Map();
  const rendererDirectory = path.resolve('/synthetic/renderer');
  const popoverUrl = pathToFileURL(path.join(rendererDirectory, 'popover.html')).href;
  const register = createRendererIpcRegistrar({ rendererDirectory,
    ipcHost: { handle: (name, handler) => handlers.set(name, handler) }, allowedSurfacesFor, assertIpcPayload,
    readTasks: () => [], getSettings: () => ({}) });
  register('settings:update', (_event, patch) => patch);
  const invoke = handlers.get('settings:update'), event = url => ({ senderFrame: { url } });
  assert.deepEqual(await invoke(event(popoverUrl), { aiPetMealsEnabled: true }), { aiPetMealsEnabled: true });
  for (const url of ['https://synthetic/renderer/popover.html', pathToFileURL(path.join(rendererDirectory, 'pet.html')).href, pathToFileURL(path.resolve('/other/popover.html')).href, 'not a url']) {
    await assert.rejects(invoke(event(url), { aiPetMealsEnabled: true }), /not allowed/);
  }
  await assert.rejects(invoke(event(popoverUrl), { aiPetMealsEnabled: true, unknown: 'private' }));
  register('unregistered:route', () => assert.fail('unknown route admitted'));
  await assert.rejects(handlers.get('unregistered:route')(event(popoverUrl), {}), /not allowed/);
});

test('meal and session interruptions share exactly one real power-host subscription', async () => {
  const f = runtimeFixture({ enabled: false }); f.edit(s => { s.pet.satiation = 90; }); await f.runtime.tick();
  const monitor = new EventEmitter(), lifecycle = createLifecycleRegistry(), calls = [];
  const process = registerProcessLifecycle({ lifecycle, mealRuntime: f.runtime,
    appHost: { subscribeLifecycle: () => () => {} }, powerHost: createPowerHost({ powerMonitor: monitor }),
    isSessionRunning: () => true, pauseActiveSessionForInterruption: () => calls.push('pause'),
    setScreenLocked: value => calls.push(value), resumeAfterInterruption: () => calls.push('resume'), activatePrimaryWindow() {} });
  process.startPowerMonitoring(); assert.equal(monitor.listenerCount('suspend'), 1);
  monitor.emit('suspend'); f.time(START + 120000); await f.runtime.tick(); assert.equal(f.read().pet.satiation, 90);
  monitor.emit('resume'); await f.runtime.tick(); assert.equal(f.read().pet.satiation, 90);
  monitor.emit('lock-screen'); monitor.emit('unlock-screen'); f.time(START + 300000); await f.runtime.tick();
  assert.equal(f.read().pet.satiation, 90); assert.deepEqual(calls, ['pause', 'resume', true, false]);
  lifecycle.dispose(); assert.equal(monitor.listenerCount('suspend'), 0);
});
function collaborationFixture(f, { failCredential = false } = {}) {
  const handlers = new Map(); let ids = 0;
  const credentials = { status: () => ({ configured: true }), get: () => 'synthetic-secret',
    set: () => { if (failCredential) throw new Error('failed credential'); return true; },
    clear: () => { if (failCredential) throw new Error('failed credential'); return true; } };
  const collaboration = createAiCollaboration({ requestScope: f.requestScope, readSnapshot: f.read,
    storage: { ownerId: 'synthetic-owner', close() {} }, credentialStore: credentials, getSettings: () => f.read().settings,
    now: f.now, idFactory: kind => `${kind}-${++ids}`, onProviderChanged: f.runtime.invalidateAdvice,
    clientFactory: () => ({ endpoint: 'https://example.test/v1', run: async () => null }) });
  collaboration.register((name, handler) => handlers.set(name, handler), { updatePreferencesCommand:
    createUpdatePreferencesWorkflow({ unitOfWork: f.unitOfWork, clock: f.clock, publish: fact => f.runtime.settingsChanged(fact.changedKeys) }) });
  return { handlers, collaboration };
}
for (const route of ['ai:credential-import', 'ai:clear-credential']) {
  test(`${route} clears an accepted meal plan only after successful credential operation`, async () => {
    for (const failCredential of [false, true]) {
      const f = runtimeFixture({ makeClient: () => ({ run: async (_name, _payload, options) => {
        options.beforeRequest(); return { foodId: 'berry', waitMinutes: 10, reactionIndex: 0 };
      } }) });
      await f.runtime.tick(); const { handlers, collaboration } = collaborationFixture(f, { failCredential });
      const result = handlers.get(route)({}, { secret: 'synthetic-new-key' });
      assert.equal(result.ok, !failCredential); assert.equal(Boolean(f.read().pet.care.plan), failCredential);
      assert.equal(f.read().pet.care.aiCalls, 1); assert.equal(f.read().pet.foodInventory.berry, 2); collaboration.dispose();
    }
  });
}
test('meal-only setting route cancels shared leases without clearing conversation grants', async () => {
  const f = runtimeFixture(); f.edit(s => { s.settings.aiClarifyEnabled = true; });
  const { handlers, collaboration } = collaborationFixture(f);
  const opened = collaboration.start({ purpose: 'task', mode: 'talk', retentionMode: 'ephemeral' });
  assert.equal(opened.ok, true); const provider = collaboration.getProvider(), lease = f.requestScope.begin();
  assert.equal(handlers.get('settings:update')({}, { aiPetMealsEnabled: false }).ok, true);
  assert.equal(lease.signal.aborted, true);
  assert.equal(collaboration.grants.resolve({ conversationId: opened.conversation.id, scopeGrantId: opened.scopeGrantId,
    providerId: provider.fingerprint, authorizationGeneration: 0 }).ok, true);
  collaboration.dispose();
});
