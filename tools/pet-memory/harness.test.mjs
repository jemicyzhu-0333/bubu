import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeNativeEvents, waitForDisplaySettle, NATIVE_EVENT_KEYS, STARTUP_POLICY, NATIVE_AUDIT_LIMIT } from './native-events.mjs';
import { createRequire } from 'node:module';
import { BASELINE, createScenario, scenarioAt, parseOptions } from './scenario.mjs';
import { createFrameClock } from './frame-clock.mjs';
import { createTimingHistogram, memoryTrend } from './statistics.mjs';
import { initialReport, assessReport } from './report.mjs';
import { observeResources } from './resource-observer.mjs';
import { loadProduction, createPainterHost } from './painter-host.mjs';
import { SKINS } from '../../src/skins.mjs';
import { PET_ACTIONS } from '../../src/content/behaviors.mjs';
import { SESSION_ACTIVITIES } from '../../src/content/session-activities.mjs';
import { PET_APPEARANCE_ITEMS } from '../../src/content/appearance.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';

const inputs = { skins: SKINS, actions: PET_ACTIONS, sessions: SESSION_ACTIVITIES, outfits: USAGI_OUTFIT_SETS };
const scenario = createScenario(inputs);

test('fixed scenario repeats identically, covers catalog, and uses only valid compatible outfit IDs', () => {
  assert.deepEqual(createScenario(inputs), scenario);
  assert.equal(scenario.length * BASELINE.stepMs, BASELINE.warmupMs);
  assert.deepEqual(new Set(scenario.map(item => item.skin)), new Set(Object.keys(SKINS)));
  const actual = new Set(scenario.map(item => `${item.kind}:${item.id}`));
  for (const id of Object.keys(PET_ACTIONS)) assert.ok(actual.has(`action:${id}`));
  for (const id of Object.keys(SESSION_ACTIVITIES)) assert.ok(actual.has(`session:${id}`));
  for (const entry of scenario) for (const id of entry.outfit) {
    const item = PET_APPEARANCE_ITEMS.find(item => item.id === id);
    assert.ok(item, id); assert.equal(item.formId, entry.skin === 'usagi' ? 'usagi' : 'dango');
  }
  for (let index = 0; index < scenario.length; index++) {
    assert.equal(scenarioAt(scenario, index * BASELINE.stepMs).entry,
      scenarioAt(scenario, index * BASELINE.stepMs + BASELINE.warmupMs).entry);
  }
  assert.equal(scenarioAt(scenario, 4_999).step, 0);
  assert.equal(scenarioAt(scenario, 5_000).step, 1);
  assert.equal(scenarioAt(scenario, BASELINE.durationMs).cycle, 6);
});

test('duration, cadence, and thresholds cannot be relaxed through command arguments', () => {
  assert.equal(parseOptions([]).durationMs, 1_800_000);
  assert.equal(parseOptions(['--smoke']).durationMs, 60_000);
  assert.equal(parseOptions(['--out=C:\\Temp\\memory-run']).out, 'C:\\Temp\\memory-run');
  for (const value of ['--duration=30', '--sample=1', '--disable-gpu', '--no-sandbox', '--out=']) {
    assert.throws(() => parseOptions([value]), /Unknown/);
  }
});

test('fixed-size histograms keep p95 frame intervals separate from draw durations', () => {
  const frames = createTimingHistogram(), draw = createTimingHistogram();
  for (let i = 0; i < 100; i++) { frames.add(i < 95 ? 16.67 : 32); draw.add(1.26); }
  assert.equal(frames.snapshot().p95Ms, 16.7);
  assert.equal(frames.snapshot().p99Ms, 32);
  assert.equal(draw.snapshot().p95Ms, 1.3);
  frames.add(25_000); assert.equal(frames.snapshot().maxMs, 25_000);
  frames.reset(); assert.equal(frames.snapshot().count, 0); assert.equal(frames.snapshot().p95Ms, null);
  assert.throws(() => draw.add(NaN));
});

test('post-warm slope reports sustained growth without calling it a proved leak', () => {
  const points = values => values.map((bytes, index) => ({ bytes, minutes: index * 5 }));
  assert.equal(memoryTrend(points([100, 100, 100])).sustainedGrowth, false);
  assert.equal(memoryTrend(points([100, 101, 102, 103])).sustainedGrowth, true);
  assert.equal(memoryTrend(points([100, 200, 50, 100])).sustainedGrowth, false);
  assert.equal(memoryTrend(points([100, NaN, 100])), null);
  assert.equal(memoryTrend(points([100, 100])), null);
});

