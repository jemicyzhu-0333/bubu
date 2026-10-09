import { BASELINE } from './scenario.mjs';
import { memoryTrend } from './statistics.mjs';
import { DIAGNOSTICS_VERSION, classifyExecution, describeGrowthRejection } from './diagnostics.mjs';
import { NATIVE_EVENT_KEYS, STARTUP_POLICY, NATIVE_AUDIT_LIMIT } from './native-events.mjs';

export const GATE_VERSION = 3;
const processIdentity = process => `${process.type}:${process.pid}:${process.creationTime}`;

function processSeries(samples, reasons) {
  let expected = null;
  const all = [], gpu = [], individual = new Map();
  for (const sample of samples) {
    const entries = sample.processes;
    const valid = Array.isArray(entries) && entries.length > 0 && entries.every(entry => entry
      && typeof entry.type === 'string' && entry.type.length > 0
      && Number.isInteger(entry.pid) && entry.pid > 0
      && Number.isFinite(entry.creationTime) && entry.creationTime > 0
      && Number.isFinite(entry.rssBytes) && entry.rssBytes > 0);
    if (!valid) {
      reasons.push('Full post-warmup process RSS and identity evidence is missing or invalid.');
      all.push(NaN); gpu.push(NaN); continue;
    }
    const identities = entries.map(processIdentity).sort();
    if (new Set(identities).size !== entries.length || new Set(entries.map(entry => entry.pid)).size !== entries.length) {
      reasons.push('Process identity evidence contains duplicate entries.');
    }
    if (expected === null) expected = identities;
    else if (JSON.stringify(identities) !== JSON.stringify(expected)) {
      reasons.push('The post-warmup process set changed: restart, missing series, or new process requires review.');
    }
    const main = entries.find(entry => entry.pid === sample.main?.pid && entry.type === 'Browser');
    const renderer = entries.find(entry => entry.pid === sample.rendererProcess?.pid && entry.type === 'Tab');
    if (!main || !renderer || processIdentity(renderer) !== processIdentity(sample.rendererProcess)
      || renderer.rssBytes !== sample.rendererProcess.rssBytes) {
      reasons.push('Main or renderer identity is missing or inconsistent with the full process sample.');
    }
    const gpuEntries = entries.filter(entry => entry.type === 'GPU');
    if (!gpuEntries.length) reasons.push('GPU process RSS evidence is missing.');
    all.push(entries.reduce((total, entry) => total + entry.rssBytes, 0));
    gpu.push(gpuEntries.length ? gpuEntries.reduce((total, entry) => total + entry.rssBytes, 0) : NaN);
    for (const entry of entries) {
      const id = processIdentity(entry);
      if (!individual.has(id)) individual.set(id, []);
      individual.get(id).push({ minutes: sample.elapsedMs / 60_000, bytes: entry.rssBytes });
    }
  }
  return { all, gpu, individual };
}

export function initialReport(options) {
  return { schemaVersion: 1, gateVersion: GATE_VERSION, diagnosticsVersion: DIAGNOSTICS_VERSION, scope: 'Current production createPetRenderer in one shown, non-minimized transparent Electron window',
    status: 'starting', startedAt: new Date().toISOString(), options, baseline: BASELINE,
    environment: null, samples: [], errors: [],
    limitations: ['Observable canvas/image bytes are RGBA estimates, not native allocation or GPU texture accounting.',
      'Weak references do not force GC; uncollected objects are not proof of a leak.',
      'rAF and native visibility/events do not prove every frame reached physical scanout or remained unoccluded by other windows.',
      'GPU-process and aggregate all-process RSS are gated separately. Summed RSS can double-count shared pages; dedicated GPU texture memory remains unobservable.',
      'The finite scenario is not exhaustive all skin/action/outfit combinations or a two-hour release test.',
      'This painter host excludes whole-application skin drawers, detached portrait DOM, input routing, and business state.',
      'Main-process reports retain seven bounded samples. Tiny positive trends require review and may include instrumentation or allocator effects; they do not prove a leak.',
      'A sample-only canvas readback proves pixels exist and may perturb native memory; no per-frame readback or PNG encoding is used.'],
    gate: { gateVersion: GATE_VERSION, verdict: 'NOT PASSED', reasons: ['A complete 30-minute real Electron baseline has not been recorded.'] } };
}

