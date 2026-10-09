import test from 'node:test';
import assert from 'node:assert/strict';
import { createPetSpeech, SAY_MAX_CHARS } from '../src/surfaces/pet/speech.mjs';
import { createContextEmphasis, contextMirrorBlocked, CONTEXT_COPY, CONTEXT_COMBINATION_COPY, CONTEXT_BADGE_BOUNDS } from '../src/surfaces/pet/context-emphasis.mjs';
import { MIRROR_ACTIVITIES, SESSION_ACTIVITIES } from '../src/content/session-activities.mjs';

function element() {
  const classes = new Set();
  const attributes = {};
  return { style: {}, dataset: {}, textContent: '', attributes,
    setAttribute: (name, value) => { attributes[name] = value; },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle: (name, force) => force ? classes.add(name) : classes.delete(name) } };
}
function fixture() {
  const stage = element(), label = element(), badge = element(), bubble = element(), foodToast = element();
  const timers = new Map(); let id = 0;
  const speech = createPetSpeech({ bubble,
    setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimeout: key => timers.delete(key) });
  const ui = createContextEmphasis({ stage, label, badge, speech, foodToast });
  const state = { state: 'idle', sessionState: 'idle', stimulationMode: 'high' };
  function update(category = 'music', options = {}) {
    const activity = MIRROR_ACTIVITIES[`mirror-${category}`] || null;
    ui.update({ activity, action: activity && { ...activity, mirrorPresentation: { phase: 'loop' }, propOpacity: 1 },
      state, source: 'base', expressionId: activity?.expression || 'life.idle', formId: 'dango', ...options });
  }
  const expire = () => { const entry = [...timers.values()][0]; assert.ok(entry); entry.fn(); };
  return { stage, label, badge, bubble, foodToast, timers, speech, ui, update, state, expire };
}

test('speech has one bounded timeout and a superseded context callback cannot dismiss newer speech', () => {
  const f = fixture();
  f.speech.showContext('一起理理思路');
  const stale = [...f.timers.values()][0].fn;
  assert.equal(f.speech.hasExternal(), false);
  f.speech.say('必要反馈'.repeat(20), 4500);
  assert.equal(f.bubble.textContent.length, SAY_MAX_CHARS);
  assert.equal(f.timers.size, 1);
  stale();
  assert.equal(f.speech.visible(), true);
  assert.equal(f.speech.hasExternal(), true);
  assert.equal(f.speech.showContext('音乐陪你慢慢来'), false);
  f.speech.cancelContext();
  assert.equal(f.speech.visible(), true);
  f.expire();
  assert.equal(f.speech.visible(), false);
  assert.equal(f.timers.size, 0);
});

test('one phrase per raw category precedes a readable badge; refreshes and loops cannot repeat it', () => {
  const f = fixture();
  f.ui.observeCategory('music'); f.update();
  assert.equal(f.bubble.textContent, CONTEXT_COPY.music.phrase);
  assert.equal(f.bubble.dataset.speechSource, 'context');
  assert.equal(f.badge.classList.contains('show'), false);
  f.expire(); f.update();
  assert.equal(f.badge.textContent, '音乐疗愈中');
  assert.equal(f.badge.classList.contains('show'), true);
  for (let index = 0; index < 20; index++) { f.ui.observeCategory('music'); f.update(); }
  assert.equal(f.timers.size, 0);
  assert.equal(f.ui.snapshot().phraseConsumed, true);
  f.ui.observeCategory('ai'); f.update('ai');
  assert.equal(f.bubble.textContent, '一起理理思路');
  f.expire(); f.update('ai');
  assert.equal(f.badge.textContent, 'AI协作中');
});

test('raw category changes cancel only context speech and off never leaves a badge or phrase behind', () => {
  const f = fixture();
  f.ui.observeCategory('music'); f.update();
  f.ui.observeCategory('ai');
  assert.equal(f.speech.visible(), false);
  f.update('ai');
  assert.equal(f.bubble.textContent, '一起理理思路');
  f.ui.observeCategory(null); f.update(null);
  assert.equal(f.speech.visible(), false);
  assert.equal(f.badge.classList.contains('show'), false);
  f.speech.say('保留这句');
  f.ui.observeCategory('music'); f.ui.observeCategory('ai'); f.ui.observeCategory(null);
  assert.equal(f.bubble.textContent, '保留这句');
  assert.equal(f.speech.visible(), true);
});

