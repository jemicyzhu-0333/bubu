import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStatusFooter } from '../src/surfaces/pet/status-footer.mjs';
import { createPetSpeech } from '../src/surfaces/pet/speech.mjs';
import { createContextEmphasis, contextCopyFor, CONTEXT_BADGE_BOUNDS } from '../src/surfaces/pet/context-emphasis.mjs';
import { SESSION_ACTIVITIES } from '../src/content/session-activities.mjs';

// Deliberately a DOM port double, not CSS/browser layout evidence.
function element(children = {}) {
  const classes = new Set(), handlers = new Map();
  return { dataset: {}, style: {}, attributes: {}, textContent: '', children: [], parentElement: null,
    classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key),
      toggle: (key, force) => force ? classes.add(key) : classes.delete(key) },
    querySelector: key => children[key] || null,
    setAttribute(key, value) { this.attributes[key] = String(value); },
    addEventListener(key, listener) { handlers.set(key, listener); },
    removeEventListener(key, listener) { if (handlers.get(key) === listener) handlers.delete(key); },
    dispatch(key, event = {}) { handlers.get(key)?.({ stopPropagation() {}, ...event }); },
    appendChild(child) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      this.children.push(child); child.parentElement = this; return child;
    }, handlers };
}
function fixture() {
  const label = element(), contextLabel = element(), count = element();
  const badge = element({ '.context-label': contextLabel, '.context-count': count });
  const stage = element(), slot = element(), bubble = element();
  stage.appendChild(bubble);
  let serial = 0; const timers = new Map();
  const speech = createPetSpeech({ bubble, contextSlot: slot,
    setTimeout: callback => { timers.set(++serial, callback); return serial; }, clearTimeout: key => timers.delete(key) });
  return { label, contextLabel, count, badge, stage, slot, bubble, timers, speech };
}

test('footer preserves full action label including a same-ID title change', () => {
  const f = fixture(), footer = createStatusFooter(f);
  const action = SESSION_ACTIVITIES['focus-read'];
  footer.syncActivity(action);
  assert.equal(f.stage.classList.contains('session-focused'), true);
  const longer = { ...action, label: '整理一份很长的中文项目标题和所有待办便签' };
  footer.syncActivity(longer);
  assert.equal(f.label.textContent, `${action.icon} 专注 · ${longer.label}`);
  assert.equal(f.label.attributes['aria-label'], f.label.textContent);
  assert.equal(f.label.attributes.title, f.label.textContent);
  footer.syncActivity(SESSION_ACTIVITIES['rest-tea']);
  assert.equal(f.stage.classList.contains('session-focused'), false);
});

test('context control retains its SVG/text children, exposes full label and supports compact disclosure', () => {
  const f = fixture(), footer = createStatusFooter(f);
  const input = { copy: '专注 · 音乐 · AI', context: 'music+ai', calmVisual: true, opacity: 1 };
  footer.showContext(input);
  assert.equal(f.badge.textContent, '', 'never replaces the icon/text tree');
  assert.equal(f.contextLabel.textContent, input.copy);
  assert.equal(f.count.textContent, '2');
  assert.equal(f.badge.attributes['aria-label'], input.copy);
  assert.equal(f.badge.attributes.tabindex, '0');
  f.badge.dispatch('click'); assert.equal(f.badge.attributes['aria-expanded'], 'true');
  footer.showContext(input); assert.equal(f.badge.attributes['aria-expanded'], 'true', 'frame refresh must not collapse disclosure');
  f.badge.dispatch('keydown', { key: 'Escape' }); assert.equal(f.badge.attributes['aria-expanded'], 'false');
  f.badge.dispatch('click'); f.badge.dispatch('blur'); assert.equal(f.badge.dataset.expanded, 'false');
  f.badge.dispatch('click');
  footer.showContext({ ...input, copy: '专注 · AI', context: 'ai' });
  assert.equal(f.badge.dataset.expanded, 'false', 'removed signals cannot remain expanded');
  footer.hideContext();
  assert.equal(f.badge.attributes.tabindex, '-1'); assert.equal(f.badge.attributes['aria-hidden'], 'true');
  footer.dispose(); assert.equal(f.badge.handlers.size, 0);
});