function completeFixture() {
  const report = initialReport(parseOptions([]));
  const digest = 'a'.repeat(64);
  report.status = 'completed'; report.endSourceDigest = digest;
  report.launch = { code: 0, signal: null, stopReason: null };
  report.nativeEvents = Object.fromEntries(NATIVE_EVENT_KEYS.map(key => [key, 0]));
  report.measurementBoundary = { phase: 'measuring', beforeRendererStart: true, displayId: 1, scaleFactor: 1.25,
    policy: STARTUP_POLICY, quietForMs: 1000, armedAtMonotonicMs: 1000, startupNativeEvents: { ...report.nativeEvents } };
  report.nativeEventAudit = { maxEvents: NATIVE_AUDIT_LIMIT, totalEvents: 0, truncated: false, events: [] };
  report.environment = { versions: { electron: '44.0.0', chrome: 'test-fixture' }, git: { commit: 'a5eac4e' }, sourceDigest: digest,
    window: { transparent: true, offscreen: false, visible: true }, gpu: { infoUpdated: true, info: { gpuDevice: [{ active: true, vendorId: 4318, deviceId: 1, deviceString: 'Hardware fixture' }], auxAttributes: { softwareRendering: false } }, featureStatus: { gpu_compositing: 'enabled' } },
    display: { id: 1, scaleFactor: 1.25, displayFrequency: 60 }, renderer: { dpr: 1.25, clockOrigin: 'first-genuine-rAF', firstFrameTimestamp: 1200, painter: 'src/surfaces/pet/renderer.mjs:createPetRenderer' } };
  const source = () => ({ entries: 10, bytes: 100_000, loading: 0, failed: 0 });
  report.samples = Array.from({ length: 7 }, (_, index) => ({ scheduledMs: index * BASELINE.sampleMs,
    elapsedMs: index * BASELINE.sampleMs + 50,
    main: { pid: 100, rssBytes: 100_000_000, heapUsedBytes: 20_000_000 },
    rendererProcess: { type: 'Tab', pid: 101, creationTime: 1000, rssBytes: 100_000_000 },
    processes: [
      { type: 'Browser', pid: 100, creationTime: 1000, rssBytes: 100_000_000 },
      { type: 'Tab', pid: 101, creationTime: 1000, rssBytes: 100_000_000 },
      { type: 'GPU', pid: 102, creationTime: 1000, rssBytes: 100_000_000 },
      { type: 'Utility', pid: 103, creationTime: 1000, rssBytes: 20_000_000 }
    ],
    window: { visible: true, minimized: false }, nativeEvents: { ...report.nativeEvents },
    renderer: { running: true, elapsedMs: index * BASELINE.sampleMs + 60, step: index * 60, errorCount: 0, hiddenFrames: 0,
      skippedSteps: 0, dprChanges: 0, opaqueBodyPixels: index ? 1000 : 0,
      jsHeap: { usedSize: 20_000_000 }, resources: { supported: true, live: { HTMLCanvasElement: 6, Image: 20 }, created: { HTMLCanvasElement: 8, Image: 20 }, rgbaBytesEstimate: { HTMLCanvasElement: 100000, Image: 200000 } }, dom: { nodes: 5, documents: 1, jsEventListeners: 2 },
      caches: { body: { entries: 32, capacity: 32 }, dango: { source: source(), palette: { entries: 0, bytes: 0 } }, usagi: { wardrobe: source(), ambient: source() } },
      frameIntervals: { count: index * 18_000, p95Ms: 16.7 }, drawDurations: { count: index * 18_000, p95Ms: 2 } }
  }));
  return report;
}

test('complete plateau fixture passes this gate only; a cold t0 frame is explicitly allowed', () => {
  const report = completeFixture(); report.samples[0].renderer.caches.dango.source.loading = 4;
  assert.equal(assessReport(report).verdict, 'PASSED');
  assert.match(assessReport(report).scope, /baseline only/);
});

