'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { interfacePreferences, normalizeSettings, settingsPatch } = require('../src/capabilities/preferences');
const { validateIpcPayload, assertIpcPayload, allowedSurfacesFor } = require('../src/application/ipc');
const { createRendererIpcRegistrar } = require('../src/bootstrap/renderer-ipc');
const { createInterfacePresentationHost } = require('../src/platform/electron/interface-presentation');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { fixture, NOW } = require('../test-support/config-admission-fixture');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createUpdatePreferencesWorkflow } = require('../src/application/workflows/update-preferences');

test('interface enum defaults, locale negotiation and closed settings admission', () => {
  assert.deepEqual(interfacePreferences.projectInterfacePreferences({}), { locale: 'system', theme: 'system' });
  for (const [languages, expected] of [[['zh-Hans-CN'], 'zh-CN'], [['en-GB'], 'en'], [['fr', 'zh-TW'], 'zh-CN'], [[], 'en']]) {
    assert.equal(interfacePreferences.resolveLocale('system', languages), expected);
    assert.equal(interfacePreferences.resolveLocale('en', languages), 'en');
  }
  for (const locale of ['system', 'zh-CN', 'en']) for (const theme of ['system', 'light', 'dark']) {
    assert.equal(validateIpcPayload('settings:update', { locale, theme }).ok, true);
    assert.equal(settingsPatch.validatePatch({ locale, theme }, normalizeSettings({})).ok, true);
  }
  for (const patch of [{ locale: 'fr' }, { theme: 'auto' }, { locale: null }, { theme: true }, { locale: 'en', secret: 'no' }]) {
    assert.equal(validateIpcPayload('settings:update', patch).ok, false);
    assert.equal(settingsPatch.validatePatch(patch, normalizeSettings({})).ok, false);
  }
});

test('canonical preferences workflow commits one revision and survives reopening with unrelated data unchanged', t => {
  const f = fixture(t), repo = f.open();
  const before = repo.snapshot(), revision = repo.revision(), effects = [];
  const workflow = createUpdatePreferencesWorkflow({ unitOfWork: createUnitOfWork({ repository: repo }),
    clock: { now: () => NOW }, publish: fact => effects.push(fact) });
  const result = workflow.execute({ patch: { locale: 'en', theme: 'light' } });
  assert.equal(result.ok, true); assert.equal(repo.revision(), revision + 1);
  const expected = structuredClone(before); expected.settings.locale = 'en'; expected.settings.theme = 'light';
  assert.deepEqual(repo.snapshot(), expected); assert.equal(effects.length, 1); repo.close();
  const reopened = createSqliteStateAdapter({ userDataPath: f.directory, now: () => NOW });
  assert.deepEqual(reopened.snapshot(), expected); reopened.close();
});

