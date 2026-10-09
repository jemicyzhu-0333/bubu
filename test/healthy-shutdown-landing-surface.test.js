'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const app = require('../src/application');
const execution = require('../src/capabilities/execution');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { localDayKey } = require('../src/core/calendar');
const { SKINS } = require('../src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = require('../src/pet-content');
const { createPopoverQuickStartLanding } = require('../src/surfaces/popover/features/quick-start-landing.mjs');
const { dom, element } = require('../test-support/manual-growth-dom');
const MINUTE = 60_000;
function fixture(t, taskId = 'linked') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-shutdown-surface-'));
  let now = new Date(2026, 9, 7, 12, 0).getTime(), sequence = 0, repository;
  const open = () => createSqliteStateAdapter({ userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => now,
    authorityFactory: options => openSqliteConfigAuthority(options, {
      selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
      makeHandle: ({ db, filePath }) => ({
        exec: sql => db.exec(sql), run: (sql, args = []) => db.prepare(sql).run(...args),
        get: (sql, args = []) => db.prepare(sql).get(...args), all: (sql, args = []) => db.prepare(sql).all(...args),
        userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
        setUserVersion: value => db.exec(`PRAGMA user_version=${value}`), close: () => db.close()
      })
    }) });
  repository = open();
  t.after(() => { repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  repository.commit(normalizePersistedState({ ...repository.snapshot(), tasks: taskId
    ? [{ id: taskId, title: 'Synthetic original task', nextAction: 'Open the draft', createdAt: now - 1000 }] : [] }, { now }), { now });
  const ports = () => ({ unitOfWork: app.createUnitOfWork({ repository }), clock: { now: () => now, dayKey: localDayKey },
    sessionClock: { now: () => now }, idFactory: prefix => `${prefix}-${++sequence}` });
  const project = () => app.createPopoverStateQuery({ readSnapshot: repository.snapshot, readRevision: repository.revision,
    clock: { now: () => now, dayKey: localDayKey }, skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({}), schemaVersion: PERSISTED_SCHEMA_VERSION }).execute();
  return { get repository() { return repository; }, get now() { return now; }, ports, project,
    tick: amount => { now += amount; },
    start() { assert.equal(app.createStartFocusSessionWorkflow(ports()).execute({ taskId, minutes: 5 }).ok, true); return repository.snapshot().focusSession.sessionId; },
    shutdown() { assert.equal(app.createAcceptHealthyShutdownWorkflow(ports()).execute({ dayKey: localDayKey(now) }).ok, true); },
    reopen() { const before = repository.snapshot(); repository.close(); repository = open(); assert.deepEqual(repository.snapshot(), before); },
    mutate(change) { const state = repository.snapshot(); change(state); repository.commit(state, { now }); }
  };
}
function landing(t, initial, submit = async () => ({ ok: true })) {
  const { $, document } = dom(); let projection = initial;
  const skip = element('skip'), save = element('save'); skip.dataset.focusLanding = 'skip'; save.dataset.focusLanding = 'save';
  $('#quickStartMask').classList.add('hidden'); $('#quickStartMask').querySelectorAll = () => [skip, save];
  $('#quickStartMask').querySelector = () => skip; $('#focusLandingActions').querySelector = () => save;
  const feature = createPopoverQuickStartLanding({ document, $, $$: selector => selector.includes('data-focus-landing') ? [skip, save] : [],
    getState: () => projection, getSession: () => projection.pomodoro, modalRegistry: { isOpen: () => false, isAnyOpen: () => false },
    landingBlockingModals: [], canReceiveFocus: () => false, focusActionMessage: value => value,
    surfaceClient: { resolveFocusLanding: submit } });
  feature.mount(); feature.render(); t.after(() => feature.dispose());
  return { $, skip, save, feature, show(next) { projection = next; feature.render(); } };
}
function assertShutdownView(ui) {
  assert.equal(ui.$('#quickStartTitle').textContent, '收工前，给下次留个入口');
  assert.match(ui.$('#landingDescription').textContent, /这不是一次完成结算/);
  assert.doesNotMatch(ui.$('#landingDescription').textContent, /上一轮已经结束/);
}
for (const taskId of ['linked', null]) for (const alreadyPaused of [false, true]) {
  test(`real shutdown→SQLite→query→DOM is truthful for ${taskId || 'free'} ${alreadyPaused ? 'already paused' : 'early active'} focus, including reopen`, t => {
    const h = fixture(t, taskId), sessionId = h.start(); h.tick(MINUTE);
    if (alreadyPaused) assert.equal(execution.pauseSession.createPauseSessionCommand(h.ports()).execute().ok, true);
    h.shutdown();
    const saved = h.repository.snapshot(), revision = h.repository.revision();
    assert.equal(saved.focusSession.status, 'paused'); assert.equal(saved.focusSession.sessionId, sessionId);
    assert.equal(saved.focusLandingPrompt.sessionId, sessionId); assert.equal(saved.focusLandingPrompt.taskId, taskId);
    assert.equal(saved.stats.totalPomodoros, 0); assert.equal(Object.hasOwn(saved.focusLandingPrompt, 'healthyShutdown'), false);
    const projection = h.project(); assert.equal(projection.focusLandingPrompt.healthyShutdown, true);
    assert.equal(projection.focusLandingPrompt.taskEditable, taskId !== null);
    assertShutdownView(landing(t, projection)); assert.deepEqual(h.repository.snapshot(), saved); assert.equal(h.repository.revision(), revision);
    h.reopen(); const reopened = h.project(); assert.equal(reopened.focusLandingPrompt.healthyShutdown, true);
    assertShutdownView(landing(t, reopened)); assert.deepEqual(h.repository.snapshot(), saved);
  });
}
for (const shutdown of [false, true]) test(`actually completed ${shutdown ? 'due shutdown' : 'ordinary focus'} keeps neutral truthful landing presentation`, t => {
  const h = fixture(t), sessionId = h.start(); h.tick(5 * MINUTE);
  if (shutdown) h.shutdown(); else assert.equal(app.createCompleteDueSessionWorkflow(h.ports()).execute().completed, true);
  h.reopen(); const state = h.repository.snapshot(), projection = h.project();
  assert.equal(state.stats.totalPomodoros, 1); assert.equal(state.focusSession.status, 'idle');
  assert.equal(projection.focusLandingPrompt.sessionId, sessionId); assert.equal(projection.focusLandingPrompt.healthyShutdown, false);
  const ui = landing(t, projection); assert.match(ui.$('#quickStartTitle').textContent, /给下一次留个入口/);
  assert.doesNotMatch(ui.$('#landingDescription').textContent, /这不是一次完成结算/);
});
test('an unrelated older landing is not relabelled when a different current session pauses for shutdown', t => {
  const h = fixture(t); h.start(); h.tick(MINUTE);
  h.mutate(state => { state.focusLandingPrompt = { sessionId: 'previous-completed-session', taskId: 'linked', completedAt: h.now - 10 * MINUTE, status: 'pending' }; });
  h.shutdown(); h.reopen(); const projection = h.project();
  assert.equal(projection.focusLandingPrompt.sessionId, 'previous-completed-session');
  assert.equal(projection.focusLandingPrompt.healthyShutdown, false);
  assert.match(landing(t, projection).$('#quickStartTitle').textContent, /给下一次留个入口/);
});
test('a completed session with a shutdown-looking ID is classified from canonical state, not its spelling', t => {
  const h = fixture(t); h.start(); h.tick(5 * MINUTE);
  assert.equal(app.createCompleteDueSessionWorkflow(h.ports()).execute().completed, true);
  h.mutate(state => { state.focusLandingPrompt.sessionId = 'shutdown-not-a-shutdown'; });
  assert.match(landing(t, h.project()).$('#quickStartTitle').textContent, /给下一次留个入口/);
});
test('a stale shutdown response cannot overwrite a replacement completed landing or its pending controls', async t => {
  const old = fixture(t), current = fixture(t, null); old.start(); old.tick(MINUTE); old.shutdown();
  current.start(); current.tick(5 * MINUTE); assert.equal(app.createCompleteDueSessionWorkflow(current.ports()).execute().completed, true);
  current.mutate(state => { state.focusLandingPrompt.sessionId = 'different-current-session'; });
  const resolvers = []; const sent = [];
  const ui = landing(t, old.project(), request => { sent.push(request); return new Promise(resolve => resolvers.push(resolve)); });
  assertShutdownView(ui); await ui.skip.emit('click');
  ui.show(current.project()); ui.$('#landingProgressMade').checked = true; await ui.skip.emit('click');
  ui.$('#quickStartError').textContent = 'new receipt still pending';
  resolvers[0]({ ok: false, reason: 'old rejected' }); await new Promise(setImmediate);
  assert.match(ui.$('#quickStartTitle').textContent, /给下一次留个入口/); assert.equal(ui.$('#quickStartError').textContent, 'new receipt still pending');
  assert.equal(ui.$('#landingProgressMade').checked, true); assert.equal(ui.skip.disabled, true);
  assert.equal(sent[0].progressMade, false); assert.equal(sent[1].sessionId, 'different-current-session');
  resolvers[1]({ ok: true }); await new Promise(setImmediate); assert.equal(ui.skip.disabled, false);
});

for (const taskId of ['linked', null]) for (const action of ['resume', 'stop']) {
  test(`unfinished shutdown landing stays truthful after ${action} for ${taskId || 'free'} original session`, t => {
    const h = fixture(t, taskId), sessionId = h.start(); h.tick(MINUTE); h.shutdown(); h.reopen();
    const prompt = h.repository.snapshot().focusLandingPrompt;
    const result = action === 'resume'
      ? app.createResumeFocusSessionWorkflow(h.ports()).execute({ sessionId, intent: 'resume' })
      : app.createStopFocusSessionWorkflow(h.ports()).execute({ sessionId });
    assert.equal(result.ok, true);
    const saved = h.repository.snapshot(); assert.deepEqual(saved.focusLandingPrompt, prompt);
    assert.equal(saved.stats.totalPomodoros, 0); assert.equal(saved.focusSession.status, action === 'resume' ? 'focus' : 'idle');
    const projection = h.project(); assert.equal(projection.focusLandingPrompt.healthyShutdown, false);
    assert.equal(projection.focusLandingPrompt.sessionId, sessionId); assert.equal(projection.focusLandingPrompt.taskId, taskId);
    const ui = landing(t, projection);
    assert.equal(ui.$('#quickStartTitle').textContent, '给下一次留个入口');
    assert.doesNotMatch(ui.$('#landingDescription').textContent, /完成|已经结束/);
    h.reopen(); assert.deepEqual(h.repository.snapshot().focusLandingPrompt, prompt);
    assert.equal(landing(t, h.project()).$('#quickStartTitle').textContent, '给下一次留个入口');
  });
}
