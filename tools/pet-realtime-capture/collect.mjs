import { diagnosticReporter } from './diagnostics.mjs';
import { CAPTURE_LIMITS, appendCaptureError } from './report.mjs';

/** Fixed scenario over narrow owned-window ports. No generic script, profile or IPC input. */
export async function collectRealtime(report, ports, { screenshots = true } = {}) {
  let instance = null, epoch = null, cursor = 0, offset = 0, globalLast = 0, eventCursor = 0;
  let current = null, last = null, eventTotal = 0, rendererEventLoss = 0, disposing = false;
  const appendEvent = event => {
    eventTotal++;
    if (report.events.length < CAPTURE_LIMITS.events) report.events.push(event);
  };
  const diagnostics = diagnosticReporter(report);
  const error = code => appendCaptureError(report, { code, phase: current?.id ?? 'boundary' });
  const assertActive = () => { if (ports.signal?.aborted) throw new Error('capture-interrupted'); };
  async function poll(depth = 0, deadline = null) {
    if (depth > 16) throw new Error('diagnostic-page-limit');
    assertActive();
    const expected = instance;
    const remaining = deadline === null ? null : deadline - ports.now();
    if (remaining !== null && remaining <= 0) throw new Error('terminal-operations-read-timeout');
    const value = await ports.read({ afterSequence: cursor, limit: 600 }, remaining === null ? undefined : { timeoutMs: Math.min(2000, remaining) });
    assertActive();
    if (expected !== instance) throw new Error('late-collector-response');
    if (!value || value.schemaVersion !== 1 || typeof value.instanceId !== 'string' || value.instanceId === 'unavailable')
      throw new Error('diagnostic-generation-unavailable');
    if (instance === null) { instance = value.instanceId; epoch = value.frames.epoch; }
    if (current?.performancePhase && (value.policy?.hidden || value.policy?.paused || value.policy?.reducedMotion)) current.policyInterrupted = true;
    if (value.instanceId !== instance || value.frames.epoch !== epoch) throw new Error('diagnostic-generation-changed');
    diagnostics.observe(value, current?.id ?? 'boundary');
    if (value.closed && !disposing) throw new Error('diagnostic-surface-closed-unexpectedly');
    if (!Number.isSafeInteger(value.frames.lastSequence) || value.frames.lastSequence < cursor) throw new Error('diagnostic-sequence-regressed');
    if (value.frames.overwrittenSinceCursor) {
      if (current) current.lostSamples += value.frames.overwrittenSinceCursor;
      appendEvent({ type: 'frame-loss', count: value.frames.overwrittenSinceCursor, phase: current?.id ?? 'boundary' });
    }
    for (const row of value.frames.rows) {
      if (row.sequence <= cursor || row.sequence > value.frames.lastSequence) throw new Error('diagnostic-frame-order');
      if (report.frames.length === CAPTURE_LIMITS.frames) throw new Error('capture-frame-limit');
      report.frames.push({ ...row, sequence: offset + row.sequence, instanceId: instance, epoch }); cursor = row.sequence;
    }
    globalLast = offset + value.frames.lastSequence;
    if (value.frames.remaining) { if (!value.frames.rows.length) throw new Error('diagnostic-page-no-progress'); return poll(depth + 1, deadline); }
    if (cursor < value.frames.lastSequence) cursor = value.frames.lastSequence;
    const firstEventSequence = value.events.rows[0]?.sequence;
    if (firstEventSequence > eventCursor + 1) rendererEventLoss += firstEventSequence - eventCursor - 1;
    for (const event of value.events.rows) if (event.sequence > eventCursor) {
      eventCursor = event.sequence; appendEvent({ ...event, instanceId: instance, source: 'renderer-audit-not-OS-proof' });
    }
    if (value.stage?.mode && current) current.observedModes.add(value.stage.mode);
    last = value;
    return value;
  }
  async function wait(ms, cadence = 250) {
    const end = ports.now() + ms;
    while (ports.now() < end) { assertActive(); await ports.delay(Math.min(cadence, end - ports.now())); await poll(); }
  }
  async function drainTerminalOperations() {
    const started = ports.now(), deadline = started + 2000;
    let readTimedOut = false;
    const valid = () => last?.closed === true && Number.isSafeInteger(last.pendingOperations) && last.pendingOperations >= 0;
    // Each owned-window read shares the remaining drain budget and the existing global abort.
    try {
      await poll(0, deadline);
      while (valid() && last.pendingOperations > 0 && ports.now() < deadline) {
        assertActive();
        await ports.delay(Math.min(50, deadline - ports.now()));
        if (ports.now() < deadline) await poll(0, deadline);
      }
    } catch (cause) {
      if (ports.signal?.aborted || !['capture-collector-timeout', 'terminal-operations-read-timeout'].includes(cause.message)) throw cause;
      readTimedOut = true; error('terminal-operations-read-timeout');
    }
    const pendingOperations = valid() ? last.pendingOperations : null;
    const operationsSettled = !readTimedOut && pendingOperations === 0;
    if (!valid()) error('terminal-operations-counter-unavailable');
    else if (!operationsSettled) error('terminal-operations-unsettled');
    return { pendingOperations, operationsSettled, operationDrainElapsedMs: Math.max(0, ports.now() - started) };
  }
  async function phase(id, action, { performance = true, expectedMode = null } = {}) {
    await poll(); const started = ports.now(), start = globalLast + 1;
    current = { id, startSequence: start, endSequence: null, status: 'running', inputSource: id.startsWith('synthetic') ? 'Electron-injected-not-OS' : 'none',
      lostSamples: 0, observedModes: new Set(), instanceId: instance, epoch, performancePhase: performance };
    const item = current;
    try {
      await action(); await poll(); item.status = 'completed';
      if (item.performancePhase && (item.policyInterrupted || globalLast < start)) { item.status = 'failed'; error('performance-phase-interrupted-or-empty'); }
      if (expectedMode && !item.observedModes.has(expectedMode)) { item.status = 'failed'; error('expected-mode-not-observed'); }
    } catch (cause) { item.status = 'partial'; throw cause; }
    finally {
      item.endSequence = globalLast >= start ? globalLast : null;
      if (item.endSequence === null) item.startSequence = null;
      item.elapsedMs = Math.max(0, ports.now() - started); item.observedModes = [...item.observedModes];
      report.phases.push(item); current = null;
    }
  }
  async function shot(name) {
    if (!screenshots || report.screenshots.length >= CAPTURE_LIMITS.screenshots) return;
    const started = ports.now(); const image = await ports.screenshot();
    if (image.length > CAPTURE_LIMITS.screenshotBytes) { error('screenshot-size-limit'); return; }
    report.screenshots.push({ name: name + '.png', mimeType: 'image/png', base64: image.toString('base64') });
    appendEvent({ type: 'screenshot-outside-performance-phase', name, elapsedMs: ports.now() - started }); await poll(); await wait(250);
  }
  const target = () => {
    const point = last?.stage?.inputTargets?.body;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('body-input-target-unavailable');
    return point;
  };
  const input = async (type, point) => { assertActive(); const receipt = await ports.input(type, point); appendEvent({ type, source: 'Electron-injected-not-OS', ...(receipt ? { coordinateReceipt: receipt } : {}) }); };
  await poll(); report.environment.graphics = last.stage?.graphics ?? {};
  report.capture = { status: 'running', resourceSamples: [], lifecycle: [], truncatedEvents: 0 };
  const sample = async name => { await poll(); const { errors: stageErrors = [], ...stage } = last.stage;
    report.capture.resourceSamples.push({ name, instanceId: instance, elapsedMs: ports.now() - started,
      startup: last.startup ?? null, stage: { ...stage, errorCount: stageErrors.length }, processes: await ports.processes() }); };
  const started = ports.now();
  try {
    await phase('warmup', () => wait(5000, 1000), { performance: false });
    await sample('initial-warm');
    await phase('idle', () => wait(10000, 1000)); await shot('idle');
    await phase('synthetic-longpress', async () => { const p = target(); await input('mouseDown', p); await wait(1200); }, { expectedMode: 'petting' });
    await shot('longpress');
    await phase('synthetic-pet-release', async () => { await input('mouseUp', target()); await wait(1500); });
    await phase('synthetic-drag', async () => {
      const p = target(); await input('mouseDown', p); await wait(50);
      await input('mouseMove', { x: p.x + 28, y: p.y - 32 }); await wait(900);
    }, { expectedMode: 'drag' }); await shot('drag');
    await phase('synthetic-release', async () => { await input('mouseUp', target()); await wait(2200); }, { expectedMode: 'landing' });
    await phase('synthetic-cancel-regrab', async () => {
      let p = target(); await input('mouseDown', p); await wait(50); await input('mouseMove', { x: p.x + 24, y: p.y - 24 }); await wait(350);
      await ports.cancel(); await wait(100); p = target(); await input('mouseDown', p); await wait(50);
      await input('mouseMove', { x: p.x - 24, y: p.y - 18 }); await wait(350); await input('mouseUp', target()); await wait(1500);
    }); await shot('after-regrab');
    await ports.pause(true); await wait(200); const frozen = { time: last.time, frames: last.stage.renderedFrames };
    await phase('paused-idle', () => wait(2000, 1000), { performance: false });
    report.capture.pause = { timeFrozen: last.time === frozen.time, redrawsStopped: last.stage.renderedFrames === frozen.frames };
    if (!report.capture.pause.timeFrozen || !report.capture.pause.redrawsStopped) error('pause-did-not-freeze');
    if (ports.probeMovement) {
      await phase('native-window-movement-probe', async () => {
        report.capture.windowMovement = await ports.probeMovement();
        if (report.capture.windowMovement.status !== 'movement-observed' || !report.capture.windowMovement.restoration.confirmed || !report.capture.windowMovement.inputQuiescent)
          error('native-window-movement-or-restoration-unverified');
      }, { performance: false });
    }
    await ports.pause(false); await phase('resume', () => wait(2000)); await shot('resumed');
    await sample('before-dispose');
    report.capture.inputMotion = last.stage?.inputMotion ?? null;
    report.capture.inputLease = last.inputLease ?? null;
    for (let generation = 0; generation < 3; generation++) {
      disposing = true; await ports.dispose(); const operations = await drainTerminalOperations();
      const stage = last.stage, cpu = stage?.pool;
      report.capture.lifecycle.push({ generation, instanceId: instance, epoch, closed: last.closed, frameScheduled: last.frameScheduled ?? null, ...operations,
        pending: cpu?.pending ?? null, actors: cpu?.actors ?? null, claimedBytes: cpu?.budget?.claimedBytes ?? null,
        scope: 'CPU-owned resources only; WebGL counters do not prove physical GPU memory release' });
      if (!last.closed || last.frameScheduled !== false || cpu?.pending !== 0 || cpu?.actors !== 0 || cpu?.budget?.claimedBytes !== 0) error('terminal-resource-owner-not-empty');
      if (generation === 2) break;
      const old = instance; offset = globalLast; cursor = 0; instance = null; epoch = null; eventCursor = 0;
      await ports.reload(old); disposing = false; await poll(); if (instance === old) throw new Error('reload-reused-diagnostic-instance');
      await phase(`reload-${generation + 1}-warmup`, () => wait(2000, 1000), { performance: false });
      await phase(`reload-${generation + 1}-idle`, () => wait(2000, 1000)); await sample(`reload-${generation + 1}`);
    }
    report.capture.status = (report.errorAccounting?.total ?? report.errors.length) ? 'completed-with-observations' : 'completed';
  } catch (cause) { report.capture.status = ports.signal?.aborted ? 'interrupted' : 'partial'; throw cause; }
  finally { report.capture.elapsedMs = ports.now() - started; report.capture.truncatedEvents = Math.max(0, eventTotal - report.events.length); report.capture.rendererEventLoss = rendererEventLoss; }
  return report;
}
