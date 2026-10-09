'use strict';

// 深色 / 浅色跟随系统；面板配色与伙伴皮肤无关。对比度由 test/action-workspace.test.js 对配色逐项验证。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = relative => import(pathToFileURL(path.join(ROOT, relative)).href);

async function fixtures() {
  const appearance = await load('src/surfaces/popover/ui/theme-appearance.mjs');
  const { SKINS } = await load('src/skins.mjs');
  return { ...appearance, SKINS };
}

// ---- app-chrome：外观标记与重推 ----
function chrome({ prefersLight, withMatchMedia = true }) {
  const listeners = new Set();
  const query = { matches: prefersLight, addEventListener: (_t, fn) => listeners.add(fn), removeEventListener: (_t, fn) => listeners.delete(fn) };
  const rootStyle = {};
  const document = {
    body: { dataset: { motion: 'reduced', stimulation: 'low' } },
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { dataset: {}, style: { setProperty: (name, value) => { rootStyle[name] = value; } } },
    defaultView: withMatchMedia ? { matchMedia: value => value.includes('color-scheme') ? query : { matches: true } } : {},
    addEventListener() {}, removeEventListener() {}
  };
  const noop = () => {};
  const node = { addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } };
  return { document, query, listeners, rootStyle, node };
}

async function buildChrome(env, getState) {
  const { createPopoverAppChrome } = await load('src/surfaces/popover/features/app-chrome.mjs');
  return createPopoverAppChrome({
    document: env.document, $: () => env.node, $$: () => [], getState, getSession: () => null,
    surfaceClient: { openImpulse() {}, updateSettings() {} }, escapeHTML: String, nextRovingIndex: () => null, onTabShown: () => {}
  });
}

test('the page is marked with its appearance on mount, before any state arrives', async () => {
  const env = chrome({ prefersLight: true });
  const feature = await buildChrome(env, () => null);
  feature.mount();
  assert.equal(env.document.documentElement.dataset.appearance, 'light');
  assert.ok(env.rootStyle['--bg-1'], 'the first paint has a palette before state arrives');
  assert.equal(env.listeners.size, 1, 'listens for the system changing');
  feature.dispose();
  assert.equal(env.listeners.size, 0, 'and stops on dispose');
});

test('applyTheme follows system appearance and keeps the panel independent of pet skins', async () => {
  const { panelPalette } = await load('src/surfaces/popover/ui/panel-palette.mjs');
  const { SKINS } = await fixtures();
  const env = chrome({ prefersLight: true });
  const state = { currentSkin: 'forest', theme: SKINS.forest.theme };
  const feature = await buildChrome(env, () => state);
  feature.mount();
  feature.applyTheme();
  const lightBg = env.rootStyle['--bg-1'];
  assert.notEqual(lightBg, SKINS.forest.theme.bg1, 'light surfaces, not the skin’s dark ones');
  assert.ok(env.rootStyle['--primary-ink'] && env.rootStyle['--accent-ink'] && env.rootStyle['--ink']);
  assert.equal(env.rootStyle['--primary'], panelPalette('light').primary);
  state.currentSkin = 'pink'; state.theme = SKINS.pink.theme;
  feature.applyTheme();
  assert.equal(env.rootStyle['--primary'], panelPalette('light').primary);

  env.rootStyle['--bg-1'] = 'sentinel';
  feature.applyTheme();
  assert.equal(env.rootStyle['--bg-1'], 'sentinel', 'same skin, same appearance: nothing is rewritten');

  env.query.matches = false;                       // the person switches macOS to dark
  for (const fn of env.listeners) fn();
  assert.equal(env.document.documentElement.dataset.appearance, 'dark');
  assert.equal(env.rootStyle['--bg-1'], panelPalette('dark').bg1);
});

test('without matchMedia (or a theme) it stays dark and never throws', async () => {
  const { SKINS } = await fixtures();
  const env = chrome({ prefersLight: true, withMatchMedia: false });
  const feature = await buildChrome(env, () => ({ currentSkin: 'pink', theme: SKINS.pink.theme }));
  feature.mount();
  feature.applyTheme();
  assert.equal(env.document.documentElement.dataset.appearance, 'dark');
  const empty = chrome({ prefersLight: true });
  const bare = await buildChrome(empty, () => ({ currentSkin: 'pink' }));
  bare.applyTheme();
  assert.ok(empty.rootStyle['--bg-1'], 'panel palette does not depend on a pet theme');
});

// ---- 样式接线：文字用的强调色、按钮上的字、阴影都走令牌 ----
test('no stylesheet uses the raw accent or a surface colour as text, or a fixed black for shadows', () => {
  const dir = path.join(ROOT, 'src/surfaces/popover/styles');
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.css') && files.push(path.join(d, e.name))));
  walk(dir);
  const offenders = [];
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    if (/(?<![-\w])color:\s*var\(--(?:primary|pink|accent|yellow)\)/.test(css)) offenders.push(`${rel}: accent used as text colour`);
    if (/(?<![-\w])color:\s*var\(--bg-[01]\)/.test(css)) offenders.push(`${rel}: surface colour used as ink`);
    if (/(?<![-\w])color:\s*var\(--(?:cyan|green|blue|purple|yellow-const)\)/.test(css)) offenders.push(`${rel}: fixed coloured constant used as text`);
    if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(css)) offenders.push(`${rel}: fixed black shadow/scrim`);
  }
  assert.deepEqual(offenders, [], 'use --primary-ink / --accent-ink / --ink / --cyan-ink … / rgb(var(--shadow-rgb) / a)');
});

test('the light block exists for the tokens that do not depend on the skin, and the quick panel has its own', () => {
  const theme = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/styles/theme.css'), 'utf8');
  for (const token of ['color-scheme: light']) {
    assert.match(theme, new RegExp(`:root\\[data-appearance="light"\\] \\{[^}]*${token.replace(/[-.]/g, '\\$&')}`), token);
  }
  const quick = fs.readFileSync(path.join(ROOT, 'src/renderer/impulse.html'), 'utf8');
  assert.match(quick, /@media \(prefers-color-scheme: light\) \{[\s\S]*?color-scheme: light;/);
});

test('every ink token is written to the page and has a default', async () => {
  const { THEME_VARIABLES } = await fixtures();
  const tokens = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/styles/tokens.css'), 'utf8');
  for (const variable of ['--cyan-ink', '--green-ink', '--blue-ink', '--purple-ink', '--yellow-ink', '--primary-ink', '--accent-ink', '--ink']) {
    assert.ok(Object.values(THEME_VARIABLES).includes(variable), `${variable} is written by applyTheme`);
    assert.match(tokens, new RegExp(`${variable}:`), `${variable} has a default before the first state arrives`);
  }
});