export function assessReport(report, { requireLauncherExit = true } = {}) {
  const reasons = [], trends = {};
  if (!NATIVE_EVENT_KEYS.every(key => report.nativeEvents?.[key] === 0)) reasons.push('Native hide/minimize, power, display, or process-exit event evidence is missing or nonzero.');
  if (report.gateVersion !== GATE_VERSION) reasons.push('This report is not gateVersion 3 and cannot pass the corrected startup/frame-clock gate.');
  const samples = Array.isArray(report.samples) ? report.samples.filter(sample => sample && typeof sample === 'object') : [];
  const last = samples.at(-1), env = report.environment;
  const boundary = report.measurementBoundary;
  if (boundary?.phase !== 'measuring' || boundary.beforeRendererStart !== true
    || JSON.stringify(boundary.policy) !== JSON.stringify(STARTUP_POLICY)
    || !Number.isFinite(boundary.quietForMs) || boundary.quietForMs < STARTUP_POLICY.quietMs
    || !Number.isFinite(boundary.armedAtMonotonicMs)
    || boundary.displayId !== env?.display?.id || boundary.scaleFactor !== env?.display?.scaleFactor
    || !NATIVE_EVENT_KEYS.every(key => Number.isInteger(boundary.startupNativeEvents?.[key]) && boundary.startupNativeEvents[key] >= 0)
    || NATIVE_EVENT_KEYS.some(key => key !== 'displayMetricsChanged' && boundary?.startupNativeEvents?.[key] !== 0)) {
    reasons.push('Settled initialization/measurement boundary is missing or startup contained a disqualifying native event.');
  }
  const audit = report.nativeEventAudit;
  const auditValid = audit?.maxEvents === NATIVE_AUDIT_LIMIT && audit.truncated === false
    && Array.isArray(audit.events) && audit.events.length <= NATIVE_AUDIT_LIMIT && audit.totalEvents === audit.events.length
    && audit.events.every((event, index) => Number.isFinite(event?.atMonotonicMs)
      && event.atMonotonicMs >= 0 && (!index || event.atMonotonicMs >= audit.events[index - 1].atMonotonicMs)
      && NATIVE_EVENT_KEYS.includes(event.event) && event.details && typeof event.details === 'object'
      && ((event.phase === 'initializing' && event.atMonotonicMs <= boundary?.armedAtMonotonicMs)
        || (event.phase === 'measuring' && event.atMonotonicMs >= boundary?.armedAtMonotonicMs)))
    && NATIVE_EVENT_KEYS.every(key => audit.events.filter(event => event.phase === 'initializing' && event.event === key).length === boundary?.startupNativeEvents?.[key]
      && audit.events.filter(event => event.phase === 'measuring' && event.event === key).length === report.nativeEvents?.[key]);
  if (!auditValid) reasons.push('Bounded native event phase/timestamp audit is missing, incomplete, or inconsistent.');
  if (env?.renderer?.clockOrigin !== 'first-genuine-rAF' || !Number.isFinite(env?.renderer?.firstFrameTimestamp)
    || env.renderer.firstFrameTimestamp < 0) reasons.push('A successful first genuine rAF clock origin is missing.');
  if (samples.length !== 7) reasons.push('Exactly seven full baseline samples are required.');
  if (JSON.stringify(report.baseline) !== JSON.stringify(BASELINE)) reasons.push('Recorded frozen thresholds differ from this harness.');
  if (!Array.isArray(report.errors)) reasons.push('Error evidence is missing.');
  if (report.status !== 'completed') reasons.push(`Run status is ${report.status || 'unknown'}.`);
  if (report.options?.smoke !== false || report.options?.durationMs !== BASELINE.durationMs || report.options?.sampleMs !== BASELINE.sampleMs) reasons.push('Short smoke runs are insufficient for the 30-minute gate.');
  if (!env?.versions?.electron || !env?.versions?.chrome || !env?.git?.commit || !/^[a-f0-9]{64}$/.test(env?.sourceDigest || '')) reasons.push('Version or source identity evidence is missing.');
  if (!env?.window?.transparent || env.window.offscreen !== false || !env.window.visible) reasons.push('Visible, non-offscreen transparent-window evidence is missing.');
  const gpuInfo = env?.gpu?.info;
  const activeGpu = Array.isArray(gpuInfo?.gpuDevice) && gpuInfo.gpuDevice.find(device => device?.active === true
    && ((Number.isInteger(device.vendorId) && device.vendorId > 0 && Number.isInteger(device.deviceId) && device.deviceId >= 0)
      || (typeof device.deviceString === 'string' && device.deviceString.trim().length > 0)));
  const rendererDescription = [activeGpu?.vendorString, activeGpu?.deviceString, gpuInfo?.auxAttributes?.glRenderer,
    gpuInfo?.auxAttributes?.glVendor].filter(value => typeof value === 'string').join(' ');
  const attributes = gpuInfo?.auxAttributes;
  const backend = [attributes?.glRenderer, attributes?.displayType, attributes?.glImplementationParts]
    .filter(value => typeof value === 'string').join(' ');
  const positiveHardwareBackend = typeof attributes?.glRenderer === 'string' && attributes.glRenderer.trim().length > 0
    && /Direct3D(?:11|12)|D3D(?:11|12)|\bMetal\b|\bVulkan\b|\bOpenGL\b/i.test(backend);
  const softwareEvidenceAcceptable = attributes?.softwareRendering === false
    || (attributes?.softwareRendering === undefined && positiveHardwareBackend);
  if (!activeGpu || !softwareEvidenceAcceptable || env?.gpu?.infoUpdated !== true
    || /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render|\bwarp\b/i.test(rendererDescription)
    || env?.gpu?.featureStatus?.gpu_compositing !== 'enabled') reasons.push('Active hardware GPU identity/compositing evidence is missing, software-rendered, or disabled.');
  if (env?.renderer?.painter !== 'src/surfaces/pet/renderer.mjs:createPetRenderer') reasons.push('Production painter identity is missing.');
  if (![env?.display?.scaleFactor, env?.renderer?.dpr, env?.display?.displayFrequency].every(value => Number.isFinite(value) && value > 0)) reasons.push('Physical display, refresh rate, or DPR evidence is missing.');
  if (!(last?.elapsedMs >= BASELINE.durationMs) || !(last?.renderer?.elapsedMs >= BASELINE.durationMs)) reasons.push('Both monotonic clocks must record at least 30 minutes.');
  for (let due = 0; due <= BASELINE.durationMs; due += BASELINE.sampleMs) {
    if (!samples.some(sample => sample.scheduledMs === due && sample.elapsedMs >= due
      && sample.elapsedMs - due <= 5_000)) reasons.push(`Missing or late sample at ${due / 60_000} minutes.`);
  }
  if (report.endSourceDigest !== env?.sourceDigest) reasons.push('Final unchanged-source verification is missing or differs.');
  const steady = samples.filter(sample => sample.scheduledMs >= BASELINE.warmupMs
    && sample.scheduledMs <= BASELINE.durationMs);
  const processes = processSeries(steady, reasons);
  const fields = {
    gpuAggregateRss: (_sample, index) => processes.gpu[index],
    allProcessesAggregateRss: (_sample, index) => processes.all[index],
    mainRss: sample => sample.main?.rssBytes,
    rendererRss: sample => sample.rendererProcess?.rssBytes,
    mainJsHeap: sample => sample.main?.heapUsedBytes,
    rendererJsHeap: sample => sample.renderer?.jsHeap?.usedSize
  };
  for (const [name, read] of Object.entries(fields)) {
    const trend = memoryTrend(steady.map((sample, index) => ({ minutes: sample.elapsedMs / 60_000, bytes: read(sample, index) })));
    trends[name] = trend;
    if (!trend) reasons.push(`${name} post-warmup memory evidence is incomplete.`);
    else if (trend.sustainedGrowth || trend.finalGrowthFraction === null
      || trend.finalGrowthFraction > BASELINE.maxFinalGrowthFraction) reasons.push(describeGrowthRejection(name, trend));
  }
  const processTrends = {};
  for (const [identity, points] of processes.individual) {
    const trend = points.length === steady.length ? memoryTrend(points) : null;
    processTrends[identity] = trend;
    if (!trend) reasons.push(`Process ${identity} has an incomplete post-warmup series.`);
    else if (trend.sustainedGrowth || trend.finalGrowthFraction === null
      || trend.finalGrowthFraction > BASELINE.maxFinalGrowthFraction) reasons.push(describeGrowthRejection(`Process ${identity}`, trend));
  }
  for (const sample of samples) {
    const state = sample.renderer;
    if (!NATIVE_EVENT_KEYS.every(key => sample.nativeEvents?.[key] === 0)) reasons.push('A native interruption occurred between samples or counter evidence is missing.');
    if (!state || state.running !== true || !['errorCount', 'hiddenFrames', 'dprChanges', 'skippedSteps'].every(key => state[key] === 0)
      || state.resources?.supported !== true || !state.caches?.body || !state.caches?.dango?.source
      || !state.caches?.usagi?.wardrobe || !['nodes', 'documents', 'jsEventListeners'].every(key => Number.isFinite(state.dom?.[key]))
      || (sample.scheduledMs >= BASELINE.warmupMs && !(state.opaqueBodyPixels > 0))) {
      reasons.push('Renderer, resource observation, visibility, scenario continuity, DOM, or painted-pixel evidence is incomplete.'); break;
    }
    if (!['entries', 'bytes'].every(key => Number.isFinite(state.caches.dango.palette?.[key]) && state.caches.dango.palette[key] >= 0)
      || !['live', 'created', 'rgbaBytesEstimate'].every(key => state.resources[key] && typeof state.resources[key] === 'object'
        && !Array.isArray(state.resources[key]) && Object.values(state.resources[key]).every(value => Number.isFinite(value) && value >= 0))
      || !(state.resources.live?.HTMLCanvasElement >= 3) || !(state.resources.created?.HTMLCanvasElement >= 6)
      || !(state.resources.rgbaBytesEstimate?.HTMLCanvasElement > 0)
      || (sample.scheduledMs >= BASELINE.warmupMs && !(state.resources.created?.Image > 0))) reasons.push('Observable tint, canvas, or image statistics are missing.');
    const sources = [state.caches.dango.source, state.caches.usagi.wardrobe, state.caches.usagi.ambient];
    if (sources.some(source => !source || !['entries', 'bytes', 'failed', 'loading'].every(key => Number.isFinite(source[key]) && source[key] >= 0)
      || source.failed > 0 || (sample.scheduledMs >= BASELINE.warmupMs && source.loading > 0))) {
      reasons.push('Production image loading failed or remained pending after warmup.'); break;
    }
    if (!Number.isInteger(state.caches.body.entries) || !Number.isInteger(state.caches.body.capacity)
      || state.caches.body.capacity !== 32 || state.caches.body.entries < 0 || state.caches.body.entries > state.caches.body.capacity) reasons.push('Body cache exceeded its declared capacity.');
    if (!sample.window?.visible || sample.window?.minimized) reasons.push('The native window was hidden or minimized during a sample.');
  }
  const timing = last?.renderer?.frameIntervals;
  if (!(timing?.count > 0) || !Number.isFinite(timing.p95Ms) || !(timing.p95Ms > 0 && timing.p95Ms <= BASELINE.maxFrameP95Ms)) reasons.push('Total rAF frame-interval p95 is missing or exceeds 20 ms.');
  if (!(last?.renderer?.step >= BASELINE.durationMs / BASELINE.stepMs)) reasons.push('The full repeating scenario was not observed.');
  if (!last?.renderer?.drawDurations?.count || !Number.isFinite(last.renderer.drawDurations.p95Ms)) reasons.push('Separate CPU draw-duration evidence is missing.');
  if (report.errors?.length) reasons.push('The run contains errors.');
  const measurementReasons = [...new Set(reasons)];
  const captureComplete = report.status === 'completed' && report.options?.smoke === false
    && report.options.durationMs === BASELINE.durationMs && report.options.sampleMs === BASELINE.sampleMs
    && samples.length === 7 && last?.elapsedMs >= BASELINE.durationMs && last?.renderer?.elapsedMs >= BASELINE.durationMs
    && last?.renderer?.step >= BASELINE.durationMs / BASELINE.stepMs
    && Array.from({ length: 7 }, (_, index) => index * BASELINE.sampleMs).every(due => samples.some(sample =>
      sample.scheduledMs === due && sample.elapsedMs >= due && sample.elapsedMs - due <= 5_000));
  const execution = classifyExecution(report, { measurementReasons, captureComplete, requireLauncherExit });
  const allReasons = [...measurementReasons, ...execution.reasons];
  const rendererIdentity = last?.rendererProcess ? processIdentity(last.rendererProcess) : null;
  return { gateVersion: GATE_VERSION, diagnosticsVersion: DIAGNOSTICS_VERSION,
    executionOutcome: execution.outcome, verdict: allReasons.length ? 'NOT PASSED' : 'PASSED',
    measurementReasons, executionReasons: execution.reasons, reasons: allReasons, trends, processTrends,
    seriesRelationships: { rendererRssAlias: rendererIdentity,
      allProcessAggregateMembers: [...processes.individual.keys()],
      note: 'rendererRss and its Tab process trend use the same RSS samples; the all-process sum includes that same renderer. These are dependent series, not independent evidence of multiple leaks.' },
    scope: '30-minute baseline only; does not clear the two-hour release, visual, or root-cause gates.' };
}