test('priority truth table suppresses the entire special context treatment', () => {
  for (const state of [
    { dragging: true }, { sessionPaused: true }, { screenLocked: true }, { dockedEdge: 'bottom' },
    { commandMenuOpen: true }, { foodMenuOpen: true }, { devtoolsOpen: true }, { devPreview: {} },
    { currentEgg: {} }, ...['sleeping', 'hungry', 'peeking', 'talking', 'dragged', 'walking'].map(state => ({ state })),
    { sessionState: 'focused' }, { sessionState: 'resting' }
  ]) assert.equal(contextMirrorBlocked({ state }), true, JSON.stringify(state));
  for (const source of ['input-safe', 'essential', 'interaction', 'session', 'cue']) {
    assert.equal(contextMirrorBlocked({ source }), true, source);
  }
  for (const expressionId of ['life.sleep', 'life.drowsy', 'life.peek', 'react.hungry', 'work.pause']) {
    assert.equal(contextMirrorBlocked({ expressionId }), true, expressionId);
  }
  assert.equal(contextMirrorBlocked({ externalSpeech: true }), true);
  assert.equal(contextMirrorBlocked({ transientUi: true }), true);
  assert.equal(contextMirrorBlocked({ state: { state: 'idle', stimulationMode: 'low' }, source: 'base', expressionId: 'life.attentive' }), false);
});

test('busy category arrival skips its phrase instead of queueing, while the latest badge may resume', () => {
  for (const obstruction of ['speech', 'menu', 'sleep', 'focus', 'toast', 'peek', 'dock']) {
    const f = fixture();
    if (obstruction === 'speech') f.speech.say('重要消息');
    if (obstruction === 'menu') f.state.commandMenuOpen = true;
    if (obstruction === 'sleep') f.state.state = 'sleeping';
    if (obstruction === 'focus') f.state.sessionState = 'focused';
    if (obstruction === 'toast') f.foodToast.classList.add('show');
    if (obstruction === 'peek') f.stage.classList.add('peek');
    if (obstruction === 'dock') f.stage.classList.add('is-docked');
    f.ui.observeCategory('music'); f.update();
    assert.equal(f.badge.classList.contains('show'), false, obstruction);
    assert.equal(f.speech.snapshot().source === 'context', false, obstruction);
    f.ui.observeCategory('ai'); f.update('ai');
    f.speech.hide(); f.state.commandMenuOpen = false; f.state.state = 'idle'; f.state.sessionState = 'idle';
    f.foodToast.classList.remove('show'); f.stage.classList.remove('peek'); f.stage.classList.remove('is-docked');
    f.update('ai');
    assert.equal(f.badge.textContent, 'AI协作中');
    assert.equal(f.badge.classList.contains('show'), true);
    assert.equal(f.timers.size, 0, `${obstruction}: no queued phrase`);
  }
});

test('calm, form changes and hidden lifecycle preserve text priority and never replay a phrase', () => {
  const f = fixture();
  f.ui.observeCategory('music'); f.update();
  f.state.stimulationMode = 'low'; f.update('music', { calmVisual: true });
  assert.equal(f.speech.visible(), false);
  assert.equal(f.badge.dataset.motion, 'static');
  f.state.stimulationMode = 'high'; f.update('music', { formId: 'usagi' });
  assert.equal(f.timers.size, 0);
  f.ui.suspend();
  assert.equal(f.badge.classList.contains('show'), false);
  f.ui.observeCategory('ai', { suspended: true }); f.update('ai', { formId: 'usagi' });
  assert.equal(f.timers.size, 0);
  assert.equal(f.badge.textContent, 'AI协作中');
  f.speech.say('用户主动讲话'); f.state.stimulationMode = 'low'; f.update('ai', { calmVisual: true });
  assert.equal(f.speech.hasExternal(), true);
  assert.equal(f.badge.classList.contains('show'), false);
});

test('session labels and coding keep existing text; unsupported categories never manufacture another state', () => {
  const f = fixture();
  f.ui.syncActivity(SESSION_ACTIVITIES['focus-read']);
  assert.equal(f.label.textContent, '📖 专注 · 读书');
  assert.equal(f.stage.classList.contains('session-focused'), true);
  f.ui.observeCategory('coding'); f.update('coding');
  assert.equal(f.label.textContent, '⌨ 写代码');
  assert.equal(f.stage.classList.contains('session-focused'), false);
  assert.equal(f.speech.visible(), false);
  assert.equal(f.badge.classList.contains('show'), false);
  for (const value of ['__proto__', ['music', 'ai'], { music: true, ai: true }]) {
    f.ui.observeCategory(value); f.update(null);
    assert.equal(f.ui.snapshot().category, null);
  }
  const { left, top, width, height } = CONTEXT_BADGE_BOUNDS;
  assert.ok(left >= 6 && top >= 6 && left + width <= 214 && top + height <= 220);
});

test('badge opacity follows the shared action envelope and cannot linger through outgoing art', () => {
  const f = fixture(); f.state.stimulationMode = 'low';
  f.ui.observeCategory('music');
  f.update('music', { action: { ...MIRROR_ACTIVITIES['mirror-music'], propOpacity: .25, mirrorPresentation: { phase: 'enter' } } });
  assert.equal(f.badge.style.opacity, '.25'.replace(/^\./, '0.'));
  f.update('music', { action: { ...MIRROR_ACTIVITIES['mirror-music'], mirrorPresentation: { phase: 'exit' } } });
  assert.equal(f.badge.classList.contains('show'), false);
  f.ui.observeCategory(null); f.update(null);
  assert.equal(f.badge.style.opacity, '0');
});

