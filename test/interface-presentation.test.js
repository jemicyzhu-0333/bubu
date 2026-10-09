'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterfacePresentation } = require('../src/surfaces/shared/interface/presentation.mjs');
const { createInterfaceSettings } = require('../src/surfaces/popover/features/interface-settings.mjs');
const { setLocale, t, getLocale, resolveLocale, localizeDocument } = require('../src/surfaces/shared/interface/i18n.mjs');
const { interfacePreferences } = require('../src/capabilities/preferences');
const { panelPalette } = require('../src/surfaces/popover/ui/panel-palette.mjs');
const { contrastRatio } = require('../src/surfaces/popover/ui/theme-appearance.mjs');
function element(value = '') {
  const events = new Map(), attributes = {};
  return { value, disabled: false, checked: false, textContent: '', dataset: {}, childNodes: [],
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
    fire: name => events.get(name)?.(), setAttribute: (name, value) => { attributes[name] = value; }, getAttribute: name => attributes[name] };
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function view(surface = 'popover') {
  const styles = {}, events = new Map(), changes = new Set(); let handler;
  const query = { matches: true, addEventListener: (_name, fn) => changes.add(fn), removeEventListener: (_name, fn) => changes.delete(fn) };
  const root = { dataset: {}, style: { setProperty: (name, value) => { styles[name] = value; } } };
  const document = { documentElement: root, body: { dataset: { surface } }, querySelectorAll: () => [] };
  const window = { matchMedia: () => query, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const client = { subscribe: fn => { handler = fn; return () => { handler = null; }; }, read: async () => ({ theme: 'system', resolvedLocale: 'zh-CN', revision: 1 }) };
  return { styles, query, changes, root, document, window, client, events, emit: value => handler?.(value) };
}
test('renderer follows live system theme, locks explicit themes and disposes every listener', async () => {
  const f = view(), feature = createInterfacePresentation(f); await feature.mount();
  assert.equal(f.root.dataset.appearance, 'light');
  f.query.matches = false; f.changes.forEach(fn => fn()); assert.equal(f.root.dataset.appearance, 'dark');
  f.emit({ theme: 'light', resolvedLocale: 'en', revision: 2 }); assert.equal(f.root.dataset.appearance, 'light');
  assert.equal(f.root.lang, 'en'); assert.equal(f.root.style.colorScheme, 'light');
  f.changes.forEach(fn => fn()); assert.equal(f.root.dataset.appearance, 'light');
  f.emit({ theme: 'dark', resolvedLocale: 'zh-CN', revision: 1 }); assert.equal(f.root.lang, 'en');
  f.emit({ theme: 'system', resolvedLocale: 'en', revision: 3 }); assert.equal(f.root.dataset.appearance, 'dark');
  feature.dispose(); assert.equal(f.changes.size, 0); assert.equal(f.events.size, 0);
});
test('late startup query cannot roll back a newer broadcast or render after disposal', async () => {
  const f = view(), pending = deferred(); f.client.read = () => pending.promise;
  const feature = createInterfacePresentation(f), mounted = feature.mount();
  f.emit({ theme: 'dark', resolvedLocale: 'en', revision: 3 });
  pending.resolve({ theme: 'light', resolvedLocale: 'zh-CN', revision: 1 }); await mounted;
  assert.equal(f.root.dataset.appearance, 'dark'); assert.equal(f.root.lang, 'en'); feature.dispose();
});
test('pet menu palette cannot mutate character colours; other windows use stable shared semantic palette', async () => {
  for (const surface of ['popover', 'impulse', 'pet', 'nudge-corner', 'nudge-fullscreen']) {
    const f = view(surface), feature = createInterfacePresentation(f); await feature.mount();
    assert.equal(f.styles['--ui-bg'], panelPalette('light').bg1);
    assert.equal(f.styles['--primary'], surface === 'pet' ? undefined : panelPalette('light').primary);
    feature.dispose();
  }
  for (const appearance of ['light', 'dark']) {
    const p = panelPalette(appearance);
    for (const ink of ['fg0', 'fg1', 'fg2', 'primaryInk']) for (const bg of ['bg1', 'bg2']) assert.ok(contrastRatio(p[ink], p[bg]) >= 4.5);
    assert.ok(contrastRatio(p.ink, p.primary) >= 4.5);
  }
});
test('only declared static copy is translated; mixed child markup and user values are retained', () => {
  const plain = element(); plain.dataset.i18n = '设置';
  const direct = element(), icon = { nodeType: 1, textContent: 'icon' }, text = { nodeType: 3, textContent: '设置' };
  direct.childNodes = [icon, text]; direct.setAttribute('data-i18n-text', '设置');
  const input = element('现在'); input.setAttribute('data-i18n-placeholder', '设置');
  const document = { documentElement: {}, querySelectorAll: selector => ({ '[data-i18n]': [plain], '[data-i18n-text]': [direct], '[data-i18n-placeholder]': [input] }[selector] || []) };
  setLocale('en'); localizeDocument(document);
  assert.equal(plain.textContent, 'Settings'); assert.equal(text.textContent, 'Settings');
  assert.equal(icon.textContent, 'icon'); assert.equal(input.value, '现在');
  assert.equal(input.getAttribute('placeholder'), 'Settings');
  assert.equal(t('未知产品文案'), '未知产品文案');
  for (const languages of [['fr', 'zh-CN'], ['en-US'], ['zh-TW'], []]) assert.equal(resolveLocale('system', languages), interfacePreferences.resolveLocale('system', languages));
  setLocale('zh-CN'); localizeDocument(document); assert.equal(text.textContent, '设置');
});
function settingsFixture(update) {
  const select = element('system'), radios = ['system', 'light', 'dark'].map(element), status = element();
  const state = { settings: { locale: 'system', theme: 'system' } };
  const document = { getElementById: id => ({ setLanguage: select, interfaceSaveStatus: status }[id]), querySelectorAll: () => radios };
  const feature = createInterfaceSettings({ document, getState: () => state, surfaceClient: { updateSettings: update } });
  feature.mount(); return { select, radios, status, state, feature };
}
test('settings saves once while pending, reflects canonical acknowledgement and retains focus node', async () => {
  setLocale('zh-CN'); const pending = deferred(), calls = [];
  const f = settingsFixture(patch => { calls.push(patch); return pending.promise; });
  const original = f.select; f.select.value = 'en'; f.select.fire('change');
  f.select.fire('change'); assert.equal(calls.length, 1); assert.equal(f.select.disabled, false); assert.equal(f.select.getAttribute('aria-disabled'), 'true');
  f.state.settings.locale = 'en'; pending.resolve({ ok: true }); await tick();
  assert.equal(f.select, original); assert.equal(f.select.value, 'en'); assert.equal(f.select.disabled, false);
  assert.equal(f.status.dataset.state, 'saved'); f.feature.dispose();
});
test('failed settings restore the canonical selection; a disposed save cannot update a new view', async () => {
  const first = deferred(), f = settingsFixture(() => first.promise);
  f.radios[1].checked = true; f.radios[1].fire('change'); first.resolve({ ok: false }); await tick();
  assert.equal(f.radios[0].checked, true); assert.equal(f.radios[1].checked, false); assert.equal(f.status.dataset.state, 'error'); f.feature.dispose();
  const pending = deferred(), g = settingsFixture(() => pending.promise);
  g.select.value = 'en'; g.select.fire('change'); g.feature.dispose(); const before = g.status.textContent;
  pending.resolve({ ok: true }); await tick(); assert.equal(g.status.textContent, before);
});

 test('drawer revisit ignores old save feedback while the canonical command still finishes', async () => {
  setLocale('en');
  const pending = deferred(), f = settingsFixture(() => pending.promise);
  f.select.value = 'zh-CN'; f.select.fire('change');
  f.feature.clearFeedback(); assert.equal(f.status.textContent, '');
  f.state.settings.locale = 'zh-CN';
  pending.resolve({ ok: true }); await tick();
  assert.equal(f.status.textContent, '');
  assert.equal(f.select.value, 'zh-CN');
  assert.equal(f.select.getAttribute('aria-disabled'), 'false');
  f.feature.dispose();
});
test('acknowledged save status follows a later locale broadcast', async () => {
  setLocale('en');
  const f = settingsFixture(async () => ({ ok: true }));
  f.select.value = 'zh-CN'; f.select.fire('change'); await tick();
  assert.equal(f.status.textContent, 'Saved and applied');
  setLocale('zh-CN'); assert.equal(f.status.textContent, '已保存并生效');
  f.feature.dispose();
});
