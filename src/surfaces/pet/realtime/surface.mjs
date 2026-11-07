import { createPetLifecycle } from '../lifecycle.mjs';
import { createPetSync } from '../sync.mjs';
import { resolveSensoryPolicy } from '../../../core/sensory-policy.mjs';
import { createFrameMetrics } from './frame-metrics.mjs';
import { createStartupMetrics } from './startup-metrics.mjs';
import { createErrorJournal, errorMessage } from './error-journal.mjs';

/** One presentation owner in the actual pet surface. No canonical writes or private IPC. */
export function createRealtimePetSurface({ environment, clients, loadStage }) {
  const { document, window } = environment;
  const canvas = document.getElementById('character'), status = document.getElementById('status');
  const lifecycle = createPetLifecycle(environment), clock = { time: 0 };
  const metrics = createFrameMetrics(), startup = createStartupMetrics(environment.performance.now());
  const errors = createErrorJournal();
  const recordError = (operation, error) => errors.record(operation, error, environment.performance.now());
  let instanceId = 'unavailable';
  try {
    const id = environment.crypto?.randomUUID?.();
    if (typeof id === 'string' && id.length > 0 && id.length <= 128) instanceId = id;
  } catch { /* A collector must reject unknown generation identity, not guess it. */ }
  const auditRows = new Array(512);
  let auditTotal = 0, auditCount = 0, auditCursor = 0, lastMode = null, lastPolicy = null, terminalStage = null;
  function audit(type, fields = {}) {
    const atMs = environment.performance.now();
    const row = { sequence: ++auditTotal, atMs: Number.isFinite(atMs) && atMs >= 0 ? atMs : null, type };
    if (Number.isSafeInteger(fields.pointerId) && fields.pointerId >= 0) row.pointerId = fields.pointerId;
    if (typeof fields.isTrusted === 'boolean') row.isTrusted = fields.isTrusted;
    if (typeof fields.mode === 'string' && fields.mode.length <= 64) row.mode = fields.mode;
    auditRows[auditCursor] = Object.freeze(row); auditCursor = (auditCursor + 1) % 512;
    auditCount = Math.min(512, auditCount + 1);
  }
  function readEvents() {
    const oldest = (auditCursor - auditCount + 512) % 512;
    return { total: auditTotal, overwritten: auditTotal - auditCount,
      rows: Array.from({ length: auditCount }, (_, index) => ({ ...auditRows[(oldest + index) % 512] })) };
  }
  // Terminal retention contains only bounded counters/flags, never scene or buffer references.
  function counters(value, depth = 0) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (!value || typeof value !== 'object' || depth > 4) return null;
    if (Array.isArray(value)) return value.slice(0, 8).map(child => counters(child, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 32)
      .filter(([, child]) => typeof child !== 'string' && typeof child !== 'function')
      .map(([key, child]) => [key, counters(child, depth + 1)]));
  }
  function captureTerminal(owner) {
    try {
      const value = owner?.readDiagnostics?.();
      if (value) terminalStage = { mode: typeof value.mode === 'string' ? value.mode.slice(0, 64) : 'unavailable',
        pointerId: Number.isSafeInteger(value.pointerId) && value.pointerId >= 0 ? value.pointerId : null,
        captured: Boolean(value.captured), pendingCount: counters(value.pendingCount),
        renderedFrames: counters(value.renderedFrames), construction: counters(value.construction), resources: counters(value.resources), pool: counters(value.pool) };
    } catch (error) { recordError('terminal-diagnostics', `Terminal diagnostics failed: ${errorMessage(error)}`); }
  }
  audit('created');
  const context = { motionMode: 'reduced', stimulationMode: 'low', dnd: false, paused: false, screenLocked: false };
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let stage = null, startPromise = null, closed = false, frame = null, ready = false;
  let manualPaused = false, contextLost = false, dirty = true, pendingOperations = 0;
  let lastNow = environment.performance.now(), lastFrame = null, failure = null;
  let viewport = null, viewportRevision = 0, pointerSpace = null, pointerSpaceReceivedAt = 0, docked = false, unsubscribeViewport = null, lastPublication = null;
  const note = (error, operation) => {
    const message = recordError(operation, error);
    if (closed) return;
    status.textContent = `角色不可用：${message}`;
    document.body.dataset.error = 'true';
  };
  function invokeClient(operation, callback, terminal = false) {
    pendingOperations++;
    Promise.resolve().then(() => { if (!closed || terminal) return callback(); }).catch(error => {
      if (operation === 'terminal-runtime-publication')
        recordError(operation, `Terminal runtime publication failed: ${errorMessage(error)}`);
      else note(error, operation);
    }).finally(() => { pendingOperations--; });
  }
  const policy = () => {
    const sensory = resolveSensoryPolicy({ ...context, systemReducedMotion: media.matches });
    return { reducedMotion: sensory.calmVisuals, hidden: document.hidden || context.screenLocked || docked,
      paused: manualPaused || context.paused || contextLost };
  };
  const continuous = () => { const value = policy(); return !value.hidden && !value.paused && !value.reducedMotion; };
  function publishRuntime() {
    if (closed) return;
    const value = policy();
    const runtime = { visible: ready && !value.hidden, menuOpen: false,
      dragging: (stage?.readMode?.() ?? stage?.snapshot().state?.mode) === 'drag', prefersReducedMotion: value.reducedMotion };
    const key = JSON.stringify(runtime);
    if (key === lastPublication) return;
    lastPublication = key;
    invokeClient('runtime-publication', () => clients.pet_updateRuntime(runtime));
  }
  function cancelFrame() {
    if (frame !== null) lifecycle.cancelAnimationFrame(frame);
    frame = null;
  }
  function advanceClock(now) {
    if (continuous()) clock.time += Math.min(.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
  }
  function schedule() {
    if (!closed && ready && frame === null && !failure && (dirty || continuous()) && !policy().hidden)
      frame = lifecycle.requestAnimationFrame(drawFrame);
  }
  function fail(error, operation, alreadyRecorded = false) {
    failure = error; audit('failed');
    if (!alreadyRecorded) note(error, operation);
    cancelFrame();
    try { stage?.suspend(); } catch (cleanup) { note(cleanup, 'suspend'); }
    dispose();
  }
  function drawFrame(now) {
    frame = null;
    if (closed || !stage || failure) return;
    try {
      advanceClock(now);
      const value = policy();
      if (!value.hidden && (dirty || continuous())) {
        const before = environment.performance.now();
        stage.update(clock.time, { hidden: value.paused, reducedMotion: value.reducedMotion });
        const mode = stage.readMode?.() ?? stage.snapshot().state?.mode;
        if (mode !== lastMode) { lastMode = mode; audit('mode', { mode }); }
        const updated = environment.performance.now();
        stage.render();
        const rendered = environment.performance.now();
        startup.frame(now, before, updated, rendered);
        // No zero/paused interval is mixed into the continuous frame distribution.
        if (continuous() && lastFrame !== null) metrics.record(now - lastFrame, updated - before, rendered - updated, now);
        lastFrame = continuous() ? now : null;
        const statusText = value.paused ? '开发角色 · 已暂停' : value.reducedMotion ? '开发角色 · 静态策略' : '开发角色 · 实时';
        if (status.textContent !== statusText) status.textContent = statusText;
        dirty = false; publishRuntime();
      }
    } catch (error) { fail(error, 'frame'); }
    schedule();
  }
  function refresh() {
    if (closed) return;
    lastNow = environment.performance.now(); lastFrame = null; dirty = true;
    cancelFrame();
    try { if (!continuous()) stage?.suspend(); } catch (error) { fail(error, 'suspend'); return; }
    const value = policy(), policyKey = [value.hidden ? 'hidden' : 'visible', value.paused ? 'paused' : 'running',
      value.reducedMotion ? 'reduced' : 'full'].join('/');
    if (policyKey !== lastPolicy) { lastPolicy = policyKey; audit('policy', { mode: policyKey }); }
    publishRuntime(); schedule();
  }
  function cancel() {
    if (closed || !stage || failure) return;
    try { stage.cancel(); audit('cancel'); refresh(); } catch (error) { fail(error, 'cancel'); }
  }
  function pause(value = !manualPaused) {
    if (closed) return;
    manualPaused = Boolean(value);
    document.getElementById('pause').textContent = manualPaused ? '继续' : '暂停';
    refresh();
  }
  function applyViewport(value) {
    if (closed || !value || !Number.isFinite(value.stageOffset?.x) || !Number.isFinite(value.stageOffset?.y)) return;
    viewport = { width: value.width, height: value.height, stageOffset: { ...value.stageOffset } };
    viewportRevision++;
    try { pointerSpace = value.pointerSpace ? structuredClone(value.pointerSpace) : null; }
    catch { pointerSpace = null; }
    pointerSpaceReceivedAt = environment.performance.now();
    document.documentElement.style.setProperty('--stage-dx', `${value.stageOffset.x}px`);
    document.documentElement.style.setProperty('--stage-dy', `${value.stageOffset.y}px`);
    try { stage?.setPointerSpace?.(pointerSpace, pointerSpaceReceivedAt); stage?.resize(); refresh(); } catch (error) { fail(error, 'resize'); }
  }
  const sync = createPetSync({ client: clients,
    onSync(data) { Object.assign(context, data); refresh(); },
    onDock(data) { docked = Boolean(data?.edge); refresh(); },
    onCue(cue) {
      // G1 has no action adapter: explicitly reject, never leave Director's lease pending.
      if (cue?.decisionId) invokeClient('cue-ack', () => clients.pet_ackCue({ decisionId: cue.decisionId, status: 'rejected' }));
    }
  });
  function dispose() {
    if (closed) return;
    closed = true; ready = false;
    // Retire the published presentation lease; no business mutation or retry.
    invokeClient('terminal-runtime-publication', () => clients.pet_updateRuntime({ visible: false, menuOpen: false,
      dragging: false, prefersReducedMotion: policy().reducedMotion }), true);
    // Retire the heavy owner before callbacks; retain only copied terminal counters.
    const retiredStage = stage; stage = null;
    for (const [operation, release] of [
      ['cleanup-lifecycle', () => lifecycle.dispose()], ['cleanup-sync', () => sync.dispose()],
      ['cleanup-viewport', () => { const unsubscribe = unsubscribeViewport; unsubscribeViewport = null; unsubscribe?.(); }],
      ['cleanup-stage', () => retiredStage?.dispose()]
    ]) {
      try { release(); } catch (error) { recordError(operation, `Realtime surface cleanup failed: ${errorMessage(error)}`); }
    }
    frame = null; captureTerminal(retiredStage); audit('disposed');
  }
  async function initialize() {
    try {
      sync.connect();
      unsubscribeViewport = clients.onPetViewport(applyViewport);
      lifecycle.listen(window, 'pagehide', dispose, { once: true });
      lifecycle.listen(window, 'blur', cancel);
      lifecycle.listen(window, 'focus', refresh);
      lifecycle.listen(document, 'pointerlockchange', () => {
        if (document.pointerLockElement !== null) {
          try { stage?.revokePointerSpace?.(); cancel(); } catch (error) { fail(error, 'cancel'); }
        }
      });
      lifecycle.listen(document, 'visibilitychange', refresh);
      lifecycle.listen(window, 'resize', () => { try { stage?.resize(); refresh(); } catch (error) { fail(error, 'resize'); } });
      lifecycle.listen(media, 'change', refresh);
      lifecycle.listen(window, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
      lifecycle.listen(canvas, 'webglcontextlost', event => { event.preventDefault(); contextLost = true; refresh(); });
      lifecycle.listen(canvas, 'webglcontextrestored', () => { contextLost = false; refresh(); });
      lifecycle.listen(document.getElementById('pause'), 'click', () => pause());
      lifecycle.listen(document.getElementById('cancel'), 'click', cancel);
      lifecycle.listen(document.getElementById('panel'), 'click', () => invokeClient('panel-open', () => clients.pet_openPanel()));
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'])
        lifecycle.listen(canvas, type, event => {
          advanceClock(environment.performance.now());
          if (type !== 'pointermove') audit(type, { pointerId: event.pointerId, isTrusted: event.isTrusted });
        }, { capture: true });
      for (const type of ['pointerup', 'pointercancel'])
        lifecycle.listen(window, type, event => {
          advanceClock(environment.performance.now());
          if (event.target !== canvas) audit(type, { pointerId: event.pointerId, isTrusted: event.isTrusted });
        }, { capture: true });
      const ticket = sync.beginHydration();
      // Track and handle hydration before awaiting the independent stage load:
      // a late rejection remains observable even if disposal skips hydration use.
      pendingOperations++;
      const hydration = Promise.resolve().then(() => clients.pet_getState()).then(
        value => ({ ok: true, value }), error => {
          note(error, 'hydration'); return { ok: false, error };
        }).finally(() => { pendingOperations--; });
      startup.stageStarted(environment.performance.now());
      stage = await loadStage({ canvas, clock, environment });
      if (!closed) stage.setPointerSpace?.(pointerSpace, pointerSpaceReceivedAt);
      startup.stageReady(environment.performance.now());
      if (closed) {
        const late = stage; stage = null;
        try { late.dispose(); } catch (error) { recordError('late-stage-cleanup', `Late stage cleanup failed: ${errorMessage(error)}`); }
        captureTerminal(late);
        return false;
      }
      const hydrated = await hydration;
      if (closed) return false;
      if (!hydrated.ok) { fail(hydrated.error, 'hydration', true); return false; }
      sync.hydrate(hydrated.value, ticket);
      ready = true; startup.ready(environment.performance.now()); document.documentElement.dataset.ready = 'true'; audit('ready'); refresh();
      return true;
    } catch (error) {
      if (!closed) fail(error, 'initialization');
      else recordError('late-initialization', error);
      return false;
    }
  }
  return Object.freeze({
    start() { if (closed) return Promise.resolve(false); return startPromise ??= initialize(); },
    pause, cancel, dispose,
    // Read-only diagnostic receipt. screenX/Y and client rect are observations at this
    // renderer turn, never a historical pointer sample or native/compositor ACK.
    readWindowGeometry() {
      const state = stage?.readDiagnostics?.() ?? null;
      const rect = canvas.getBoundingClientRect();
      const finite = value => Number.isFinite(value) ? value : null;
      return { instanceId, ready, closed, paused: policy().paused, viewportRevision,
        pointerId: state?.pointerId ?? null, captured: state?.captured ?? null, pendingCount: state?.pendingCount ?? null,
        domPointerCapture: Number.isSafeInteger(state?.pointerId) ? canvas.hasPointerCapture(state.pointerId) : false,
        screen: { x: finite(window.screenX), y: finite(window.screenY) },
        stageClientRect: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, finite(rect[key])])),
        viewport: viewport ? structuredClone(viewport) : null };
    },
    readDiagnostics(options) {
      const frames = metrics.readSince(options);
      return { schemaVersion: 1, instanceId, ready, closed, time: clock.time, frameScheduled: frame !== null, pendingOperations, policy: policy(), frames, startup: startup.snapshot(),
        stage: closed ? (terminalStage ? structuredClone(terminalStage) : null) : stage?.readDiagnostics?.() ?? null,
        events: readEvents(), errorLog: errors.snapshot(), errors: errors.messages() };
    },
    snapshot: () => ({ ready, closed, time: clock.time, policy: policy(), context: { ...context }, viewport,
      frameScheduled: frame !== null, error: failure?.message ?? null, errors: errors.messages(),
      metrics: metrics.snapshot(), stage: stage?.snapshot() ?? null,
      productionAccepted: false, nativePerformanceAccepted: false })
  });
}