test('concurrent context uses one bounded strip and one phrase, removals cannot repeat surviving signals', () => {
  const f = fixture();
  const concurrent = (music, ai, coding = false) => ({ v: 1, music, coding, ai });
  f.ui.observeCategory('ai', { concurrent: concurrent(true, true) });
  f.update('ai');
  assert.equal(f.bubble.textContent, '音乐陪你理思路');
  assert.equal(f.timers.size, 1);
  assert.equal(f.badge.classList.contains('show'), false);
  f.expire(); f.update('ai');
  assert.equal(f.badge.textContent, '音乐 · AI协作');
  assert.equal(f.badge.dataset.context, 'music+ai');
  for (let index = 0; index < 5; index++) {
    f.ui.observeCategory('ai', { concurrent: concurrent(true, true) }); f.update('ai');
  }
  assert.equal(f.timers.size, 0);
  f.ui.observeCategory('ai', { concurrent: concurrent(false, true) }); f.update('ai');
  assert.equal(f.badge.textContent, 'AI协作中');
  assert.equal(f.timers.size, 0, 'removing music must not replay AI phrase');
  f.ui.observeCategory('ai', { concurrent: concurrent(true, true) }); f.update('ai');
  assert.equal(f.bubble.textContent, '音乐陪你理思路');
  assert.equal(f.timers.size, 1, 'new music onset gets one current opportunity');
});

test('focus keeps its real activity label and combines only current music/AI context', () => {
  const f = fixture();
  const activity = SESSION_ACTIVITIES['focus-read'];
  const concurrent = { v: 1, music: true, coding: false, ai: true };
  f.state.state = 'focused'; f.state.sessionState = 'focused';
  f.ui.observeCategory('ai', { concurrent });
  const update = (extra = {}) => f.update('ai', { activity, action: activity, source: 'session',
    expressionId: activity.expression, ...extra });
  update();
  assert.equal(f.timers.size, 1);
  f.expire(); update();
  assert.equal(f.label.textContent, '📖 专注 · 读书');
  assert.equal(f.badge.textContent, '专注 · 音乐 · AI');
  assert.equal(f.stage.classList.contains('session-focused'), true);
  update({ action: { ...activity, propOpacity: 0 } });
  assert.equal(f.badge.style.opacity, '1', 'focus prop swaps cannot fade persistent context');
  f.state.commandMenuOpen = true; update();
  assert.equal(f.badge.classList.contains('show'), false);
  f.ui.observeCategory('ai', { concurrent: { ...concurrent, music: false } }); update();
  f.state.commandMenuOpen = false; update();
  assert.equal(f.badge.textContent, '专注 · AI');
  assert.equal(f.timers.size, 0);
  f.state.stimulationMode = 'low'; update({ calmVisual: true });
  assert.equal(f.badge.dataset.motion, 'static');
  assert.equal(f.label.textContent, '📖 专注 · 读书');
  f.state.sessionState = 'resting'; f.state.state = 'resting'; update();
  assert.equal(f.badge.classList.contains('show'), false);
});

test('blocked additions and off-on lifecycle consume only current phrase opportunity', () => {
  const f = fixture();
  const both = { v: 1, music: true, coding: false, ai: true };
  f.state.dragging = true;
  f.ui.observeCategory('ai', { concurrent: both }); f.update('ai');
  assert.equal(f.timers.size, 0);
  f.ui.observeCategory('music', { concurrent: { ...both, ai: false } }); f.update('music');
  f.state.dragging = false; f.update('music');
  assert.equal(f.badge.textContent, '音乐疗愈中');
  assert.equal(f.timers.size, 0, 'never replay blocked AI or remaining music');
  f.ui.observeCategory(null, { concurrent: { ...both, music: false, ai: false } }); f.update(null);
  assert.equal(f.badge.classList.contains('show'), false);
  f.ui.observeCategory('ai', { concurrent: both }); f.update('ai');
  assert.equal(f.timers.size, 1, 'a genuinely new enabled episode can speak');
  f.ui.suspend();
  f.ui.observeCategory('ai', { concurrent: both, suspended: true }); f.update('ai');
  assert.equal(f.timers.size, 0, 'visibility restoration does not replay');
});


test('all allowed contextual text fits one bounded strip without duplicated state labels', () => {
  for (const copy of [...Object.values(CONTEXT_COPY), ...Object.values(CONTEXT_COMBINATION_COPY)]) {
    assert.ok(copy.badge.length <= 12, copy.badge);
    assert.ok(copy.phrase.length <= 9, copy.phrase);
    assert.ok(!/[\n\r]/.test(copy.badge + copy.phrase));
    const labels = copy.badge.split(' · ');
    assert.equal(labels.length, new Set(labels).size);
  }
});
