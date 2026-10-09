'use strict';
// Separate diagnostic entry: never imports application main, state, IPC, or credentials.
const { app, BrowserWindow, screen, powerMonitor } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../..');
const request = process.argv.find(argument => argument.startsWith('--request='));
if (!request) throw new Error('Launch this diagnostic with npm run pet:memory');
const { out, options } = JSON.parse(fs.readFileSync(request.slice(10), 'utf8'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-pet-memory-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
let window, nativeEvents, report, writeReport, assessReport, exiting = false;
let stopRequested = false, gpuInfoUpdated = false;
app.on('gpu-info-update', () => { gpuInfoUpdated = true; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopRequested = true; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = expression => window.webContents.executeJavaScript(`import('./page.mjs').then(memory => ${expression})`);

function recordFailure(error) {
  if (exiting) return;
  exiting = true;
  if (report) {
    if (nativeEvents) { report.nativeEvents = nativeEvents.stop(); report.nativeEventAudit = nativeEvents.audit(); }
    report.status = 'failed'; report.errors.push(String(error?.stack || error));
    report.gate = assessReport(report); writeReport(out, report);
  }
  process.stderr.write(`Memory gate NOT PASSED: ${error?.message || error}\n`); app.exit(1);
}

async function run() {
  const api = await import('./report.mjs');
  const evidence = await import('./host-evidence.mjs');
  const { observeNativeEvents, waitForDisplaySettle, STARTUP_POLICY } = await import('./native-events.mjs');
  ({ assessReport } = api); ({ writeReport } = evidence);
  report = api.initialReport(options); report.profile = { isolated: true, path: profile };
  report.environment = { ...evidence.hostMetadata(), ...evidence.sourceIdentity(ROOT) };
  writeReport(out, report);
  window = new BrowserWindow({ width: 220, height: 220, show: true, transparent: true,
    frame: false, resizable: false, backgroundColor: '#00000000',
    title: 'Production pet memory baseline',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      offscreen: false, backgroundThrottling: false } });
  nativeEvents = observeNativeEvents({ window, app, powerMonitor, screen });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { if (!exiting) { event.preventDefault(); stopRequested = true; } });
  window.webContents.on('render-process-gone', (_event, details) => recordFailure(new Error(`Renderer process gone: ${JSON.stringify(details)}`)));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await window.loadFile(path.join(__dirname, 'window.html'));
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Runtime.enable');
  const gpuInfo = await Promise.race([app.getGPUInfo('complete'),
    pause(10_000).then(() => { throw new Error('GPU metadata timed out'); })]);
  const gpuWaitStart = performance.now();
  while (!gpuInfoUpdated && performance.now() - gpuWaitStart < 10_000) await pause(50);
  report.environment.gpu = { info: gpuInfo, infoUpdated: gpuInfoUpdated, featureStatus: app.getGPUFeatureStatus() };
  await waitForDisplaySettle(nativeEvents);
  const display = screen.getDisplayMatching(window.getBounds());
  report.environment.display = { id: display.id, scaleFactor: display.scaleFactor,
    displayFrequency: display.displayFrequency, bounds: display.bounds, colorDepth: display.colorDepth };
  if (!window.isVisible() || window.isMinimized()) throw new Error('Window is not shown at the measurement boundary');
  report.environment.window = { transparent: true, offscreen: false, visible: window.isVisible(),
    backgroundColor: window.getBackgroundColor(), backgroundThrottling: false, hardwareAccelerationRequested: true,
    security: { sandbox: true, contextIsolation: true, nodeIntegration: false } };
  report.measurementBoundary = { ...nativeEvents.beginMeasurement(), beforeRendererStart: true,
    displayId: display.id, scaleFactor: display.scaleFactor };
  report.environment.renderer = await Promise.race([evaluate('memory.start()'),
    pause(STARTUP_POLICY.rendererReadyTimeoutMs).then(() => { throw new Error('First genuine renderer frame timed out'); })]);
  report.status = 'running'; writeReport(out, report);
  const origin = performance.now();
  async function sample(scheduledMs) {
    const processes = app.getAppMetrics().map(evidence.processEvidence);
    const rendererPid = window.webContents.getOSProcessId();
    const renderer = await evaluate('memory.sample()');
    renderer.jsHeap = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    renderer.dom = await window.webContents.debugger.sendCommand('Memory.getDOMCounters');
    const main = process.memoryUsage();
    report.samples.push({ scheduledMs, elapsedMs: performance.now() - origin, at: new Date().toISOString(),
      main: { pid: process.pid, rssBytes: main.rss, heapUsedBytes: main.heapUsed, heapTotalBytes: main.heapTotal,
        externalBytes: main.external, arrayBuffersBytes: main.arrayBuffers,
        electronMemoryKiB: await process.getProcessMemoryInfo() },
      rendererProcess: processes.find(item => item.pid === rendererPid) || null, processes, renderer,
      window: { visible: window.isVisible(), minimized: window.isMinimized() }, nativeEvents: nativeEvents.snapshot() });
    report.nativeEventAudit = nativeEvents.audit();
    report.gate = assessReport(report); writeReport(out, report);
    if (!renderer.running || renderer.errorCount) throw new Error('Production renderer stopped or reported a frame failure');
    process.stdout.write(`Sample ${Math.round(scheduledMs / 1000)}s: renderer RSS ${report.samples.at(-1).rendererProcess?.rssBytes ?? 'unknown'} bytes, frame p95 ${renderer.frameIntervals.p95Ms ?? 'unknown'} ms; gate ${report.gate.verdict}\n`);
  }
  await sample(0);
  for (let due = options.sampleMs; due <= options.durationMs; due += options.sampleMs) {
    while (!stopRequested && performance.now() - origin < due) await pause(Math.min(500, due - (performance.now() - origin)));
    if (stopRequested) break;
    // Allow another real rAF callback beyond the end; this does not prove physical scanout.
    if (due === options.durationMs) await pause(50);
    await sample(due);
  }
  await evaluate('memory.stop()');
  report.nativeEvents = nativeEvents.stop();
  report.nativeEventAudit = nativeEvents.audit();
  report.status = stopRequested ? 'interrupted' : options.smoke ? 'smoke-completed' : 'completed';
  report.endedAt = new Date().toISOString();
  report.endSourceDigest = evidence.sourceIdentity(ROOT).sourceDigest;
  if (report.endSourceDigest !== report.environment.sourceDigest) report.errors.push('Source files changed during measurement.');
  const measurementGate = assessReport(report, { requireLauncherExit: false });
  report.gate = assessReport(report); writeReport(out, report);
  exiting = true; window.destroy(); await pause(1000);
  report.afterWindowClose = { main: process.memoryUsage(), processes: app.getAppMetrics().map(evidence.processEvidence),
    scope: 'Diagnostic only, after destroying the renderer window; no forced GC' };
  writeReport(out, report);
  process.stdout.write(`Measurement ended; final launcher exit verification pending: ${path.join(out, 'report.json')}\n`);
  app.exit(measurementGate.verdict === 'PASSED' ? 0 : 2);
}
app.whenReady().then(run).catch(recordFailure);
app.on('window-all-closed', () => {});