test('one speech node moves between supplemental row and original stage without replay or stale callback', () => {
  const f = fixture();
  f.speech.showContext('音乐陪你理思路');
  assert.equal(f.bubble.parentElement, f.slot);
  const stale = [...f.timers.values()][0];
  f.speech.say('必要反馈');
  assert.equal(f.bubble.parentElement, f.stage);
  assert.equal(f.slot.children.length, 0);
  stale(); assert.equal(f.speech.visible(), true); assert.equal(f.bubble.textContent, '必要反馈');
  assert.equal(f.timers.size, 1);
  f.speech.hide(); f.speech.showContext('一起理理思路');
  assert.equal(f.bubble.parentElement, f.slot); assert.equal(f.slot.children.length, 1);
});

test('focus plus music and AI has mutually exclusive supplemental phrase/badge through interruption', () => {
  const f = fixture(), ui = createContextEmphasis(f);
  const action = SESSION_ACTIVITIES['focus-read'];
  const state = { state: 'focused', sessionState: 'focused' };
  const update = () => ui.update({ activity: action, action, state, source: 'session', formId: 'usagi' });
  ui.observeCategory('ai', { concurrent: { v: 1, music: true, coding: false, ai: true } }); update();
  assert.equal(f.stage.classList.contains('session-focused'), true);
  assert.equal(f.bubble.parentElement, f.slot); assert.equal(f.badge.classList.contains('show'), false);
  [...f.timers.values()][0](); update();
  assert.equal(f.speech.visible(), false); assert.equal(f.badge.classList.contains('show'), true);
  f.badge.dispatch('click');
  state.commandMenuOpen = true; update();
  assert.equal(f.badge.classList.contains('show'), false); assert.equal(f.badge.dataset.expanded, 'false');
  ui.observeCategory('ai', { concurrent: { v: 1, music: false, coding: false, ai: true } });
  state.commandMenuOpen = false; update();
  assert.equal(f.contextLabel.textContent, '专注 · AI'); assert.equal(f.speech.visible(), false);
  ui.suspend(); assert.equal(f.badge.attributes.tabindex, '-1');
});

test('default footer geometry proxy is disjoint and inside stage; HTML retains actual controls', () => {
  const action = { left: 10, top: 184, width: 72, height: 26 };
  const feed = { left: 184, top: 184, width: 26, height: 26 };
  const context = CONTEXT_BADGE_BOUNDS;
  const intersects = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width
    && a.top < b.top + b.height && b.top < a.top + a.height;
  for (const a of [action, feed, context]) for (const b of [action, feed, context]) if (a !== b) assert.equal(intersects(a, b), false);
  for (const b of [action, feed, context]) assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= 220 && b.top + b.height <= 220);
  const html = fs.readFileSync(new URL('../src/renderer/pet.html', import.meta.url), 'utf8');
  for (const id of ['statusFooter', 'activityBar', 'activityLabel', 'activityNext', 'contextRow', 'contextBadge', 'feedQuick', 'bubble']) {
    assert.equal(html.split(`id="${id}"`).length, 2, `one existing ${id}`);
  }
  // Narrow architecture guards complement the behavior tests above, not DOM layout acceptance.
  const css = fs.readFileSync(new URL('../src/surfaces/pet/status-footer.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template: "action context feed" 26px/);
  assert.match(css, /top: 184px/);
  assert.match(css, /@media \(max-height: 217px\)/);
});

test('all displayed activity categories are present in the same accessible context name', () => {
  for (const primary of ['focus-read', 'mirror-ai', 'mirror-coding']) {
    for (const categories of [{ music: true, coding: true, ai: true }, { music: false, coding: true, ai: true }, { music: true, coding: true, ai: false }]) {
      const copy = contextCopyFor({ primary, categories });
      const f = fixture(), footer = createStatusFooter(f);
      footer.showContext({ copy: copy.badge, context: Object.keys(categories).filter(key => categories[key]).join('+'), calmVisual: true, opacity: 1 });
      for (const [key, label] of [['music', '音乐'], ['ai', 'AI'], ['coding', '编程']]) {
        assert.equal(f.badge.attributes['aria-label'].includes(label), categories[key]);
      }
    }
  }
});
