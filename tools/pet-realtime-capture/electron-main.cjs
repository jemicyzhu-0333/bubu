'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { app, BrowserWindow, screen } = require('electron');
const { createOwnedWindowPort } = require('./window-port.cjs');
const { launchBench } = require('../dev-bench/orchestration');
const { installFixtureIsolation, readFixtureIsolationDiagnostics } = require('../../src/platform/electron/dev/fixture-isolation');
const ROOT = path.resolve(__dirname, '../..');
const requestArg = process.argv.find(value => value.startsWith('--capture-request='));
if (!requestArg || app.isPackaged || process.defaultApp !== true) throw new Error('capture-entry-requires-unpackaged-owned-request');
const { consumeCaptureHandoff, assertCaptureOwnership } = require('./handoff.cjs');
const token = process.env.BUBU_CAPTURE_TOKEN; delete process.env.BUBU_CAPTURE_TOKEN;
const request = consumeCaptureHandoff(requestArg.slice('--capture-request='.length), token);
if (app.commandLine.getSwitchValue('user-data-dir') !== request.fixture.userDataPath) throw new Error('capture-native-profile-mismatch');
let report, evidence, isolation, port, exiting = false;
const stop = new AbortController();
const started = performance.now();
const timer = setTimeout(() => stop.abort(new Error('capture-internal-deadline')), 165000);
process.on('SIGTERM', () => stop.abort(new Error('capture-interrupted')));
process.on('SIGINT', () => stop.abort(new Error('capture-interrupted')));
const sleep = ms => new Promise((resolve, reject) => {
  if (stop.signal.aborted) return reject(new Error('capture-interrupted'));
  const done = () => { stop.signal.removeEventListener('abort', abort); resolve(); };
  const handle = setTimeout(done, ms);
  const abort = () => { clearTimeout(handle); reject(new Error('capture-interrupted')); };
  stop.signal.addEventListener('abort', abort, { once: true });
});
const flush = () => { if (report && evidence) evidence.writePrivateJSON(request.reportFile, report); };
async function finish(error) {
  if (exiting) return; exiting = true;
  clearTimeout(timer); port?.close();
  if (error && report?.errors.length < 64) report.errors.push(evidence.safeMessage(error));
  if (report) {
    report.capture ??= { status: 'startup-failed' };
    if (error) report.capture.status = stop.signal.aborted ? 'interrupted' : 'partial';
    report.capture.applicationElapsedMs = performance.now() - started;
    report.isolation = readFixtureIsolationDiagnostics();
    report.endSource = evidence.sourceIdentity(ROOT); flush();
  }
  isolation?.close();
  // The real application lifecycle closes its canonical stores and all owned timers.
  app.quit();
}
app.on('window-all-closed', () => {});
app.on('will-quit', () => { clearTimeout(timer); if (report) { report.shutdownRequested = true; flush(); } });
(async () => {
  evidence = await import('./evidence.mjs');
  const { createCaptureReport } = await import('./report.mjs');
  const { collectRealtime } = await import('./collect.mjs');
  assertCaptureOwnership(request);
  if (!process.argv.includes('--dev')) process.argv.push('--dev');
  app.commandLine.appendSwitch('user-data-dir', request.fixture.userDataPath);
  app.setPath('userData', request.fixture.userDataPath); app.setPath('sessionData', request.fixture.userDataPath);
  isolation = installFixtureIsolation({ app, profilePath: request.fixture.userDataPath,
    assertOwnedProfile: () => assertCaptureOwnership(request), argv: process.argv });
  report = createCaptureReport({ runId: request.runId, source: request.source,
    environment: evidence.hostMetadata(), options: { screenshots: request.screenshots, collectionHardLimitMs: 180000 } });
  report.fixture = { isolated: true, schema: 20, credentialsAbsent: true, AI: false, updates: false, mirror: false, OSWrites: false };
  flush();
  let petResolve; const petWindow = new Promise(resolve => { petResolve = resolve; });
  const pagePath = path.join(ROOT, 'src/surfaces/pet/realtime/index.html');
  const expectedURL = require('node:url').pathToFileURL(pagePath).href;
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', () => { if (window.webContents.getURL() === expectedURL) petResolve(window); });
  });
  launchBench({ app, argv: [...process.argv.filter(value => !value.startsWith('--scenario=')), '--scenario=realtime-capture'],
    createProfile: () => ({ userDataPath: request.fixture.userDataPath }), log() {} });
  await app.whenReady();
  const window = await Promise.race([petWindow, sleep(35000).then(() => { throw new Error('capture-pet-window-timeout'); })]);
  if (!BrowserWindow.getAllWindows().includes(window)) throw new Error('capture-window-not-owned');
  port = createOwnedWindowPort({ window, pagePath, readProfileOwnership: () => assertCaptureOwnership(request), signal: stop.signal });
  window.webContents.on('render-process-gone', () => stop.abort(new Error('capture-renderer-gone')));
  window.webContents.on('console-message', details => { if (details.level === 'error' && report.errors.length < 64)
    report.errors.push({ code: 'selected-renderer-console-error', level: 'error' }); });
  const until = performance.now() + 35000;
  while (true) {
    const diagnostics = await port.read({ afterSequence: 0, limit: 1 });
    if (diagnostics.closed) { for (const message of diagnostics.errors.slice(0, 8)) report.errors.push(evidence.safeMessage(message)); throw new Error('capture-surface-closed-before-first-frame'); }
    if (diagnostics.ready && diagnostics.stage?.renderedFrames > 0) break;
    if (performance.now() > until) throw new Error('capture-first-frame-timeout');
    await sleep(200);
  }
  report.startupElapsedMs = performance.now() - started;
  const display = screen.getDisplayMatching(window.getBounds());
  report.environment.display = { scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency,
    windowWidth: window.getContentBounds().width, windowHeight: window.getContentBounds().height };
  let gpu = null;
  try { gpu = await Promise.race([app.getGPUInfo('basic'), sleep(5000).then(() => null)]); }
  catch { report.errors.push({ code: 'GPU-metadata-unavailable' }); }
  report.environment.gpu = { featureStatus: app.getGPUFeatureStatus(), devices: (gpu?.gpuDevice ?? []).slice(0, 4).map(item =>
    ({ active: item.active === true, vendorId: item.vendorId ?? null, deviceId: item.deviceId ?? null })) };
  const processes = async () => { const metrics = app.getAppMetrics(); const memory = process.memoryUsage(); return {
    metrics: metrics.slice(0, 16).map(item => ({ pid: item.pid, type: item.type,
    creationTime: item.creationTime, sandboxed: item.sandboxed ?? null,
    cpuPercent: item.cpu?.percentCPUUsage ?? null, workingSetKiB: item.memory?.workingSetSize ?? null })),
    totalProcessCount: metrics.length, processListTruncated: metrics.length > 16, rendererPID: window.webContents.getOSProcessId(),
    main: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed }, window: { visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() },
    rendererHeap: { supported: false, reason: 'not-exposed-by-WebContents' } }; };
  await collectRealtime(report, { ...port, signal: stop.signal, delay: sleep, now: () => performance.now() - started,
    processes, read: async options => { const value = await port.read(options);
      if (value.closed) for (const message of value.errors.slice(0, 8)) if (report.errors.length < 64) report.errors.push(evidence.safeMessage(message));
      flush(); return value; },
    reload: async previous => { await port.reload(previous); const deadline = performance.now() + 35000;
      while (true) { const value = await port.read({ afterSequence: 0, limit: 1 });
        if (value.closed) throw new Error('capture-reload-closed');
        if (value.ready && value.stage?.renderedFrames > 0) return;
        if (performance.now() > deadline) throw new Error('capture-reload-ready-timeout'); await sleep(200); }
    } }, { screenshots: request.screenshots });
  await finish();
})().catch(error => { if (!evidence || !report) { clearTimeout(timer); app.exit(2); } else finish(error).catch(() => app.exit(2)); });
