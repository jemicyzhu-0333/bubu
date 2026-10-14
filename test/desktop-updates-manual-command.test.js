'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dom } = require('../test-support/manual-growth-dom');
const { createDesktopUpdateFeature, MAC_UPDATE_COMMAND } = require('../src/surfaces/popover/features/desktop-updates.mjs');
const { EN } = require('../src/surfaces/shared/interface/catalog.mjs');
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function mount({ platform, phase = 'unavailable', reason = 'feed-unconfigured', writeClipboard = async () => {} }) {
  const h = dom(), timers = new Map(); let id = 0;
  const surfaceClient = { getUpdateStatus: async () => ({ phase, reason, currentVersion: '0.0.2-dev.4', version: null, percent: 0 }),
    updateSettings: async () => ({ ok: true }) };
  const feature = createDesktopUpdateFeature({ ...h, getState: () => ({ settings: {} }), surfaceClient, platform, writeClipboard,
    setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: key => timers.delete(key) });
  feature.mount();
  return { ...h, feature, timers };
}

test('macOS shows the installer update command, a copy button and the auto-update-later note', async context => {
  const copied = [];
  const h = mount({ platform: 'MacIntel', writeClipboard: async text => { copied.push(text); } });
  context.after(() => h.feature.dispose()); await settle();
  assert.equal(h.$('#appUpdateManual').hidden, false);
  assert.equal(h.$('#appUpdateMacCommand').hidden, false);
  assert.equal(h.$('#appUpdateCommand').textContent, MAC_UPDATE_COMMAND);
  assert.equal(MAC_UPDATE_COMMAND, 'curl -fsSL https://raw.githubusercontent.com/jemicyzhu-0333/bubu/main/scripts/install-mac.sh | bash -s -- --update');
  h.$('#appUpdateCopy').emit('click'); await settle();
  assert.deepEqual(copied, [MAC_UPDATE_COMMAND]);
  assert.equal(h.$('#appUpdateCopy').textContent, '已复制');
  for (const fn of [...h.timers.values()]) fn();
  assert.equal(h.$('#appUpdateCopy').textContent, '复制更新命令');
});

test('a failed copy says so instead of claiming success', async context => {
  const h = mount({ platform: 'MacIntel', writeClipboard: async () => { throw new Error('denied'); } });
  context.after(() => h.feature.dispose()); await settle();
  h.$('#appUpdateCopy').emit('click'); await settle();
  assert.equal(h.$('#appUpdateCopy').textContent, '复制失败，请手动选择命令');
});

test('Windows keeps the in-app updater and only shows the later note when it is unavailable, never the mac command', async () => {
  const working = mount({ platform: 'Win32', phase: 'available', reason: null }); await settle();
  assert.equal(working.$('#appUpdateManual').hidden, true);
  working.feature.dispose();
  const missing = mount({ platform: 'Win32' }); await settle();
  assert.equal(missing.$('#appUpdateManual').hidden, false);
  assert.equal(missing.$('#appUpdateMacCommand').hidden, true);
  missing.feature.dispose();
});

test('popover markup and English catalog carry the new update copy', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  for (const id of ['appUpdateManual', 'appUpdateMacCommand', 'appUpdateCommand', 'appUpdateCopy']) assert.match(html, new RegExp(`id="${id}"`));
  assert.ok(html.includes(MAC_UPDATE_COMMAND));
  for (const key of ['应用内自动更新后续推出。', '复制更新命令', '复制失败，请手动选择命令', '已复制']) assert.ok(EN[key], key);
});