test('short, interrupted, failed, headless, and unknown evidence never pass', () => {
  for (const mutate of [
    report => { report.status = 'smoke-completed'; report.options = parseOptions(['--smoke']); },
    report => { report.status = 'interrupted'; }, report => { report.status = 'launch-failed'; },
    report => { report.samples.pop(); }, report => { report.environment.window.offscreen = true; },
    report => { report.environment.gpu = null; }, report => { report.environment.sourceDigest = null; },
    report => { report.environment.display.displayFrequency = undefined; }, report => { report.endSourceDigest = null; },
    report => { report.samples[3].renderer.jsHeap = null; }, report => { report.samples[6].renderer.frameIntervals.p95Ms = null; },
    report => { report.samples[6].renderer.frameIntervals.p95Ms = NaN; }, report => { report.samples[6].renderer.frameIntervals.p95Ms = 20.1; },
    report => { report.samples[4].renderer.opaqueBodyPixels = 0; }, report => { report.samples[2].renderer.caches.dango.source.failed = undefined; },
    report => { report.samples[3].renderer.dom = {}; }, report => { report.samples[3].renderer.hiddenFrames = undefined; },
    report => { report.samples[4].elapsedMs += 10_000; }, report => { report.samples[4].renderer.caches.dango.source.loading = 1; },
    report => { delete report.baseline; }, report => { delete report.options; },
    report => { report.options = { ...report.options, durationMs: NaN }; },
    report => { report.environment.display.displayFrequency = Infinity; },
    report => { report.environment.renderer.dpr = Infinity; },
    report => { report.samples[4].renderer.resources = { supported: true }; },
    report => { report.samples[4].renderer.resources.live = {}; },
    report => { report.samples[4].renderer.skippedSteps = 1; }, report => { report.samples[4].rendererProcess.rssBytes = NaN; }
  ]) {
    const report = completeFixture(); mutate(report);
    assert.equal(assessReport(report).verdict, 'NOT PASSED', mutate.toString());
  }
  assert.equal(assessReport(initialReport(parseOptions([]))).verdict, 'NOT PASSED');
});

test('positive linear growth blocks even below the final 10% guard', () => {
  const report = completeFixture();
  report.samples.forEach((sample, index) => { sample.rendererProcess.rssBytes += index * 10_000; });
  const gate = assessReport(report);
  assert.equal(gate.verdict, 'NOT PASSED'); assert.equal(gate.trends.rendererRss.sustainedGrowth, true);
  assert.ok(gate.trends.rendererRss.finalGrowthFraction < .1);
});

test('v2 gates known GPU and total process RSS growth even when main and renderer plateau', () => {
  const report = completeFixture();
  report.samples.forEach((sample, index) => { sample.processes.find(entry => entry.type === 'GPU').rssBytes += index * 80_000_000; });
  const gate = assessReport(report);
  assert.equal(gate.gateVersion, 3);
  assert.equal(gate.verdict, 'NOT PASSED');
  assert.equal(gate.trends.mainRss.sustainedGrowth, false);
  assert.equal(gate.trends.rendererRss.sustainedGrowth, false);
  assert.equal(gate.trends.gpuAggregateRss.sustainedGrowth, true);
  assert.equal(gate.trends.allProcessesAggregateRss.sustainedGrowth, true);
});

test('v2 rejects old reports, missing process metrics, restarts, and incomplete stable series', () => {
  for (const mutate of [
    report => { report.gateVersion = 1; }, report => { report.gateVersion = 2; }, report => { delete report.gateVersion; },
    report => { delete report.samples[3].processes; },
    report => { report.samples[3].processes = []; },
    report => { report.samples[3].processes = report.samples[3].processes.filter(entry => entry.type !== 'GPU'); },
    report => { report.samples[3].processes.pop(); },
    report => { report.samples[3].processes[2].rssBytes = null; },
    report => { report.samples[3].processes[2].rssBytes = NaN; },
    report => { report.samples[3].processes[2].rssBytes = Infinity; },
    report => { report.samples[3].processes[2].creationTime = null; },
    report => { report.samples[3].processes[2].creationTime = 2000; },
    report => { report.samples[3].processes[2].pid = 202; },
    report => { report.samples[3].processes.push({ ...report.samples[3].processes[2] }); },
    report => { report.samples[3].processes[2].type = 'Utility'; },
    report => { report.samples[3].main.pid = 999; },
    report => { report.samples[3].rendererProcess.creationTime = 2000; },
    report => { report.samples[3].rendererProcess.rssBytes += 1; }
  ]) {
    const report = completeFixture(); mutate(report);
    assert.equal(assessReport(report).verdict, 'NOT PASSED', mutate.toString());
  }
});

test('v2 accepts reordered stable process sets and permits startup-only churn', () => {
  const report = completeFixture(); report.samples[0].processes = [];
  report.samples[3].processes.reverse();
  const gate = assessReport(report);
  assert.equal(gate.verdict, 'PASSED');
  assert.equal(gate.trends.gpuAggregateRss.slopeBytesPerMinute, 0);
  assert.equal(gate.trends.allProcessesAggregateRss.slopeBytesPerMinute, 0);
  assert.equal(Object.keys(gate.processTrends).length, 4);
});

