import { CAPTURE_LIMITS } from './report.mjs';

/** Fixed scenario over narrow owned-window ports. No generic script, profile or IPC input. */
export async function collectRealtime(report, ports, { screenshots = true } = {}) {
  let instance = null, epoch = null, cursor = 0, offset = 0, globalLast = 0, eventCursor = 0;
  let current = null, last = null, eventTotal = 0, rendererEventLoss = 0, disposing = false;
  const appendEvent = event => {
    eventTotal++;
    if (report.events.length < CAPTURE_LIMITS.events) report.events.push(event);
  };
  const error = code => { if (report.errors.length < CAPTURE_LIMITS.errors) report.errors.push({ code, phase: current?.id ?? 'startup' }); };
  const assertActive = () => { if (ports.signal?.aborted) throw new Error('capture-interrupted'); };
  async function poll(depth = 0) {
    if (depth > 16) throw new Error('diagnostic-page-limit');
    assertActive();
    const expected = instance;
    const value = await ports.read({ afterSequence: cursor, limit: 600 });
    assertActive();
    if (expected !== instance) throw new Error('late-collector-response');
    if (!value || value.schemaVersion !== 1 || typeof value.instanceId !== 'string' || value.instanceId === 'unavailable')
      throw new Error('diagnostic-generation-unavailable');
    if (instance === null) { instance = value.instanceId; epoch = value.frames.epoch; }
    if (value.closed && !disposing) throw new Error('diagnostic-surface-closed-unexpectedly');
    if (current?.performancePhase && (value.policy?.hidden || value.policy?.paused || value.policy?.reducedMotion)) current.policyInterrupted = true;
    if (value.instanceId !== instance || value.frames.epoch !== epoch) throw new Error('diagnostic-generation-changed');
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
    if (value.frames.remaining) { if (!value.frames.rows.length) throw new Error('diagnostic-page-no-progress'); return poll(depth + 1); }
    if (cursor < value.frames.lastSequence) cursor = value.frames.lastSequence;
    const firstEventSequence = value.events.rows[0]?.sequence;
    if (firstEventSequence > eventCursor + 1) rendererEventLoss += firstEventSequence - eventCursor - 1;
    for (const event of value.events.rows) if (event.sequence > eventCursor) {
      eventCursor = event.sequence; appendEvent({ ...event, instanceId: instance, source: 'renderer-audit-not-OS-proof' });
    }
    if (value.stage?.mode && current) current.observedModes.add(value.stage.mode);
    if (value.errors?.length) error('renderer-diagnostic-error');
    last = value;
    return value;
  }
  async function wait(ms, cadence = 250) {
    const end = ports.now() + ms;
    while (ports.now() < end) { assertActive(); await ports.delay(Math.min(cadence, end - ports.now())); await poll(); }
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
  const input = async (type, point) => { assertActive(); await ports.input(type, point); appendEvent({ type, source: 'Electron-injected-not-OS' }); };
  await poll(); report.environment.graphics = last.stage?.graphics ?? {};
  report.capture = { status: 'running', resourceSamples: [], lifecycle: [], truncatedEvents: 0 };
  const sample = async name => { await poll(); const { errors: stageErrors = [], ...stage } = last.stage;
    report.capture.resourceSamples.push({ name, elapsedMs: ports.now() - started,
      stage: { ...stage, errorCount: stageErrors.length }, processes: await ports.processes() }); };
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
    await ports.pause(false); await phase('resume', () => wait(2000)); await shot('resumed');
    await sample('before-dispose');
    for (let generation = 0; generation < 3; generation++) {
      disposing = true; await ports.dispose(); await poll();
      const stage = last.stage, cpu = stage?.pool;
      report.capture.lifecycle.push({ generation, instanceId: instance, epoch, closed: last.closed, frameScheduled: last.frameScheduled ?? null,
        pending: cpu?.pending ?? null, actors: cpu?.actors ?? null, claimedBytes: cpu?.budget?.claimedBytes ?? null,
        scope: 'CPU-owned resources only; WebGL counters do not prove physical GPU memory release' });
      if (!last.closed || last.frameScheduled !== false || cpu?.pending !== 0 || cpu?.actors !== 0 || cpu?.budget?.claimedBytes !== 0) error('terminal-resource-owner-not-empty');
      if (generation === 2) break;
      const old = instance; offset = globalLast; cursor = 0; instance = null; epoch = null; eventCursor = 0;
      await ports.reload(old); disposing = false; await poll(); if (instance === old) throw new Error('reload-reused-diagnostic-instance');
      await phase(`reload-${generation + 1}-warmup`, () => wait(2000, 1000), { performance: false });
      await phase(`reload-${generation + 1}-idle`, () => wait(2000, 1000)); await sample(`reload-${generation + 1}`);
    }
    report.capture.status = report.errors.length ? 'completed-with-observations' : 'completed';
  } catch (cause) { report.capture.status = ports.signal?.aborted ? 'interrupted' : 'partial'; throw cause; }
  finally { report.capture.elapsedMs = ports.now() - started; report.capture.truncatedEvents = Math.max(0, eventTotal - report.events.length); report.capture.rendererEventLoss = rendererEventLoss; }
  return report;
}
