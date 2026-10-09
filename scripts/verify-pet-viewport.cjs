'use strict';
// Native geometry/API probe, not a screenshot or real mouse-click test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPetWindowHost } = require('../src/platform/electron/windows/pet-window');

function trackedWindowClass(BrowserWindow, record) {
  return function TrackedWindow(options) {
    const native = new BrowserWindow(options);
    record.window = native;
    for (const name of ['setBounds', 'setResizable', 'setPosition', 'setIgnoreMouseEvents']) {
      const original = native[name].bind(native);
      native[name] = (...args) => { record.calls.push({ name, args }); return original(...args); };
    }
    return native;
  };
}

async function verifyRounds({ host, native, calls, setCursor, yieldTurn = () => new Promise(resolve => setImmediate(resolve)) }) {
  const anchor = host.getBounds(), bounds = native.getBounds();
  const start = calls.length;
  for (let round = 0; round < 30; round++) {
    for (const open of [true, false]) {
      const geometry = host.setMenuOpen(open);
      await yieldTurn();
      assert.deepEqual(native.getBounds(), bounds, 'native-bounds-changed');
      assert.deepEqual(host.getBounds(), anchor, 'logical-anchor-changed');
      assert.equal(bounds.x + geometry.width / 2 + geometry.stageOffset.x, anchor.x + anchor.width / 2);
      assert.equal(bounds.y + geometry.height / 2 + geometry.stageOffset.y, anchor.y + anchor.height / 2);
    }
  }
  const changes = calls.slice(start).filter(call => ['setBounds', 'setResizable', 'setPosition'].includes(call.name));
  assert.equal(changes.length, 0, 'native-frame-mutated');
  // Controlled screen port; native setIgnoreMouseEvents itself is real.
  const corners = [{ x: bounds.x + 1, y: bounds.y + 1 }, { x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 1 }];
  const outside = corners.find(p => p.x < anchor.x || p.y < anchor.y || p.x >= anchor.x + anchor.width || p.y >= anchor.y + anchor.height);
  assert.ok(outside, 'no-transparent-probe-region');
  const ignored = () => calls.filter(call => call.name === 'setIgnoreMouseEvents').at(-1)?.args[0];
  setCursor(outside); host.setMenuOpen(false); assert.equal(ignored(), true);
  host.setMenuOpen(true); assert.equal(ignored(), false);
  host.setMenuOpen(false); assert.equal(ignored(), true);
  setCursor({ x: anchor.x + 10, y: anchor.y + 10 });
  host.setMenuOpen(false); assert.equal(ignored(), false);
  return { rounds: 30, nativeGeometryWrites: changes.length, logicalAnchorStable: true, nativeIgnoreMouseEventsContract: true };
}

let stage = 'platform';
async function main() {
  assert.equal(process.platform, 'darwin', 'macOS-GUI-required');
  assert.ok(!process.argv.some(arg => /^--(?:headless|no-sandbox|disable-gpu)(?:=|$)/.test(arg)), 'normal-GUI-security-required');
  const { app, BrowserWindow, screen } = require('electron');
  assert.ok(!['headless', 'no-sandbox', 'disable-gpu'].some(flag => app.commandLine.hasSwitch(flag)), 'normal-GUI-security-required');
  stage = 'profile';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'im-adhder-viewport-probe-'));
  app.setPath('userData', profile);
  fs.writeFileSync(path.join(profile, 'preload.cjs'), "'use strict';\n");
  fs.writeFileSync(path.join(profile, 'probe.html'), '<!doctype html><meta charset="utf-8"><title>Viewport probe</title><style>html,body{margin:0;background:transparent}</style>');
  let host, native;
  // Keep cleanup owned here instead of quitting implicitly on the last close.
  app.on('window-all-closed', () => {});
  const timeout = setTimeout(() => { console.error('pet-viewport-probe: timeout (synthetic profile may remain)'); app.exit(1); }, 20000);
  try {
    stage = 'display';
    await app.whenReady();
    assert.ok(screen.getAllDisplays().length > 0, 'GUI-display-required');
    const area = screen.getPrimaryDisplay().workArea;
    assert.ok(area.width >= 520 && area.height >= 360, 'GUI-workarea-too-small');
    const anchor = { x: area.x + area.width - 240, y: area.y + area.height - 240, width: 220, height: 220 };
    let cursor = { x: anchor.x + 10, y: anchor.y + 10 };
    const record = { calls: [], window: null };
    let loaded;
    const ready = new Promise(resolve => { loaded = resolve; });
    stage = 'load';
    host = createPetWindowHost({ BrowserWindow: trackedWindowClass(BrowserWindow, record), platform: 'darwin',
      screen: { getDisplayNearestPoint: point => screen.getDisplayNearestPoint(point), getCursorScreenPoint: () => cursor },
      preloadPath: path.join(profile, 'preload.cjs'), pagePath: path.join(profile, 'probe.html'), bounds: anchor, onLoaded: loaded });
    native = record.window;
    await ready;
    stage = 'show';
    host.showInactive();
    assert.equal(host.isVisible(), true, 'native-window-not-visible');
    const security = record.window.webContents.getLastWebPreferences();
    assert.equal(security.sandbox, true); assert.equal(security.contextIsolation, true); assert.equal(security.nodeIntegration, false);
    stage = 'rounds';
    const result = await verifyRounds({ host, native: record.window, calls: record.calls, setCursor: next => { cursor = next; } });
    console.log(JSON.stringify({ probe: 'pet-viewport', platform: 'darwin', ...result, visualVerification: false }));
  } finally {
    if (native && !native.isDestroyed()) {
      const closed = new Promise(resolve => native.once('closed', resolve));
      host.close();
      await closed;
    }
    fs.rmSync(profile, { recursive: true, force: true });

  }
  clearTimeout(timeout);
  app.exit(0);
}

function reportFailure() {
  console.error(`pet-viewport-probe: failed (${stage})`);
  require('electron').app.exit(1);
}
module.exports = { trackedWindowClass, verifyRounds, main, reportFailure };