test('v2 cannot hide one known process growing behind another process shrinking', () => {
  const report = completeFixture();
  report.samples.forEach((sample, index) => {
    sample.processes.find(entry => entry.type === 'Utility').rssBytes += index * 10_000;
    sample.processes.find(entry => entry.type === 'Browser').rssBytes -= index * 10_000;
  });
  const gate = assessReport(report);
  assert.equal(gate.verdict, 'NOT PASSED');
  assert.equal(gate.trends.allProcessesAggregateRss.sustainedGrowth, false);
  assert.equal(gate.processTrends['Utility:103:1000'].sustainedGrowth, true);
});

test('v2 rejects hidden-native interruptions, stopped renderer, software GPU, and abnormal launcher exits', () => {
  for (const mutate of [
    report => { delete report.nativeEvents; },
    report => { report.nativeEvents.minimize = 1; },
    report => { report.samples[3].nativeEvents.hide = 1; },
    report => { report.samples[3].nativeEvents.lockScreen = 1; },
    report => { report.samples[3].nativeEvents.childProcessGone = 1; },
    report => { report.samples[3].renderer.running = false; },
    report => { report.environment.gpu.info = {}; },
    report => { report.environment.gpu.info.gpuDevice = []; },
    report => { report.environment.gpu.info.gpuDevice[0].active = false; },
    report => { report.environment.gpu.info.auxAttributes.softwareRendering = true; },
    report => { report.environment.gpu.info.auxAttributes.glRenderer = 'ANGLE (SwiftShader)'; },
    report => { report.environment.gpu.infoUpdated = false; },
    report => { delete report.launch; }, report => { report.launch.code = 1; },
    report => { report.launch.signal = 'SIGABRT'; }, report => { report.launch.stopReason = 'timeout'; }
  ]) {
    const report = completeFixture(); mutate(report);
    assert.equal(assessReport(report).verdict, 'NOT PASSED', mutate.toString());
  }
  const report = completeFixture(); delete report.launch;
  assert.equal(assessReport(report, { requireLauncherExit: false }).verdict, 'PASSED', 'internal exit-code decision only');
  assert.equal(assessReport(report).verdict, 'NOT PASSED', 'persisted gate awaits wrapper exit evidence');
});

test('native observer preserves between-sample interruptions and ignores focus and intentional teardown', () => {
  const sources = { window: new EventEmitter(), app: new EventEmitter(), powerMonitor: new EventEmitter(), screen: new EventEmitter() };
  let now = 0;
  const observer = observeNativeEvents({ ...sources, now: () => now });
  now = 1000; observer.beginMeasurement();
  sources.window.emit('blur'); assert.ok(Object.values(observer.snapshot()).every(count => count === 0));
  sources.window.emit('minimize'); sources.window.emit('restore'); sources.window.emit('hide'); sources.window.emit('show');
  sources.powerMonitor.emit('suspend'); sources.powerMonitor.emit('lock-screen');
  sources.screen.emit('display-added'); sources.screen.emit('display-removed'); sources.screen.emit('display-metrics-changed');
  sources.app.emit('child-process-gone');
  assert.ok(Object.values(observer.snapshot()).every(count => count === 1));
  const final = observer.stop();
  sources.window.emit('hide'); sources.app.emit('child-process-gone');
  assert.deepEqual(observer.snapshot(), final);
  for (const source of Object.values(sources)) assert.deepEqual(source.eventNames(), []);
});

test('resource observer observes constructors without substituting or retaining images', () => {
  class Image { constructor() { this.naturalWidth = 4; this.naturalHeight = 5; } }
  class Canvas { constructor(width, height) { this.width = width; this.height = height; } }
  const host = { WeakRef, Image, OffscreenCanvas: Canvas, document: { createElement: () => new Canvas(2, 3) } };
  const observer = observeResources(host);
  const image = new host.Image(), canvas = new host.OffscreenCanvas(6, 7), dom = host.document.createElement('canvas');
  assert.ok(image instanceof Image); assert.ok(canvas instanceof Canvas); assert.ok(dom instanceof Canvas);
  const stats = observer.snapshot();
  assert.deepEqual(stats.live, { Image: 1, OffscreenCanvas: 1, HTMLCanvasElement: 1 });
  assert.equal(stats.rgbaBytesEstimate.Image, 80);
  assert.equal(stats.rgbaBytesEstimate.OffscreenCanvas, 168);
});

function fakeCanvas() {
  const canvas = { width: 1, height: 1, style: {}, remove() {} };
  const noop = () => {};
  const context = new Proxy({ canvas, globalAlpha: 1,
    getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  }, { get(target, key) { return key in target ? target[key] : noop; } });
  canvas.getContext = () => context; return canvas;
}

