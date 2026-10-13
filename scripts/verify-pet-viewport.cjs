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

// Bounded OS repositioning. macOS may move a shown window by a few points
// without calling our setters (Round 9 CI: y 345→348). That is tolerated only
// while the backing-store size is unchanged, the whole logical 220 DIP anchor
// stays inside the native rectangle, the cumulative displacement from the
// settled baseline stays within OS_NUDGE_LIMIT, and it happens at most
// OS_NUDGE_MAX_EVENTS times. 40 DIP exceeds the macOS menu bar (≤37 on notched
// displays); anything larger or repeated is a real geometry fault.
const OS_NUDGE_LIMIT = 40;
const OS_NUDGE_MAX_EVENTS = 2;

async function verifyRounds({ host, native, calls, setCursor, yieldTurn = () => new Promise(resolve => setImmediate(resolve)),
  nudgeLimit = OS_NUDGE_LIMIT, maxNudgeEvents = OS_NUDGE_MAX_EVENTS }) {
  const sameSize = (a, b) => a && b && a.width === b.width && a.height === b.height;
  const sameRect = (a, b) => sameSize(a, b) && a.x === b.x && a.y === b.y;
  const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  const frameWrite = call => ['setBounds', 'setResizable', 'setPosition'].includes(call.name);
  const anchor = host.getBounds();
  const origin = native.getBounds();
  const nudges = [];
  let bounds = origin, freshSamples = 0, invalidatedSamples = 0, maxDx = 0, maxDy = 0;
  // Every native rectangle we observe must satisfy the visible-anchor contract;
  // a position change is recorded, never silently absorbed.
  const accept = (next, round, open, phase) => {
    assert.ok(sameSize(next, origin), 'native-backing-store-resized');
    assert.ok(contains(next, anchor), 'logical-anchor-outside-native-window');
    const dx = next.x - origin.x, dy = next.y - origin.y;
    maxDx = Math.max(maxDx, Math.abs(dx)); maxDy = Math.max(maxDy, Math.abs(dy));
    assert.ok(Math.abs(dx) <= nudgeLimit && Math.abs(dy) <= nudgeLimit, 'os-nudge-exceeds-bound');
    if (!sameRect(next, bounds)) nudges.push({ round, open, phase, dx: next.x - bounds.x, dy: next.y - bounds.y });
    assert.ok(nudges.length <= maxNudgeEvents, 'os-nudge-repeated');
    bounds = next;
  };
  accept(origin, -1, null, 'baseline');
  const start = calls.length;
  for (let round = 0; round < 30; round++) {
    for (const open of [true, false]) {
      const mark = calls.length;
      const geometry = host.setMenuOpen(open);
      // Same synchronous main-process turn as the geometry read inside
      // setMenuOpen: no OS frame change can be delivered in between, so the
      // returned IPC geometry must describe exactly this native rectangle.
      const captured = native.getBounds();
      accept(captured, round, open, 'capture');
      assert.equal(geometry.width, captured.width, 'geometry-stale-at-capture');
      assert.equal(geometry.height, captured.height, 'geometry-stale-at-capture');
      assert.equal(captured.x + geometry.width / 2 + geometry.stageOffset.x, anchor.x + anchor.width / 2, 'geometry-stale-at-capture');
      assert.equal(captured.y + geometry.height / 2 + geometry.stageOffset.y, anchor.y + anchor.height / 2, 'geometry-stale-at-capture');
      await yieldTurn();
      const after = native.getBounds();
      const writes = calls.slice(mark).filter(frameWrite);
      // Menu open/close must not resize the backing store or call frame setters.
      assert.equal(writes.length, 0, 'native-frame-mutated');
      accept(after, round, open, 'yield');
      // If the OS moved the frame during the yield, the geometry delivered for
      // this sample is stale until the next publication/menu IPC. Count it as
      // invalidated; it is not evidence of renderer stability.
      if (sameRect(after, captured)) freshSamples++; else invalidatedSamples++;
      assert.deepEqual(host.getBounds(), anchor, 'logical-anchor-changed');
    }
  }
  const changes = calls.slice(start).filter(frameWrite);
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
  return { rounds: 30, nativeGeometryWrites: changes.length, logicalAnchorStable: true, logicalAnchorContained: true,
    geometryFreshAtCapture: true, freshSamples, invalidatedSamples, osNudges: nudges, maxOsDisplacement: { x: maxDx, y: maxDy },
    nativeIgnoreMouseEventsContract: true };
}

let stage = 'platform';
async function main() {
  assert.equal(process.platform, 'darwin', 'macOS-GUI-required');
  assert.ok(!process.argv.some(arg => /^--(?:headless|no-sandbox|disable-gpu)(?:=|$)/.test(arg)), 'normal-GUI-security-required');
  const { app, BrowserWindow, screen } = require('electron');
  assert.ok(!['headless', 'no-sandbox', 'disable-gpu'].some(flag => app.commandLine.hasSwitch(flag)), 'normal-GUI-security-required');
  stage = 'profile';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-viewport-probe-'));
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
    // macOS may retarget the frame after showInactive; wait for a stable native
    // rectangle before the no-mutation rounds contract (CI flake at 'rounds').
    stage = 'settle';
    {
      const yieldTurn = () => new Promise(resolve => setImmediate(resolve));
      const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      let stable = 0, last = record.window.getBounds();
      for (let i = 0; i < 60 && stable < 5; i++) {
        await yieldTurn();
        const next = record.window.getBounds();
        stable = same(last, next) ? stable + 1 : 0;
        last = next;
      }
      assert.equal(stable, 5, 'native-bounds-did-not-settle');
    }
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

function reportFailure(error) {
  if (error) console.error(error && error.stack ? error.stack : error);
  console.error(`pet-viewport-probe: failed (${stage})`);
  require('electron').app.exit(1);
}
module.exports = { trackedWindowClass, verifyRounds, main, reportFailure, OS_NUDGE_LIMIT, OS_NUDGE_MAX_EVENTS };
