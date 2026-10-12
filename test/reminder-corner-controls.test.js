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
  const buttons = [primary, defer, skip, close];
  bubble.children = [copy, primary, defer, skip];
  document = Object.assign(node(), {
    body: node(), activeElement: null,
    getElementById: id => ({ closeBtn: close, bubble })[id],
    querySelector: () => character,
    querySelectorAll: () => buttons.filter(button => !button.disabled)
  });
  const dispose = bindCornerControls({ document, run: action => calls.push(action),
    onFocus: callback => { nativeFocus = callback; return () => { nativeFocus = null; }; },
    setPointerInteractive: value => pointer.push(value) });
  return { document, primary, defer, skip, close, bubble, character, copy, buttons, calls, pointer, dispose,
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

test('Tab and Shift-Tab keep reachable controls in the card in both languages', () => {
  const h = harness();
  for (const labels of [['已完成', '稍后15分钟', '跳过本次', '关闭提醒'], ['Done', 'In 15 minutes', 'Skip this time', 'Close reminder']]) {
    h.buttons.forEach((button, index) => { button.textContent = labels[index]; });
    h.document.activeElement = h.close;
    assert.equal(h.document.fire('keydown', { key: 'Tab' }).prevented, true);
    assert.equal(h.document.activeElement, h.primary);
    assert.equal(h.document.fire('keydown', { key: 'Tab', shiftKey: true }).prevented, true);
    assert.equal(h.document.activeElement, h.close);
    h.document.activeElement = h.document.body;
    h.document.fire('keydown', { key: 'Tab' });
    assert.equal(h.document.activeElement, h.primary);
  }
  assert.deepEqual(h.calls, []);
});

test('pending actions with no enabled controls do not focus or send extra commands', () => {
  const h = harness(); h.buttons.forEach(button => { button.disabled = true; });
  h.document.activeElement = null; h.focus();
  assert.equal(h.document.activeElement, null);
  assert.equal(h.document.fire('keydown', { key: 'Tab' }).prevented, false);
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
