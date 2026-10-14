'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventTimeDialog } = require('../src/surfaces/popover/ui/event-time-dialog.mjs');
const { createPopoverModalPrimitive } = require('../src/surfaces/popover/ui/modal.mjs');
const { createPopoverModalRegistry } = require('../src/surfaces/popover/ui/modal-registry.mjs');
const { registerPopoverModals, POPOVER_MODAL_LAYER, POPOVER_LANDING_BLOCKING_MODALS } = require('../src/surfaces/popover/ui/modal-layer.mjs');
function harness() {
  const nodes = new Map(), listeners = new Map(), restores = [];
  const classes = new Set(['hidden']), attributes = {};
  const field = name => {
    if (!nodes.has(name)) nodes.set(name, { value: '', textContent: '', disabled: false, isConnected: true, attrs: {},
      setAttribute(key, value) { this.attrs[key] = value; }, getAttribute(key) { return this.attrs[key] || null; },
      closest: () => null, focus() { global.document.activeElement = this; } });
    return nodes.get(name);
  };
  const root = { classList: { add: key => classes.add(key), remove: key => classes.delete(key) },
    setAttribute: (key, value) => { attributes[key] = value; }, querySelector: field,
    querySelectorAll: () => ['[data-time-close]', '[data-time-input]', '[data-time-cancel]', '[data-time-save]'].map(field) };
  Object.defineProperty(root, 'innerHTML', { set(value) { nodes.clear(); const match = value.match(/value="([^"]*)"/); if (match) field('[data-time-input]').value = match[1]; } });
  const $ = () => root;
  const primitive = createPopoverModalPrimitive({ $, $$: () => [] });
  const dialog = createEventTimeDialog({ $, escapeHTML: String, listen: (_node, type, fn) => listeners.set(type, fn),
    restoreModalFocus: (target, guard) => restores.push(() => { if (guard()) target?.focus(); }), trapFocusWithin: primitive.trapFocusWithin });
  global.document = { activeElement: null };
  dialog.mount();
  const open = options => dialog.open({ key: 'inbox:a', title: 'Reading', value: '2026-10-13T08:00', precision: 'minute', submit: async () => ({ ok: true }), ...options });
  const key = (key, shiftKey = false) => { const event = { key, shiftKey, preventDefault() { this.prevented = true; }, stopPropagation() {} }; listeners.get('keydown')(event); return event; };
  return { dialog, open, field, root, attributes, classes, restores, listeners, key, $ };
}

test('shared dialog traps Tab with the existing primitive and Escape restores the opening control', () => {
  const h = harness(); let focused = 0;
  try {
    h.open({ resolveReturnFocus: () => ({ focus: () => focused++ }) });
    assert.equal(h.attributes['aria-hidden'], 'false');
    h.field('[data-time-save]').focus(); assert.equal(h.key('Tab').prevented, true);
    assert.equal(global.document.activeElement, h.field('[data-time-close]'));
    assert.equal(h.key('Tab', true).prevented, true);
    assert.equal(global.document.activeElement, h.field('[data-time-save]'));
    h.key('Escape'); h.restores.forEach(run => run());
    assert.equal(focused, 1); assert.equal(h.dialog.isOpen(), false); assert.equal(h.attributes['aria-hidden'], 'true');
  } finally { delete global.document; }
});

test('a deferred focus restoration cannot steal focus from a newly opened source', () => {
  const h = harness(); let focused = 0;
  try {
    h.open({ resolveReturnFocus: () => ({ focus: () => focused++ }) }); h.dialog.close();
    h.open({ key: 'routine:b' }); h.restores.forEach(run => run());
    assert.equal(focused, 0); assert.equal(global.document.activeElement, h.field('[data-time-input]'));
  } finally { delete global.document; }
});

test('inbox minute confirmation retains exact source milliseconds and cancellation changes nothing', async () => {
  const h = harness(), calls = [];
  const originalAt = new Date(2026, 9, 13, 8, 0, 21, 456).getTime();
  try {
    h.open({ originalAt, submit: async value => { calls.push(value); return { ok: true }; } });
    h.dialog.close(); assert.equal(calls.length, 0);
    h.open({ originalAt, submit: async value => { calls.push(value); return { ok: true }; } }); await h.dialog.save();
    assert.deepEqual(calls, [{ at: originalAt, value: '2026-10-13T08:00' }]);
  } finally { delete global.document; }
});

test('invalid input and caller range refusal stay inside the shared dialog without closing', async () => {
  const h = harness(); let called = 0;
  try {
    h.open({ submit: async () => { called++; return { ok: false, message: '记录时间不能晚于现在。' }; } });
    h.field('[data-time-input]').value = ''; await h.dialog.save(); assert.equal(called, 0);
    assert.equal(h.field('[data-time-input]').attrs['aria-invalid'], 'true');
    h.field('[data-time-input]').value = '2026-10-13T09:00'; await h.dialog.save();
    assert.equal(called, 1); assert.equal(h.dialog.isOpen(), true);
    assert.match(h.field('[data-time-status]').textContent, /不能晚于现在/);
  } finally { delete global.document; }
});

test('event time participates in the established modal registry and blocks landing stacking', () => {
  const h = harness();
  try {
    const registry = createPopoverModalRegistry({ $: h.$, modalPrimitive: { trapFocusWithin() {} }, onNoneOpen() {} });
    const modals = Object.fromEntries(POPOVER_MODAL_LAYER.map(item => [item.name, { isOpen: () => false, close() {} }]));
    modals.eventTime = h.dialog; registerPopoverModals({ registry, $: h.$, modals });
    h.open(); assert.equal(registry.isAnyOpen(), true); assert.equal(registry.isOpen('eventTime'), true);
    assert.equal(POPOVER_LANDING_BLOCKING_MODALS.includes('eventTime'), true);
    registry.handleKeydown({ key: 'Escape', preventDefault() {} }); assert.equal(h.dialog.isOpen(), false);
  } finally { delete global.document; }
});