test('host executes the real production renderer for every frozen entry with bounded body cache', async () => {
  // Geometry/lifecycle wiring only. Fake Canvas/Path2D deliberately cannot certify pixels or Electron memory.
  const require = createRequire(import.meta.url);
  globalThis.Image = require('../../test-support/raster-browser-image.js').RasterBrowserImage;
  globalThis.Path2D = class { addPath() {} };
  globalThis.document = { createElement: () => fakeCanvas(), querySelector: () => ({ append() {} }) };
  globalThis.window = { devicePixelRatio: 1.25 };
  const source = await loadProduction();
  await Promise.all(Object.values(source.companion.forms.PET_FORMS).map(form => source.companion.formArt.prepareArtwork(form, { all: true })));
  let frames = 0;
  const productionCreate = source.renderer.createPetRenderer;
  source.renderer = { ...source.renderer, createPetRenderer(options) {
    const painter = productionCreate(options);
    return { executeFrame(frame) { assert.ok(Object.isFrozen(frame)); frames++; return painter.executeFrame(frame); } };
  } };
  const host = createPainterHost(source, 1.25, BASELINE.seed);
  for (let index = 0; index < scenario.length * 2; index++) {
    const at = index * BASELINE.stepMs, item = scenarioAt(scenario, at);
    host.select(item.entry, item.startedAt); host.draw(at + 1000, 16.67);
    await new Promise(resolve => setImmediate(resolve));
    const result = host.snapshot();
    assert.ok(result.caches.body.entries <= 32);
    assert.equal(result.current.id, item.entry.id);
    assert.equal(result.current.skin, item.entry.skin);
    assert.equal(result.caches.dango.source.failed, 0);
    assert.equal(result.caches.usagi.wardrobe.failed, 0);
    assert.equal(result.opaqueBodyPixels, 0, 'mock rendering must never produce pixel evidence');
  }
  assert.equal(frames, 120); host.dispose();
  assert.equal(host.snapshot().caches.body.entries, 0);
});

test('v3 clock anchors first genuine rAF even before setup time and rejects later backward/nonfinite ticks', () => {
  const setupPerformanceNow = 1000, clock = createFrameClock();
  const first = clock.tick(setupPerformanceNow - 2.3);
  assert.deepEqual(first, { first: true, origin: 997.7, elapsedMs: 0, deltaMs: 0 });
  const second = clock.tick(1014.37);
  assert.ok(Math.abs(second.deltaMs - 16.67) < 1e-8);
  assert.ok(Math.abs(second.elapsedMs - 16.67) < 1e-8);
  assert.throws(() => clock.tick(1013), /backward/);
  assert.throws(() => clock.tick(NaN), /finite/);
  assert.throws(() => clock.tick(Infinity), /finite/);
  assert.throws(() => clock.tick(-1), /nonnegative/);
  const third = clock.tick(1031.04);
  assert.ok(Math.abs(third.deltaMs - 16.67) < 1e-8, 'invalid input does not advance or clamp the clock');
});

test('v3 startup settles before one measurement boundary and preserves timestamped phase evidence', async () => {
  let now = 0;
  const sources = { window: new EventEmitter(), app: new EventEmitter(), powerMonitor: new EventEmitter(), screen: new EventEmitter() };
  const observer = observeNativeEvents({ ...sources, now: () => now });
  sources.screen.emit('display-metrics-changed', {}, { id: 1, scaleFactor: 1.25 }, ['workArea']);
  assert.throws(() => observer.beginMeasurement(), /not settled/);
  await waitForDisplaySettle(observer, { now: () => now, delay: async ms => { now += ms; } });
  const boundary = observer.beginMeasurement();
  assert.equal(boundary.startupNativeEvents.displayMetricsChanged, 1);
  assert.equal(observer.snapshot().displayMetricsChanged, 0);
  assert.throws(() => observer.beginMeasurement(), /only once/);
  now += 5;
  sources.screen.emit('display-metrics-changed', {}, { id: 1, scaleFactor: 1.5 }, ['scaleFactor']);
  sources.powerMonitor.emit('lock-screen');
  assert.equal(observer.snapshot().displayMetricsChanged, 1);
  assert.equal(observer.snapshot().lockScreen, 1);
  const audit = observer.audit();
  assert.equal(audit.events[0].phase, 'initializing');
  assert.equal(audit.events[1].phase, 'measuring');
  assert.equal(audit.events[1].atMonotonicMs, 1005);
  assert.deepEqual(audit.events[1].details.changedMetrics, ['scaleFactor']);
  assert.equal(audit.events[1].details.scaleFactor, 1.5);
  for (let i = 0; i < NATIVE_AUDIT_LIMIT; i++) sources.window.emit('hide');
  assert.equal(observer.audit().events.length, NATIVE_AUDIT_LIMIT);
  assert.equal(observer.audit().truncated, true);
  assert.equal(observer.snapshot().hide, NATIVE_AUDIT_LIMIT);
  observer.stop();
});

