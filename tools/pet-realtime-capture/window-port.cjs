'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { probeOwnedMovement, bounds } = require('./movement-probe.cjs');
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { probeHeldTransport, unavailable } = require('./held-transport-probe.cjs');
const { validTransportPort } = require('./transport-handoff.cjs');

/** Only the genuine fixture pet webContents may be sampled or receive fixed injected input. */
function createOwnedWindowPort({ window, pagePath, readProfileOwnership, signal, readWorkArea, transportHandoff = null, timeoutMs = 5000, startupTimeoutMs = 35000 }) {
  const expected = pathToFileURL(path.resolve(pagePath)).href;
  let heldProbed = false;
  let generation = 0, closed = false, expectedInstance = null, probing = false, probed = false, pendingMutations = 0, mutationOutcomeUnknown = false;
  const navigation = (details, _url, _inPlace, mainFrame) => {
    if (details?.isMainFrame === true || mainFrame === true) { generation++; expectedInstance = null; }
  };
  window.webContents.on('did-start-navigation', navigation);
  function assertCurrent({ cleanup = false } = {}) {
    if (closed || (!cleanup && signal?.aborted) || window.isDestroyed() || window.webContents.isDestroyed()
      || window.webContents.getURL() !== expected || readProfileOwnership() !== true) throw new Error('capture-window-owner-invalid');
  }
  async function bounded(promise, milliseconds) {
    let timer, abort;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        abort = () => reject(new Error('capture-collector-aborted'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        timer = setTimeout(() => reject(new Error('capture-collector-timeout')), milliseconds);
      })]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function delay(ms) {
    let timer;
    try { await bounded(new Promise(resolve => { timer = setTimeout(resolve, ms); }), timeoutMs); }
    finally { clearTimeout(timer); }
  }
  async function evaluate(method, argument, readTimeoutMs = null, transport = false) {
    assertCurrent();
    if (!['readDiagnostics', 'readWindowGeometry', 'pause', 'cancel', 'dispose',
      ...(transport ? ['prepareFixtureTransport', 'readFixtureTransport', 'finishFixtureTransport', 'cancelFixtureTransport'] : [])].includes(method)) throw new Error('capture-method-rejected');
    if (readTimeoutMs !== null && ((method !== 'readDiagnostics' && !transport) || !Number.isFinite(readTimeoutMs) || readTimeoutMs <= 0 || readTimeoutMs > timeoutMs))
      throw new Error('capture-read-timeout-invalid');
    const ticket = generation;
    const expression = `import(${JSON.stringify(pathToFileURL(path.join(path.dirname(pagePath), 'entry.mjs')).href)}).then(module => module.surface.${method}(${argument === undefined ? '' : JSON.stringify(argument)}))`;
    const value = await bounded(window.webContents.executeJavaScript(expression), readTimeoutMs ?? (expectedInstance === null ? startupTimeoutMs : timeoutMs));
    assertCurrent(); if (ticket !== generation) throw new Error('capture-late-generation-response');
    if (method === 'readDiagnostics' || method === 'readWindowGeometry' || method.endsWith('FixtureTransport')) {
      if (typeof value?.instanceId !== 'string' || value.instanceId === 'unavailable') throw new Error('capture-instance-unavailable');
      if (expectedInstance !== null && expectedInstance !== value.instanceId) throw new Error('capture-instance-changed');
      expectedInstance ??= value.instanceId;
    }
    return value;
  }
  function assertNotProbing() { if (probing) throw new Error('capture-movement-probe-busy'); }
  function mutate(operation) {
    assertNotProbing(); pendingMutations++;
    try { return Promise.resolve(operation()).catch(error => {
      // A timeout is not cancellation of executeJavaScript. A late renderer mutation
      // must never be overtaken by a movement probe, even after this promise rejects.
      mutationOutcomeUnknown = true; throw error;
    }).finally(() => { pendingMutations--; }); }
    catch (error) { pendingMutations--; mutationOutcomeUnknown = true; throw error; }
  }
  async function inject(type, point, heldCheck = null, deadline = Infinity) {
      assertCurrent(); heldCheck?.(); const ticket = generation, instance = expectedInstance;
      if (!['mouseDown', 'mouseMove', 'mouseUp'].includes(type) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('capture-input-rejected');
      point = { x: Math.round(point.x), y: Math.round(point.y) };
      const bounds = window.getContentBounds();
      if (point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) throw new Error('capture-input-outside-owned-window');
      // Electron's supported API requires this owned window to be focused.
      if (heldCheck && type !== 'mouseDown' && !window.isFocused()) throw Error('capture-held-transport-focus-lost');
      if (!window.isFocused()) { window.focus(); await delay(50); assertCurrent(); }
      if (!heldCheck) assertNotProbing();
      heldCheck?.();
      if (performance.now() >= deadline) throw Error('capture-input-expired');
      if (ticket !== generation || instance !== expectedInstance) throw new Error('capture-late-input-generation');
      const actualBounds = window.getContentBounds();
      if (point.x >= actualBounds.width || point.y >= actualBounds.height) throw new Error('capture-input-outside-owned-window');
      if (!Number.isFinite(actualBounds.x) || !Number.isFinite(actualBounds.y)) throw new Error('capture-input-screen-origin-unavailable');
      if (!window.isFocused()) throw new Error('capture-owned-window-focus-blocked');
      const global = { x: actualBounds.x + point.x, y: actualBounds.y + point.y };
      window.webContents.sendInputEvent({ type, x: point.x, y: point.y, globalX: global.x, globalY: global.y,
        ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : { button: 'left', clickCount: 1 }) });
      return { local: point, global, coordinateSource: 'caller-supplied-controlled-fixture-not-OS' };
  }
  return Object.freeze({
    async probeMovement() {
      assertCurrent(); assertNotProbing();
      if (pendingMutations !== 0) throw new Error('capture-movement-probe-busy');
      if (probed || mutationOutcomeUnknown || expectedInstance === null || typeof readWorkArea !== 'function') throw new Error('capture-movement-probe-unavailable');
      probed = true; probing = true; const ticket = generation, instanceId = expectedInstance;
      const observations = { provenance: 'unknown-not-OS-proof', eventMatching: 'unmatched-independent-stream',
        total: 0, dropped: 0, contaminated: false, rows: [] };
      const started = performance.now();
      function observe(stream, input = null) {
        observations.total++; observations.contaminated = true;
        if (observations.rows.length >= 128) { observations.dropped++; return; }
        const row = { sequence: observations.total, elapsedMs: performance.now() - started, stream };
        if (input && ['mouseDown', 'mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave', 'mouseWheel'].includes(input.type)) {
          row.type = input.type;
          for (const key of ['x', 'y', 'globalX', 'globalY', 'movementX', 'movementY'])
            if (Number.isFinite(input[key]) && Math.abs(input[key]) <= 1000000) row[key] = input[key];
        }
        observations.rows.push(row);
      }
      const mouse = (_event, input) => observe('before-mouse-event', input);
      const input = (_event, value) => observe('input-event', value);
      const keyboard = () => observe('before-input-event'); // Never retain key contents.
      window.webContents.on('before-mouse-event', mouse);
      window.webContents.on('input-event', input);
      window.webContents.on('before-input-event', keyboard);
      try {
        const result = await probeOwnedMovement({
          identity: { generation: ticket, instanceId },
          assertCurrent(options) { assertCurrent(options);
            if (ticket !== generation || instanceId !== expectedInstance) throw new Error('capture-movement-generation-changed');
            if (!options?.cleanup && observations.contaminated) throw new Error('capture-movement-input-contaminated'); },
          readNative: () => bounds(window.getBounds()), readWorkArea,
          move: (x, y) => window.setPosition(x, y, false),
          readRenderer: () => evaluate('readWindowGeometry'),
          delay
        });
        result.nativeObservations = observations;
        result.inputQuiescent = !observations.contaminated;
        return result;
      } finally {
        probing = false;
        window.webContents.removeListener('before-mouse-event', mouse);
        window.webContents.removeListener('input-event', input);
        window.webContents.removeListener('before-input-event', keyboard);
      }
    },
    async probeHeldTransport() {
      assertCurrent(); assertNotProbing();
      if (pendingMutations !== 0) throw Error('capture-held-transport-busy');
      if (heldProbed || mutationOutcomeUnknown || expectedInstance === null) throw Error('capture-held-transport-unavailable');
      heldProbed = true;
      if (!transportHandoff) return unavailable('capture-transport-handoff-missing');
      if (transportHandoff.window !== window || !validTransportPort(transportHandoff.port))
        return unavailable('capture-transport-handoff-invalid');
      probing = true; const ticket = generation, instanceId = expectedInstance;
      const check = () => {
        assertCurrent(); transportHandoff.assertCurrent();
        if (ticket !== generation || instanceId !== expectedInstance) throw Error('capture-held-transport-generation-changed');
      };
      try {
        const result = await probeHeldTransport({ identity: { instanceId, generation: ticket }, probeId: randomUUID(),
          assertCurrent: check, now: () => performance.now(), delay, readNative: () => bounds(window.getBounds()),
          renderer: async (method, argument, ms) => {
            check(); const value = await evaluate(method, argument, Math.min(timeoutMs, ms), true); check(); return value;
          },
          host: async (method, argument, ms) => {
            check();
            if (!['prepareFixture', 'arm', 'translate', 'read', 'finish', 'abort', 'restoreFixture'].includes(method))
              throw Error('capture-transport-method-rejected');
            const value = await bounded(Promise.resolve(transportHandoff.port[method](argument)), Math.min(timeoutMs, ms));
            check(); return value;
          },
          input: async (type, point, ms) => {
            check(); const value = await bounded(inject(type, point, check, performance.now() + ms), Math.min(timeoutMs, ms)); check(); return value;
          }
        });
        mutationOutcomeUnknown ||= result.mutationOutcomeUnknown === true;
        if (result.requiresDispose) {
          // Only dispose the exact old document. Never restore/cancel through a newer owner.
          result.disposal = { attempted: false, confirmed: false };
          try {
            check(); const before = await evaluate('readDiagnostics', { afterSequence: 0, limit: 1 }); check();
            const ownedContact = result.contactGeneration ?? result.initialContactGenerationHighWater;
            if (!Number.isSafeInteger(ownedContact) || before.stage?.contactGenerationHighWater !== ownedContact)
              throw Error('capture-held-transport-contact-replaced');
            if (before.stage?.pointerId !== null && before.stage?.contactGeneration !== ownedContact)
              throw Error('capture-held-transport-contact-replaced');
            result.disposal.attempted = true; await evaluate('dispose'); check();
            const state = await evaluate('readDiagnostics', { afterSequence: 0, limit: 1 }); check();
            result.disposal.confirmed = state.closed === true;
          } catch { mutationOutcomeUnknown = true; }
        }
        return result;
      } finally { probing = false; }
    },
    read: (options, limits) => evaluate('readDiagnostics', options, limits?.timeoutMs ?? null),
    pause: value => mutate(() => { if (typeof value !== 'boolean') return Promise.reject(new Error('capture-pause-boolean')); return evaluate('pause', value); }),
    cancel: () => mutate(() => evaluate('cancel')), dispose: () => mutate(() => evaluate('dispose')),
    async input(type, point) { return mutate(() => inject(type, point)); },
    async screenshot() { assertCurrent(); const ticket = generation; const image = await bounded(window.webContents.capturePage(), timeoutMs);
      assertCurrent(); if (ticket !== generation) throw new Error('capture-late-screenshot'); return image.toPNG(); },
    reload(previousInstance) { return mutate(() => {
      assertCurrent(); if (previousInstance !== expectedInstance) throw new Error('capture-reload-instance-mismatch');
      generation++; expectedInstance = null;
      return new Promise((resolve, reject) => {
        let timer;
        const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); window.webContents.removeListener('did-finish-load', loaded); window.webContents.removeListener('did-fail-load', failed); };
        const loaded = () => { clean(); try { assertCurrent(); resolve(); } catch (error) { reject(error); } };
        const failed = () => { clean(); reject(new Error('capture-reload-failed')); };
        const aborted = () => { clean(); reject(new Error('capture-reload-aborted')); };
        signal?.addEventListener('abort', aborted, { once: true });
        window.webContents.once('did-finish-load', loaded); window.webContents.once('did-fail-load', failed);
        timer = setTimeout(() => { clean(); reject(new Error('capture-reload-timeout')); }, timeoutMs * 3);
        window.webContents.reload();
      });
    }); },
    close() { closed = true; generation++; window.webContents.removeListener('did-start-navigation', navigation); }
  });
}
module.exports = { createOwnedWindowPort };
