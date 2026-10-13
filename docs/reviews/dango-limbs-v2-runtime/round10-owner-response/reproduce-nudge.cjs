'use strict';
// Read-only deterministic port reproduction. This does not run native Electron.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const probePath = path.resolve(process.argv[3] || path.join(repoRoot, 'scripts/verify-pet-viewport.cjs'));
const source = fs.readFileSync(probePath, 'utf8');
// An external probe copy keeps its original relative production-module imports.
const virtualPath = path.join(repoRoot, 'scripts/verify-pet-viewport.cjs');
const probeModule = new Module(virtualPath, module);
probeModule.filename = virtualPath;
probeModule.paths = Module._nodeModulePaths(path.dirname(virtualPath));
probeModule._compile(source, virtualPath);
const { verifyRounds } = probeModule.exports;
const { createPetViewport } = require(path.join(repoRoot, 'src/platform/electron/windows/pet-viewport'));

function fixture(when, dy) {
  const anchor = { x: 1600, y: 800, width: 220, height: 220 };
  const calls = [];
  let cursor = { x: 1610, y: 810 }, reads = 0, yields = 0;
  const host = createPetViewport({
    bounds: anchor,
    screen: {
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getCursorScreenPoint: () => cursor
    },
    interval: () => 1,
    cancelInterval: () => {}
  });
  let bounds = { ...host.initialBounds };
  const native = new EventEmitter();
  native.webContents = new EventEmitter();
  native.webContents.send = () => {};
  native.isDestroyed = () => false;
  native.getBounds = () => {
    // First read is the probe baseline; second is inside setMenuOpen's hitTest.
    if (when === 'before-geometry' && ++reads === 2) bounds.y += dy;
    return { ...bounds };
  };
  native.setIgnoreMouseEvents = (...args) => calls.push({ name: 'setIgnoreMouseEvents', args });
  native.setBounds = (...args) => {
    calls.push({ name: 'setBounds', args });
    bounds = { ...args[0] };
  };
  native.setPosition = (...args) => {
    calls.push({ name: 'setPosition', args });
    bounds = { ...bounds, x: args[0], y: args[1] };
  };
  host.attach(native);
  return {
    host, native, calls,
    setCursor: next => { cursor = next; },
    yieldTurn: async () => {
      if (when === 'during-yield' && ++yields === 1) bounds.y += dy;
    }
  };
}

const scenarios = [
  { name: 'unchanged control', when: 'never', dy: 0, expectedStatus: 'PASS', expectedContained: true },
  { name: 'small nudge before geometry', when: 'before-geometry', dy: 3, expectedStatus: 'PASS', expectedContained: true },
  { name: 'small nudge during yield', when: 'during-yield', dy: 3, expectedStatus: 'FAIL', expectedContained: true },
  { name: 'large nudge before geometry', when: 'before-geometry', dy: 4000, expectedStatus: 'PASS', expectedContained: false }
];

async function main() {
  const results = [];
  for (const scenario of scenarios) {
    const ports = fixture(scenario.when, scenario.dy);
    let status = 'PASS', result = null, error = null;
    try {
      result = await verifyRounds(ports);
    } catch (failure) {
      status = 'FAIL';
      error = { name: failure.name, message: failure.message, actual: failure.actual, expected: failure.expected };
    }
    const anchor = ports.host.getBounds(), bounds = ports.native.getBounds();
    const anchorContained = anchor.x >= bounds.x && anchor.y >= bounds.y
      && anchor.x + anchor.width <= bounds.x + bounds.width
      && anchor.y + anchor.height <= bounds.y + bounds.height;
    const expectedFailure = scenario.when !== 'during-yield'
      || (error?.name === 'AssertionError' && error.actual === 913 && error.expected === 910);
    results.push({
      name: scenario.name, when: scenario.when, dy: scenario.dy, status,
      anchorContained, anchor, nativeBounds: bounds, result, error,
      matchesReviewedObservation: status === scenario.expectedStatus
        && anchorContained === scenario.expectedContained && expectedFailure
    });
  }
  const reproduced = results.every(item => item.matchesReviewedObservation);
  console.log(JSON.stringify({
    scope: 'Synthetic ports with production createPetViewport and the supplied probe; not native macOS or rendered-pixel evidence.',
    runtime: { node: process.version, platform: process.platform },
    probeSourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    reproducedReviewedObservations: reproduced,
    results
  }, null, 2));
  // Zero means the recorded review observations reproduced, not that the probe is correct.
  process.exitCode = reproduced ? 0 : 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