test('v3 unsettled display initialization has a bounded failure instead of resetting measured events', async () => {
  let now = 0;
  const sources = { window: new EventEmitter(), app: new EventEmitter(), powerMonitor: new EventEmitter(), screen: new EventEmitter() };
  const observer = observeNativeEvents({ ...sources, now: () => now });
  await assert.rejects(waitForDisplaySettle(observer, { now: () => now, delay: async ms => {
    now += ms; sources.screen.emit('display-metrics-changed');
  } }), /startup budget/);
  assert.equal(now, STARTUP_POLICY.timeoutMs); observer.stop();
});

test('v3 gate requires first-frame, settled boundary and audit evidence without excusing startup power/native failures', () => {
  for (const mutate of [
    report => { delete report.measurementBoundary; },
    report => { report.measurementBoundary.beforeRendererStart = false; },
    report => { report.measurementBoundary.quietForMs = 999; },
    report => { report.measurementBoundary.startupNativeEvents.lockScreen = 1; },
    report => { report.measurementBoundary.startupNativeEvents.suspend = 1; },
    report => { report.measurementBoundary.startupNativeEvents.hide = 1; },
    report => { report.measurementBoundary.startupNativeEvents.displayAdded = 1; },
    report => { report.environment.renderer.firstFrameTimestamp = NaN; },
    report => { report.environment.renderer.clockOrigin = 'performance.now'; },
    report => { delete report.nativeEventAudit; },
    report => { report.nativeEventAudit.truncated = true; }
  ]) {
    const report = completeFixture(); mutate(report);
    assert.equal(assessReport(report).verdict, 'NOT PASSED', mutate.toString());
  }
  const report = completeFixture();
  report.measurementBoundary.startupNativeEvents.displayMetricsChanged = 2;
  report.nativeEventAudit.totalEvents = 2;
  report.nativeEventAudit.events = [50, 100].map(atMonotonicMs => ({ atMonotonicMs, phase: 'initializing',
    event: 'displayMetricsChanged', details: { id: 1, changedMetrics: ['workArea'] } }));
  assert.equal(assessReport(report).verdict, 'PASSED', 'only recorded, settled, pre-boundary display metrics are initialization');
  report.nativeEventAudit.events[1].phase = 'measuring';
  assert.equal(assessReport(report).verdict, 'NOT PASSED', 'late events cannot be relabeled or discarded');
});

test('v3 accepts the exact real RTX4080 hardware schema with absent softwareRendering and rejects uncertain/software variants', () => {
  const report = completeFixture();
  report.environment.gpu = {
    infoUpdated: true,
    featureStatus: { gpu_compositing: 'enabled', rasterization: 'enabled', '2d_canvas': 'enabled', webgl: 'enabled', webgpu: 'enabled', video_decode: 'enabled', video_encode: 'enabled', opengl: 'enabled_on' },
    info: {
      gpuDevice: [
        { active: true, deviceId: 9988, deviceString: 'NVIDIA GeForce RTX 4080', driverVendor: 'NVIDIA', driverVersion: '32.0.15.9186', gpuPreference: 0, revision: 161, subSysId: -2000023485, vendorId: 4318 },
        { active: false, deviceId: 140, deviceString: 'Microsoft Basic Render Driver', driverVersion: '10.0.26100.9278', gpuPreference: 0, revision: 0, subSysId: 0, vendorId: 5140 }
      ],
      auxAttributes: {
        glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.15.9186)',
        glVendor: 'Google Inc. (NVIDIA)', displayType: 'ANGLE_D3D11', glImplementationParts: '(gl=egl-angle,angle=d3d11)',
        inProcessGpu: false, sandboxed: true
      }
    }
  };
  assert.equal(assessReport(report).verdict, 'PASSED', 'inactive software adapter must not poison active hardware');
  for (const mutate of [
    copy => { copy.environment.gpu.info.auxAttributes.softwareRendering = true; },
    copy => { copy.environment.gpu.info.auxAttributes.softwareRendering = null; },
    copy => { copy.environment.gpu.info.auxAttributes.glRenderer = 'SwiftShader D3D11'; },
    copy => { copy.environment.gpu.info.auxAttributes = {}; },
    copy => { copy.environment.gpu.info.auxAttributes = { glRenderer: 'unknown renderer', displayType: 'unknown' }; },
    copy => { copy.environment.gpu.info.gpuDevice[0].deviceString = 'Microsoft Basic Render Driver'; },
    copy => { copy.environment.gpu.featureStatus.gpu_compositing = 'disabled_software'; }
  ]) {
    const copy = structuredClone(report); mutate(copy);
    assert.equal(assessReport(copy).verdict, 'NOT PASSED', mutate.toString());
  }
});

