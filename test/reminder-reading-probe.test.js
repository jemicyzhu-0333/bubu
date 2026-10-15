'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { installReadingCapture, readReadingCapture, disposeReadingCapture, waitForReadingScroll,
  observeReadingKey } = require('../scripts/reminder-reading-probe.cjs');

function keyEvents(key = 'PageDown', overrides = {}) {
  return ['keydown', 'keyup'].map(type => ({ type, key, target: 'nudgeStatus', defaultPrevented: false, ...overrides }));
}
function snapshot(offset, overrides = {}) {
  return { native: { windowFocused: true, webContentsFocused: true }, renderer: {
    documentHasFocus: true, activeElement: 'nudgeStatus', region: { scrollTop: offset },
    ancestors: [{ target: 'bubble', scrollTop: 17 }, { target: 'BODY', scrollTop: 92 }],
    keyboard: keyEvents(), scroll: [], ...overrides } };
}
async function deterministicPoll(makeSample, overrides = {}) {
  let time = 0, calls = 0, clearCount = 0;
  const result = await waitForReadingScroll({ id: 'nudgeStatus', keyCode: 'PageDown', baseline: 0,
    timeoutMs: 400, settleMs: 100, pollMs: 25, now: () => time,
    sleep: async ms => { time += ms; }, setTimer: () => 1, clearTimer: () => { clearCount++; },
    sample: async () => { calls++; return makeSample(time); }, ...overrides });
  return { result, time, calls, clearCount };
}

test('waits for real late movement and a quiet interval, rather than a fixed 250 ms', async () => {
  const { result, time, clearCount } = await deterministicPoll(at => snapshot(at < 275 ? 0 : 15.5));
  assert.equal(result.passed, true);
  assert.equal(time, 375);
  assert.equal(result.baseline, 0);
  assert.equal(result.final.renderer.region.scrollTop, 15.5);
  assert.ok(result.samples.some(item => item.elapsedMs === 250 && item.region.scrollTop === 0));
  assert.equal(clearCount, 1);
});

test('no movement remains a timeout failure despite key delivery', async () => {
  const { result, time } = await deterministicPoll(() => snapshot(0));
  assert.equal(time, 400);
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /^NO_SCROLL_CHANGE:/);
  assert.ok(result.samples.every(item => item.region.scrollTop === 0));
});

test('missing keydown or keyup cannot be replaced by observed scrolling', async () => {
  for (const missing of ['keydown', 'keyup']) {
    const { result } = await deterministicPoll(() => snapshot(15.5,
      { keyboard: keyEvents().filter(event => event.type !== missing) }));
    assert.equal(result.passed, false);
    assert.match(result.error, new RegExp(`^MISSING_KEY_EVENT:.*${missing}`));
  }
});

test('wrong keys and wrong event targets never count as delivered reading input', async () => {
  const wrongKey = await deterministicPoll(() => snapshot(15.5, { keyboard: keyEvents('ArrowDown') }));
  assert.equal(wrongKey.result.passed, false);
  assert.match(wrongKey.result.error, /^MISSING_KEY_EVENT:/);
  const wrongTarget = await deterministicPoll(() => snapshot(15.5, { keyboard: keyEvents('PageDown', { target: 'bubbleCopy' }) }));
  assert.equal(wrongTarget.result.passed, false);
  assert.match(wrongTarget.result.error, /^KEY_TARGET_CHANGED:/);
});

test('default prevention and active-element changes fail even when a scroll moves', async () => {
  for (const [overrides, error] of [
    [{ keyboard: keyEvents('PageDown', { defaultPrevented: true }) }, /^KEY_DEFAULT_PREVENTED:/],
    [{ activeElement: 'closeBtn' }, /^READING_FOCUS_CHANGED:/]
  ]) {
    const { result } = await deterministicPoll(() => snapshot(15.5, overrides));
    assert.equal(result.passed, false);
    assert.match(result.error, error);
  }
});

test('PageUp requires a decrease from its actual start, not the earlier zero baseline', async () => {
  const success = await deterministicPoll(at => snapshot(at < 25 ? 15.5 : 0, { keyboard: keyEvents('PageUp') }),
    { keyCode: 'PageUp', baseline: 15.5 });
  assert.equal(success.result.passed, true);
  const wrongDirection = await deterministicPoll(() => snapshot(21, { keyboard: keyEvents('PageUp') }),
    { keyCode: 'PageUp', baseline: 15.5 });
  assert.equal(wrongDirection.result.passed, false);
  assert.match(wrongDirection.result.error, /^NO_SCROLL_CHANGE:/);
});

test('moving the ancestor only never satisfies the target-region assertion', async () => {
  const { result } = await deterministicPoll(at => snapshot(0, { ancestors: [{ target: 'BODY', scrollTop: at }] }));
  assert.equal(result.passed, false);
  assert.match(result.error, /^NO_SCROLL_CHANGE:/);
  assert.equal(result.final.renderer.ancestors[0].scrollTop, 400);
});

