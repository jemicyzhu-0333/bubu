'use strict';

// Synthetic probe only: observe one injected key pair; never focus, scroll, or retry it.
function installReadingCapture({ id, keyCode }) {
  const slot = Symbol.for('bubu.reminder-reading-probe');
  if (globalThis[slot]) throw new Error('Reading capture already installed');
  const region = document.getElementById(id);
  if (!region) throw new Error(`Missing reading region: ${id}`);
  const started = performance.now(), limit = 128;
  const keyboard = [], scroll = [], focus = [], listeners = [];
  const dropped = { keyboard: 0, scroll: 0, focus: 0 };
  const identify = node => node === window ? 'window' : node === document ? 'document'
    : node?.id || node?.tagName || null;
  const offsets = node => ({ target: identify(node), scrollTop: node.scrollTop,
    scrollLeft: node.scrollLeft, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
  const ancestors = [];
  for (let node = region.parentElement; node; node = node.parentElement) ancestors.push(node);
  function state() {
    return { elapsedMs: performance.now() - started, documentHasFocus: document.hasFocus(),
      activeElement: identify(document.activeElement), region: offsets(region),
      ancestors: ancestors.map(offsets) };
  }
  function append(kind, list, entry) {
    if (list.length < limit) list.push(entry); else dropped[kind]++;
  }
  function listen(node, type, handler) {
    node.addEventListener(type, handler, true);
    listeners.push(() => node.removeEventListener(type, handler, true));
  }
  for (const type of ['keydown', 'keyup']) listen(window, type, event => {
    if (event.key !== keyCode) return;
    // Retain the event until sampling so later handlers' preventDefault is visible.
    append('keyboard', keyboard, { event, atCapture: state(), type: event.type,
      key: event.key, code: event.code, keyCode: event.keyCode, target: identify(event.target),
      trusted: event.isTrusted, repeat: event.repeat,
      modifiers: { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey } });
  });
  listen(document, 'scroll', event => append('scroll', scroll, { target: identify(event.target), ...state() }));
  for (const type of ['focus', 'blur', 'focusin', 'focusout']) {
    listen(window, type, event => append('focus', focus, { type, target: identify(event.target), ...state() }));
  }
  function snapshot() {
    return { ...state(), keyboard: keyboard.map(({ event, ...entry }) => ({ ...entry,
      defaultPrevented: event.defaultPrevented })), scroll: [...scroll], focus: [...focus], dropped: { ...dropped } };
  }
  globalThis[slot] = { snapshot, dispose() {
    const final = snapshot();
    for (const stop of listeners) stop();
    delete globalThis[slot];
    return final;
  } };
  return snapshot();
}

function readReadingCapture() {
  const capture = globalThis[Symbol.for('bubu.reminder-reading-probe')];
  if (!capture) throw new Error('Reading capture is not installed');
  return capture.snapshot();
}

function disposeReadingCapture() {
  return globalThis[Symbol.for('bubu.reminder-reading-probe')]?.dispose() || null;
}

function readingFailure(sample, id, keyCode, baseline) {
  const events = sample?.renderer.keyboard || [];
  const missing = ['keydown', 'keyup'].filter(type => !events.some(event => event.type === type && event.key === keyCode));
  if (missing.length) return `MISSING_KEY_EVENT: ${id} ${keyCode} missing ${missing.join(', ')}`;
  if (events.some(event => event.key === keyCode && event.defaultPrevented)) return `KEY_DEFAULT_PREVENTED: ${id} ${keyCode}`;
  if (events.some(event => event.key === keyCode && event.target !== id)) return `KEY_TARGET_CHANGED: ${id} ${keyCode}`;
  if (sample.renderer.activeElement !== id) return `READING_FOCUS_CHANGED: expected ${id}`;
  const offset = sample.renderer.region.scrollTop;
  const moved = keyCode === 'PageDown' ? offset > baseline : offset < baseline;
  return moved ? `SCROLL_NOT_SETTLED: ${id} ${keyCode}` : `NO_SCROLL_CHANGE: ${id} ${keyCode} from ${baseline} to ${offset}`;
}

function waitForReadingScroll({ sample, id, keyCode, baseline, timeoutMs = 1500, settleMs = 100,
  pollMs = 25, now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!['PageDown', 'PageUp'].includes(keyCode)) throw new Error(`Unsupported reading key: ${keyCode}`);
  return new Promise(resolve => {
    const started = now(), samples = [];
    let finished = false, latest = null, lastOffset = baseline, lastScrollCount = 0, stableSince = started;
    function finish(passed, error = null, timedOut = false) {
      if (finished) return;
      finished = true; clearTimer(deadline);
      resolve({ passed, error, timedOut, timeoutMs, settleMs, elapsedMs: now() - started, baseline, samples, final: latest });
    }
    // Also bounds an unresponsive renderer sample; polling alone cannot do that.
    const deadline = setTimer(() => finish(false, readingFailure(latest, id, keyCode, baseline), true), timeoutMs);
    void (async () => {
      try {
        while (!finished) {
          const next = await sample();
          if (finished) return;
          latest = next;
          const at = now(), offset = next.renderer.region.scrollTop;
          const scrollCount = next.renderer.scroll.length + (next.renderer.dropped?.scroll || 0);
          samples.push({ elapsedMs: at - started, native: next.native,
            documentHasFocus: next.renderer.documentHasFocus, activeElement: next.renderer.activeElement,
            region: next.renderer.region, ancestors: next.renderer.ancestors,
            keyboardCount: next.renderer.keyboard.length, scrollCount });
          const error = readingFailure(next, id, keyCode, baseline);
          if (at - started >= timeoutMs) { finish(false, error, true); return; }
          // Event counts also catch movement out and back between sampled offsets.
          if (offset !== lastOffset || scrollCount !== lastScrollCount) {
            lastOffset = offset; lastScrollCount = scrollCount; stableSince = at;
          }
          if (/^(KEY_DEFAULT_PREVENTED|KEY_TARGET_CHANGED|READING_FOCUS_CHANGED):/.test(error)) {
            finish(false, error); return;
          }
          if (error.startsWith('SCROLL_NOT_SETTLED:') && at - stableSince >= settleMs) {
            finish(true); return;
          }
          await sleep(pollMs);
        }
      } catch (error) { finish(false, `READING_OBSERVATION_ERROR: ${error.message || error}`); }
    })();
  });
}

async function boundedRead(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function observeReadingKey({ nativeWindow, id, keyCode }) {
  const contents = nativeWindow.webContents, started = performance.now();
  const nativeEvents = [], nativeInput = [], stops = [];
  const focus = () => ({ windowFocused: nativeWindow.isFocused(), webContentsFocused: contents.isFocused() });
  const run = fn => contents.executeJavaScript(`(${fn.toString()})()`);
  function listen(emitter, name, handler) {
    emitter.on(name, handler); stops.push(() => emitter.removeListener(name, handler));
  }
  for (const [emitter, owner] of [[nativeWindow, 'window'], [contents, 'webContents']]) {
    for (const type of ['focus', 'blur']) listen(emitter, type, () => {
      if (nativeEvents.length < 128) nativeEvents.push({ owner, type, elapsedMs: performance.now() - started, ...focus() });
    });
  }
  listen(contents, 'before-input-event', (event, input) => {
    if (nativeInput.length < 128) nativeInput.push({ event, input: { type: input.type, key: input.key,
      code: input.code, isAutoRepeat: input.isAutoRepeat, shift: input.shift, control: input.control,
      alt: input.alt, meta: input.meta }, elapsedMs: performance.now() - started, ...focus() });
  });
  let result;
  try {
    const initial = await boundedRead(contents.executeJavaScript(`(${installReadingCapture.toString()})(${JSON.stringify({ id, keyCode })})`),
      1000, 'Reading capture setup');
    result = { initial: { native: focus(), renderer: initial } };
    contents.sendInputEvent({ type: 'keyDown', keyCode });
    contents.sendInputEvent({ type: 'keyUp', keyCode });
    Object.assign(result, await waitForReadingScroll({ id, keyCode, baseline: initial.region.scrollTop,
      sample: async () => ({ native: focus(), renderer: await run(readReadingCapture) }) }));
  } catch (error) {
    result = { ...result, passed: false, error: `READING_OBSERVATION_ERROR: ${error.message || error}` };
  } finally {
    for (const stop of stops) stop();
    // Do not let cleanup replace the evidence or defeat the observation deadline.
    try {
      const cleanup = await boundedRead(run(disposeReadingCapture), 250, 'Reading capture cleanup');
      if (result) result.cleanupSnapshot = cleanup;
    } catch (error) {
      if (result) { result.passed = false; result.cleanupError = error.message || String(error); }
    }
  }
  result.nativeEvents = nativeEvents;
  result.nativeInput = nativeInput.map(({ event, ...entry }) => ({ ...entry, defaultPrevented: event.defaultPrevented }));
  return result;
}

module.exports = { installReadingCapture, readReadingCapture, disposeReadingCapture, waitForReadingScroll, observeReadingKey };