test('v3 page start awaits a real successful frame and later backward time stops once', async () => {
  const original = { Image: globalThis.Image, document: globalThis.document, window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
    performance: globalThis.performance };
  const pending = new Map(); let serial = 0;
  globalThis.document = { visibilityState: 'visible', createElement: () => fakeCanvas(), querySelector: () => ({ append() {} }) };
  globalThis.window = { devicePixelRatio: 1.25, addEventListener() {} };
  globalThis.performance = { now: () => 1000 };
  globalThis.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
  globalThis.cancelAnimationFrame = handle => pending.delete(handle);
  const next = timestamp => { const [id, callback] = pending.entries().next().value; pending.delete(id); callback(timestamp); };
  try {
    const page = await import(`./page.mjs?clock-regression`);
    let ready = false;
    const started = page.start().then(result => { ready = true; return result; });
    for (let i = 0; !pending.size && i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.size, 1); assert.equal(ready, false);
    next(997.7);
    const metadata = await started;
    assert.equal(metadata.clockOrigin, 'first-genuine-rAF'); assert.equal(metadata.firstFrameTimestamp, 997.7);
    assert.equal(page.sample().elapsedMs, 0); assert.equal(page.sample().frameIntervals.count, 0);
    next(1014.37); next(1031.04);
    assert.equal(page.sample().frameIntervals.count, 2);
    assert.ok(Math.abs(page.sample().elapsedMs - 33.34) < 1e-8);
    next(1030);
    const failed = page.sample();
    assert.equal(failed.running, false); assert.equal(failed.errorCount, 1); assert.match(failed.errors[0], /backward/);
    assert.equal(pending.size, 0); page.stop();
    const firstFailure = await import('./page.mjs?first-frame-failure');
    const failedStart = assert.rejects(firstFailure.start(), /finite/);
    for (let i = 0; !pending.size && i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.size, 1); next(NaN); await failedStart;
    assert.equal(firstFailure.sample().running, false); assert.equal(firstFailure.sample().errorCount, 1);
    assert.equal(firstFailure.sample().drawDurations.count, 0);
    assert.equal(pending.size, 0); firstFailure.stop();
  } finally { Object.assign(globalThis, original); }
});

test('diagnostics distinguish completed code-2 gate rejection from execution and protocol failures', () => {
  const rejected = completeFixture(); rejected.launch.code = 2;
  rejected.samples.forEach((sample, index) => {
    sample.rendererProcess.rssBytes += index * 4096;
    sample.processes.find(process => process.type === 'Tab').rssBytes = sample.rendererProcess.rssBytes;
  });
  const result = assessReport(rejected);
  assert.equal(result.gateVersion, 3); assert.equal(result.diagnosticsVersion, 1);
  assert.equal(result.verdict, 'NOT PASSED'); assert.equal(result.executionOutcome, 'completed/gate-rejected');
  assert.deepEqual(result.executionReasons, []);
  assert.ok(result.measurementReasons.some(reason => reason.startsWith('rendererRss blocked by')));
  assert.ok(result.reasons.every(reason => !/abnormal/i.test(reason)));
  assert.equal(result.trends.rendererRss.sustainedGrowth, true, 'tiny 4KiB increments retain the frozen rule');
  assert.equal(result.trends.rendererRss.exceedsFinalGrowthGuard, false);
  const normal = assessReport(completeFixture());
  assert.equal(normal.executionOutcome, 'completed/gate-passed'); assert.equal(normal.verdict, 'PASSED');
  const signaled = completeFixture(); signaled.launch = { code: null, signal: 'SIGTERM', stopReason: null };
  assert.equal(assessReport(signaled).executionOutcome, 'execution-failed/abnormal-exit');
  const protocol = completeFixture(); protocol.launch.code = 2;
  const inconsistent = assessReport(protocol);
  assert.equal(inconsistent.executionOutcome, 'execution-failed/inconsistent-exit-code');
  assert.equal(inconsistent.verdict, 'NOT PASSED');
  for (const mutate of [
    report => { report.launch.code = 1; }, report => { report.launch.signal = 'SIGTERM'; report.launch.code = null; },
    report => { report.launch.stopReason = 'timeout'; }, report => { delete report.launch; },
    report => { report.launch.code = 2; report.samples.pop(); },
    report => { report.launch.code = 2; report.status = 'interrupted'; },
    report => { report.launch.code = 2; report.samples[6].renderer.elapsedMs = 10; }
  ]) {
    const report = completeFixture(); mutate(report); const gate = assessReport(report);
    assert.equal(gate.verdict, 'NOT PASSED', mutate.toString());
    assert.match(gate.executionOutcome, /^execution-/); assert.ok(gate.executionReasons.length);
  }
});