test('continuous animation, or movement which reverses to the baseline, still fails', async () => {
  const animated = await deterministicPoll(at => snapshot(at));
  assert.equal(animated.result.passed, false);
  assert.match(animated.result.error, /^SCROLL_NOT_SETTLED:/);
  const reverted = await deterministicPoll(at => snapshot(at === 25 ? 15.5 : 0));
  assert.equal(reverted.result.passed, false);
  assert.match(reverted.result.error, /^NO_SCROLL_CHANGE:/);
});

test('between-sample scroll events, including capped events, reset the settle interval', async () => {
  for (const capped of [false, true]) {
    const { result } = await deterministicPoll(at => snapshot(15.5, capped
      ? { scroll: Array(128).fill({}), dropped: { scroll: at / 25 } }
      : { scroll: Array(at / 25).fill({}) }));
    assert.equal(result.passed, false);
    assert.match(result.error, /^SCROLL_NOT_SETTLED:/);
  }
});

test('a sample arriving at or after the deadline cannot pass', async () => {
  const { result } = await deterministicPoll(at => snapshot(at >= 400 ? 15.5 : 0), { settleMs: 0 });
  assert.equal(result.passed, false);
  assert.match(result.error, /^SCROLL_NOT_SETTLED:/);
});

test('renderer rejection and a renderer that never answers are bounded failures', async () => {
  const rejected = await deterministicPoll(() => { throw new Error('renderer gone'); });
  assert.equal(rejected.result.passed, false);
  assert.match(rejected.result.error, /READING_OBSERVATION_ERROR: renderer gone/);
  let expire, time = 0, cleared = 0;
  const pending = waitForReadingScroll({ id: 'nudgeStatus', keyCode: 'PageDown', baseline: 0,
    timeoutMs: 20, sample: () => new Promise(() => {}), now: () => time,
    setTimer: (callback, delay) => { assert.equal(delay, 20); expire = callback; return 1; },
    clearTimer: () => { cleared++; } });
  time = 20; expire();
  const stalled = await pending;
  assert.equal(stalled.passed, false);
  assert.equal(stalled.timedOut, true);
  assert.match(stalled.error, /^MISSING_KEY_EVENT:/);
  assert.equal(stalled.elapsedMs, 20);
  assert.equal(cleared, 1);
});

function rendererHarness() {
  const mutations = [], elements = new Map();
  let ticks = 0, focused = true;
  function target(extra = {}) {
    const listeners = new Map();
    return { ...extra,
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      emit(type, data = {}) {
        const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data };
        for (const listener of listeners.get(type) || []) listener(event);
        return event;
      },
      listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
  }
  function element(id, tagName, parentElement, initialTop) {
    let top = initialTop;
    const node = { id, tagName, parentElement, scrollLeft: 0, scrollHeight: 54, clientHeight: 18,
      get scrollTop() { return top; },
      set scrollTop(value) { mutations.push(['scrollTop', value]); throw new Error('Observer must not scroll'); },
      focus() { mutations.push(['focus']); throw new Error('Observer must not focus'); },
      scrollTo() { mutations.push(['scrollTo']); throw new Error('Observer must not scroll'); },
      nativeScroll(value) { top = value; } };
    elements.set(id, node); return node;
  }
  const html = element('', 'HTML', null, 0), body = element('', 'BODY', html, 92);
  const bubble = element('bubble', 'DIV', body, 17), region = element('nudgeStatus', 'P', bubble, 0);
  const window = target(), document = target({ activeElement: region, hasFocus: () => focused,
    getElementById: id => elements.get(id) || null });
  const context = vm.createContext({ window, document, performance: { now: () => ticks++ } });
  const evaluate = source => JSON.parse(JSON.stringify(vm.runInContext(source, context)));
  const install = () => evaluate(`(${installReadingCapture.toString()})(${JSON.stringify({ id: 'nudgeStatus', keyCode: 'PageDown' })})`);
  const read = () => evaluate(`(${readReadingCapture.toString()})()`);
  const dispose = () => evaluate(`(${disposeReadingCapture.toString()})()`);
  return { window, document, region, bubble, body, context, evaluate, install, read, dispose, mutations,
    setFocus: value => { focused = value; } };
}

test('serialized renderer observer captures final defaultPrevented, focus, and ancestor scroll history without mutation', () => {
  const h = rendererHarness();
  h.install();
  const key = h.window.emit('keydown', { key: 'PageDown', target: h.region, code: 'PageDown', isTrusted: true });
  key.preventDefault(); // A later application listener, after the observer's capture listener.
  h.region.nativeScroll(15.5); h.body.nativeScroll(93);
  h.document.emit('scroll', { target: h.region });
  h.setFocus(false); h.window.emit('blur', { target: h.window });
  const data = h.read();
  assert.equal(data.keyboard[0].defaultPrevented, true);
  assert.equal(data.keyboard[0].atCapture.region.scrollTop, 0);
  assert.equal(data.scroll[0].region.scrollTop, 15.5);
  assert.equal(data.scroll[0].ancestors[1].scrollTop, 93);
  assert.equal(data.focus[0].documentHasFocus, false);
  assert.equal(data.activeElement, 'nudgeStatus');
  assert.deepEqual(h.mutations, []);
  h.dispose();
  assert.equal(h.window.listenerCount() + h.document.listenerCount(), 0);
  assert.throws(h.read, /not installed/);
});

