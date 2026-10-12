'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bindCornerControls } = require('../src/surfaces/reminders/corner-controls.mjs');

function harness() {
  let document, nativeFocus;
  const calls = [], pointer = [];
  function node(primary = false) {
    const listeners = new Map();
    return {
      disabled: false, children: [], classList: { contains: name => name === 'primary' && primary },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
      fire(type, input = {}) {
        const event = { target: this, prevented: false, preventDefault() { this.prevented = true; }, ...input };
        for (const callback of listeners.get(type) || []) callback(event);
        return event;
      },
      contains(other) { return this === other || this.children.includes(other); },
      focus(options) { document.activeElement = this; this.focusOptions = options; }
    };
  }
  const primary = node(true), defer = node(), skip = node(), close = node(), bubble = node(), character = node(), copy = node();
  const status = node(); status.hidden = true;
  const buttons = [primary, defer, skip, close];
  bubble.children = [copy, primary, defer, skip];
  document = Object.assign(node(), {
    body: node(), activeElement: null,
    getElementById: id => ({ closeBtn: close, bubble, bubbleCopy: copy, nudgeStatus: status })[id],
    querySelector: () => character,
    querySelectorAll: () => buttons.filter(button => !button.disabled)
  });
  const dispose = bindCornerControls({ document, run: action => calls.push(action),
    onFocus: callback => { nativeFocus = callback; return () => { nativeFocus = null; }; },
    setPointerInteractive: value => pointer.push(value) });
  return { document, primary, defer, skip, close, bubble, character, copy, status, buttons, calls, pointer, dispose,
    focus: () => nativeFocus?.() };
}

test('copy, character and empty-area clicks do not dismiss a reminder', () => {
  const h = harness();
  for (const node of [h.document.body, h.bubble, h.copy, h.character]) node.fire('click');
  assert.deepEqual(h.calls, []);
});

test('only the close control and Escape send explicit dismiss actions', () => {
  const h = harness();
  h.close.fire('click');
  assert.equal(h.document.fire('keydown', { key: 'Escape' }).prevented, true);
  assert.deepEqual(h.calls, ['dismiss', 'dismiss']);
});

test('native shortcut focuses the primary action and permits scrolling it into view', () => {
  const h = harness(); h.focus();
  assert.equal(h.document.activeElement, h.primary);
  assert.equal(h.primary.focusOptions, undefined);
  h.primary.disabled = true; h.focus();
  assert.equal(h.document.activeElement, h.defer);
});

test('explicit reading and action loop includes visible feedback in both directions', () => {
  const h = harness();
  for (const hidden of [true, false]) {
    h.status.hidden = hidden;
    const order = [h.copy, ...h.buttons.slice(0, 3), ...(hidden ? [] : [h.status]), h.close];
    for (const shiftKey of [false, true]) {
      order.forEach((active, index) => {
        h.document.activeElement = active;
        assert.equal(h.document.fire('keydown', { key: 'Tab', shiftKey }).prevented, true);
        assert.equal(h.document.activeElement, order[(index + (shiftKey ? -1 : 1) + order.length) % order.length]);
      });
    }
  }
  assert.deepEqual(h.calls, []);
});

test('pending actions remain readable while disabled controls are skipped', () => {
  const h = harness(); h.buttons.forEach(button => { button.disabled = true; });
  h.document.activeElement = null; h.focus();
  assert.equal(h.document.activeElement, null);
  h.document.fire('keydown', { key: 'Tab' });
  assert.equal(h.document.activeElement, h.copy);
  for (const key of ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp']) {
    assert.equal(h.document.fire('keydown', { key }).prevented, false);
  }
  assert.deepEqual(h.calls, []);
});

test('pointer handoff remains active between copy and buttons and releases outside', () => {
  const h = harness();
  h.bubble.fire('mouseenter'); h.bubble.fire('mouseleave', { relatedTarget: h.primary });
  assert.deepEqual(h.pointer, [true]);
  h.bubble.fire('mouseleave', { relatedTarget: h.document.body });
  assert.deepEqual(h.pointer, [true, false]);
});

test('disposing the card releases listeners and native focus subscription', () => {
  const h = harness(); h.dispose();
  h.close.fire('click'); h.document.fire('keydown', { key: 'Escape' }); h.focus();
  assert.deepEqual(h.calls, []);
  assert.equal(h.document.activeElement, null);
});