test('growth diagnostics explain unchanged plateau, noisy, monotonic-low-fit and final-limit rules', () => {
  const trend = values => memoryTrend(values.map((bytes, index) => ({ minutes: 5 + index * 5, bytes })));
  const plateau = trend([100000, 100000, 100000, 100000, 100000, 100000]);
  assert.equal(plateau.sustainedGrowth, false); assert.equal(plateau.allStepsPositive, false);
  assert.equal(plateau.positiveSlopeHighRSquared, false); assert.equal(plateau.exceedsFinalGrowthGuard, false);
  const noisy = trend([100000, 103000, 99000, 101000, 98000, 100000]);
  assert.equal(noisy.sustainedGrowth, false); assert.equal(noisy.exceedsFinalGrowthGuard, false);
  const monotonicLowFit = trend([100000, 101000, 101001, 101002, 101003, 101004]);
  assert.equal(monotonicLowFit.allStepsPositive, true); assert.equal(monotonicLowFit.positiveSlopeHighRSquared, false);
  assert.equal(monotonicLowFit.exceedsFinalGrowthGuard, false); assert.equal(monotonicLowFit.sustainedGrowth, true);
  const limitOnly = trend([100000, 125000, 80000, 120000, 95000, 111000]);
  assert.equal(limitOnly.allStepsPositive, false); assert.equal(limitOnly.positiveSlopeHighRSquared, false);
  assert.equal(limitOnly.exceedsFinalGrowthGuard, true); assert.equal(limitOnly.sustainedGrowth, false);
  assert.equal(limitOnly.n, 6); assert.deepEqual(limitOnly.window, { firstMinute: 5, lastMinute: 30, durationMinutes: 25 });
  assert.equal(limitOnly.deltaMiB, 11000 / 1048576); assert.equal(limitOnly.finalGrowthPercent, 11);
});

test('exact native c9 curves stay NOT PASSED for monotonic/high-fit growth, not the 10% guard or execution', () => {
  const fixture = createRequire(import.meta.url)('./fixtures/native-c9-curves.json');
  const report = completeFixture(); report.launch.code = 2;
  fixture.points.forEach((point, index) => {
    const sample = report.samples[index + 1]; sample.elapsedMs = point.elapsedMs;
    sample.main.rssBytes = point.mainRssBytes; sample.main.heapUsedBytes = point.mainHeapUsedBytes;
    sample.rendererProcess.rssBytes = point.rendererRssBytes; sample.renderer.jsHeap.usedSize = point.rendererHeapUsedBytes;
    for (const process of sample.processes) process.rssBytes = ({ Browser: point.browserRssBytes,
      Tab: point.rendererRssBytes, GPU: point.gpuRssBytes, Utility: point.utilityRssBytes })[process.type];
  });
  const gate = assessReport(report);
  assert.equal(gate.verdict, 'NOT PASSED'); assert.equal(gate.executionOutcome, 'completed/gate-rejected');
  assert.deepEqual(gate.executionReasons, []); assert.equal(gate.measurementReasons.length, 3);
  for (const name of ['rendererRss', 'allProcessesAggregateRss']) {
    const trend = gate.trends[name];
    assert.equal(trend.allStepsPositive, true); assert.equal(trend.positiveSlopeHighRSquared, true);
    assert.equal(trend.exceedsFinalGrowthGuard, false); assert.equal(trend.samples, 6); assert.equal(trend.positiveSteps, 5);
  }
  assert.equal(gate.trends.rendererRss.deltaBytes, 4644864);
  assert.equal(gate.trends.allProcessesAggregateRss.deltaBytes, 5722112);
  assert.ok(Math.abs(gate.trends.rendererRss.rSquared - 0.8722876305978055) < 1e-12);
  assert.ok(Math.abs(gate.trends.allProcessesAggregateRss.rSquared - 0.9248040153389033) < 1e-12);
  assert.equal(gate.seriesRelationships.rendererRssAlias, 'Tab:101:1000');
  assert.deepEqual(gate.trends.rendererRss, gate.processTrends['Tab:101:1000']);
  for (const name of ['mainRss', 'gpuAggregateRss', 'mainJsHeap', 'rendererJsHeap']) {
    assert.equal(gate.trends[name].sustainedGrowth, false); assert.equal(gate.trends[name].exceedsFinalGrowthGuard, false);
  }
});