test('renderer event history has a reported cap and cannot silently grow without bound', () => {
  const h = rendererHarness(); h.install();
  for (let index = 0; index < 130; index++) h.document.emit('scroll', { target: h.region });
  const data = h.dispose();
  assert.equal(data.scroll.length, 128);
  assert.equal(data.dropped.scroll, 2);
});

test('observer rejects a missing region or duplicate installation without changing the region', () => {
  const h = rendererHarness();
  assert.throws(() => h.evaluate(`(${installReadingCapture.toString()})({id:'absent',keyCode:'PageDown'})`), /Missing reading region/);
  h.install(); assert.throws(h.install, /already installed/); h.dispose();
  assert.deepEqual(h.mutations, []);
});

test('full synthetic bridge sends exactly one key pair, records native input, and removes listeners', async () => {
  const h = rendererHarness(), sent = [];
  const contents = new EventEmitter(), nativeWindow = new EventEmitter();
  nativeWindow.webContents = contents;
  nativeWindow.isFocused = contents.isFocused = () => true;
  contents.executeJavaScript = async source => h.evaluate(source);
  contents.sendInputEvent = input => {
    sent.push(input);
    const nativeEvent = { defaultPrevented: false };
    contents.emit('before-input-event', nativeEvent, { type: input.type, key: input.keyCode, code: input.keyCode });
    h.window.emit(input.type.toLowerCase(), { key: input.keyCode, target: h.region, isTrusted: true });
    if (input.type === 'keyDown') {
      h.region.nativeScroll(15.5);
      h.document.emit('scroll', { target: h.region });
      nativeWindow.emit('focus');
    }
  };
  const result = await observeReadingKey({ nativeWindow, id: 'nudgeStatus', keyCode: 'PageDown' });
  assert.equal(result.passed, true, result.error);
  assert.deepEqual(sent, [{ type: 'keyDown', keyCode: 'PageDown' }, { type: 'keyUp', keyCode: 'PageDown' }]);
  assert.equal(result.initial.renderer.region.scrollTop, 0);
  assert.equal(result.nativeInput.length, 2);
  assert.equal(result.nativeEvents.length, 1);
  assert.equal(result.final.native.windowFocused, true);
  assert.equal(result.final.native.webContentsFocused, true);
  assert.equal(result.final.renderer.documentHasFocus, true);
  assert.equal(result.cleanupSnapshot.region.scrollTop, 15.5);
  assert.equal(nativeWindow.eventNames().length + contents.eventNames().length, 0);
  assert.equal(h.window.listenerCount() + h.document.listenerCount(), 0);
  assert.deepEqual(h.mutations, []);
});

test('input delivery exceptions are reported without a retry or a fallback scroll', async () => {
  const h = rendererHarness(), contents = new EventEmitter(), nativeWindow = new EventEmitter();
  let attempts = 0;
  nativeWindow.webContents = contents; nativeWindow.isFocused = contents.isFocused = () => false;
  contents.executeJavaScript = async source => h.evaluate(source);
  contents.sendInputEvent = () => { attempts++; throw new Error('input unavailable'); };
  const result = await observeReadingKey({ nativeWindow, id: 'nudgeStatus', keyCode: 'PageDown' });
  assert.equal(result.passed, false);
  assert.match(result.error, /input unavailable/);
  assert.equal(attempts, 1);
  assert.equal(result.initial.native.windowFocused, false);
  assert.equal(result.cleanupSnapshot.region.scrollTop, 0);
  assert.deepEqual(h.mutations, []);
  assert.equal(nativeWindow.eventNames().length + contents.eventNames().length, 0);
});

test('full bridge timeout keeps missing-event and focus evidence without re-sending input', async () => {
  const h = rendererHarness(), sent = [], contents = new EventEmitter(), nativeWindow = new EventEmitter();
  nativeWindow.webContents = contents; nativeWindow.isFocused = contents.isFocused = () => false;
  h.setFocus(false);
  contents.executeJavaScript = async source => h.evaluate(source);
  contents.sendInputEvent = input => { sent.push(input); };
  const result = await observeReadingKey({ nativeWindow, id: 'nudgeStatus', keyCode: 'PageDown' });
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /MISSING_KEY_EVENT:.*keydown, keyup/);
  assert.deepEqual(sent, [{ type: 'keyDown', keyCode: 'PageDown' }, { type: 'keyUp', keyCode: 'PageDown' }]);
  assert.equal(result.initial.native.windowFocused, false);
  assert.equal(result.final.native.webContentsFocused, false);
  assert.equal(result.final.renderer.documentHasFocus, false);
  assert.equal(result.cleanupSnapshot.region.scrollTop, 0);
  assert.deepEqual(h.mutations, []);
  assert.equal(nativeWindow.eventNames().length + contents.eventNames().length, 0);
});