function ipcFixture() {
  const handlers = new Map(), applied = [];
  let settings = { locale: 'zh-CN', theme: 'system', aiBaseUrl: 'private', tasks: ['private'] };
  const register = createRendererIpcRegistrar({ rendererDirectory: '/fixture/renderer',
    ipcHost: { handle: (name, handler) => handlers.set(name, handler) }, allowedSurfacesFor, assertIpcPayload,
    readTasks: () => [], getSettings: () => settings,
    interfaceHost: { languages: () => ['en-US'], apply: snapshot => applied.push(snapshot) } });
  const event = page => ({ senderFrame: { url: pathToFileURL(path.join('/fixture/renderer', `${page}.html`)).href } });
  return { handlers, applied, register, event, edit: patch => { settings = { ...settings, ...patch }; } };
}
test('all five surfaces can read only presentation fields; writes stay popover-only and payload is closed', async () => {
  const f = ipcFixture(), read = f.handlers.get('settings:get-interface');
  f.register('settings:update', () => ({ ok: true }));
  for (const page of ['popover', 'impulse', 'pet', 'nudge-corner', 'nudge-fullscreen']) {
    assert.deepEqual(await read(f.event(page)), { locale: 'zh-CN', theme: 'system', resolvedLocale: 'zh-CN', revision: 1 });
    await assert.rejects(read(f.event(page), { anything: true }));
    if (page !== 'popover') await assert.rejects(f.handlers.get('settings:update')(f.event(page), { theme: 'dark' }));
  }
  await assert.rejects(read(f.event('unknown')));
});
test('presentation publishes only after a successful canonical update, and a delivery failure cannot undo success', async () => {
  const f = ipcFixture(); let ok = false;
  f.register('settings:update', (_event, patch) => { if (ok) f.edit(patch); return { ok }; });
  const invoke = patch => f.handlers.get('settings:update')(f.event('popover'), patch);
  await invoke({ theme: 'dark' }); assert.equal(f.applied.length, 1);
  ok = true; await invoke({ theme: 'dark' }); assert.equal(f.applied.at(-1).theme, 'dark');
  await invoke({ locale: 'en' }); assert.equal(f.applied.at(-1).resolvedLocale, 'en');
  const count = f.applied.length; await invoke({ dnd: true }); assert.equal(f.applied.length, count);
});
test('Electron host changes process-wide theme and broadcasts the narrow projection to all live windows', () => {
  const nativeTheme = {}, sent = [];
  const window = id => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel, data) => sent.push({ id, channel, data }) } });
  const host = createInterfacePresentationHost({ nativeTheme, app: { getPreferredSystemLanguages: () => ['en'] },
    BrowserWindow: { getAllWindows: () => [window('panel'), { isDestroyed: () => true }, window('pet'),
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send() { throw Error('closed'); } } }, window('quick')] } });
  for (const theme of ['dark', 'light', 'system']) {
    const snapshot = { theme, locale: 'en', resolvedLocale: 'en', revision: 4 };
    host.apply(snapshot); assert.equal(nativeTheme.themeSource, theme);
  }
  assert.equal(sent.length, 9); assert.equal(sent.at(-1).id, 'quick');
  assert.equal(sent.at(-1).channel, 'settings:interface-changed');
});

test('system language refocus reconciles native and every window without a settings write', () => {
  const { createInterfacePreferencesRuntime } = require('../src/bootstrap/interface-preferences');
  const applied = []; let languages = ['en-US'];
  const settings = Object.freeze({ locale: 'system', theme: 'system' });
  const runtime = createInterfacePreferencesRuntime({ getSettings: () => settings,
    host: { languages: () => languages, apply: snapshot => applied.push(snapshot) } });
  assert.equal(runtime.read().resolvedLocale, 'en'); assert.equal(applied.length, 1);
  languages = ['zh-CN']; const next = runtime.read();
  assert.equal(next.resolvedLocale, 'zh-CN'); assert.equal(next.revision, 2);
  assert.deepEqual(applied.at(-1), next); assert.equal(runtime.read().revision, 2);
  assert.deepEqual(settings, { locale: 'system', theme: 'system' });
});

test('OS-language projection failure after commit preserves success and a later read recovers presentation', async () => {
  const handlers = new Map(), applied = []; let fail = false, commits = 0;
  let settings = { locale: 'zh-CN', theme: 'light' };
  const register = createRendererIpcRegistrar({ rendererDirectory: '/fixture/renderer',
    ipcHost: { handle: (name, handler) => handlers.set(name, handler) }, allowedSurfacesFor, assertIpcPayload,
    readTasks: () => [], getSettings: () => settings,
    interfaceHost: { languages() { if (fail) throw Error('OS language unavailable'); return ['en']; }, apply: next => applied.push(next) } });
  register('settings:update', (_event, patch) => { settings = { ...settings, ...patch }; commits++; fail = true; return { ok: true }; });
  const event = { senderFrame: { url: pathToFileURL(path.join('/fixture/renderer', 'popover.html')).href } };
  assert.deepEqual(await handlers.get('settings:update')(event, { locale: 'en' }), { ok: true });
  assert.equal(commits, 1); assert.equal(settings.locale, 'en');
  fail = false;
  assert.equal((await handlers.get('settings:get-interface')(event)).resolvedLocale, 'en');
  assert.equal(applied.at(-1).resolvedLocale, 'en'); assert.equal(commits, 1);
});
