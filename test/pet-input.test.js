'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetInputController, createMenuAutoClose } = require('../src/core/pet-input.mjs');

function harness() {
  let timer = null;
  const events = [];
  const controller = createPetInputController({
    longPressMs: 550,
    dragThreshold: 14,
    setTimeout(callback) { timer = callback; return 1; },
    clearTimeout() { timer = null; },
    callbacks: {
      onTap: () => events.push('tap'),
      onLongPress: () => events.push('long-press'),
      onCommand: (_event, source) => events.push(`command:${source}`),
      onDragStart: () => events.push('drag-start'),
      onDragMove: () => events.push('drag-move'),
      onDragEnd: () => events.push('drag-end'),
      onDragCancel: (_event, reason) => events.push(`drag-cancel:${reason}`)
    }
  });
  return { controller, events, fireTimer: () => { const callback = timer; timer = null; if (callback) callback(); } };
}

function pointer(overrides = {}) {
  return { pointerId: 7, isPrimary: true, button: 0, screenX: 10, screenY: 20, ctrlKey: false, ...overrides };
}

test('short press fires once on pointerup without waiting for double-click detection', () => {
  const { controller, events } = harness();
  assert.deepEqual(controller.pointerDown(pointer()), { accepted: true, capture: true });
  assert.deepEqual(events, []);
  assert.equal(controller.pointerUp(pointer()).action, 'pressed');
  assert.deepEqual(events, ['tap']);
});

test('long press, drag, and tap are mutually exclusive at the 14px Manhattan threshold', () => {
  const longPress = harness();
  longPress.controller.pointerDown(pointer());
  longPress.fireTimer();
  longPress.controller.pointerUp(pointer());
  assert.deepEqual(longPress.events, ['long-press']);

  const boundary = harness();
  boundary.controller.pointerDown(pointer());
  boundary.controller.pointerMove(pointer({ screenX: 17, screenY: 27 }));
  boundary.controller.pointerUp(pointer({ screenX: 17, screenY: 27 }));
  assert.deepEqual(boundary.events, ['tap'], 'exactly 14px remains a tap');

  const drag = harness();
  drag.controller.pointerDown(pointer());
  drag.controller.pointerMove(pointer({ screenX: 18, screenY: 27 }));
  drag.fireTimer();
  drag.controller.pointerUp(pointer({ screenX: 18, screenY: 27 }));
  assert.deepEqual(drag.events, ['drag-start', 'drag-move', 'drag-end']);
});

test('right-click never enters the primary state machine and Control-click opens one command path', () => {
  const right = harness();
  assert.equal(right.controller.pointerDown(pointer({ button: 2 })).accepted, false);
  right.controller.pointerUp(pointer({ button: 2 }));
  right.fireTimer();
  assert.deepEqual(right.events, []);

  const control = harness();
  assert.equal(control.controller.pointerDown(pointer({ ctrlKey: true })).accepted, false);
  control.controller.pointerUp(pointer({ ctrlKey: true }));
  control.fireTimer();
  assert.deepEqual(control.events, ['command:control-click']);
});

test('pointer cancellation, lost capture, blur, and page hiding can reset without leaking actions', () => {
  for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
    const { controller, events, fireTimer } = harness();
    controller.pointerDown(pointer());
    assert.equal(controller.cancel(reason, pointer()), true);
    controller.pointerUp(pointer());
    fireTimer();
    assert.deepEqual(events, [], reason);
    assert.deepEqual(controller.snapshot(), { phase: 'idle' });
  }
});

test('cancelling an active drag reports cancellation but never reports a drag end or tap', () => {
  const { controller, events } = harness();
  controller.pointerDown(pointer());
  controller.pointerMove(pointer({ screenX: 30 }));
  controller.cancel('blur', pointer({ screenX: 30 }));
  assert.deepEqual(events, ['drag-start', 'drag-move', 'drag-cancel:blur']);
});

function menuHarness(overrides = {}) {
  let sequence = 0;
  const timers = new Map();
  const closes = [];
  const auto = createMenuAutoClose({
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    onClose: () => closes.push('close'),
    ...overrides
  });
  return {
    auto, closes, timers,
    fireAll() {
      for (const [id, entry] of [...timers]) { timers.delete(id); entry.callback(); }
    }
  };
}

test('an armed menu timeout always closes the menu, even while the menu still owns keyboard focus', () => {
  const menu = menuHarness({ isFocusInside: () => true, isPointerInside: () => true });
  assert.equal(menu.auto.arm(), 8000);
  assert.equal(menu.auto.pending(), true);
  menu.fireAll();
  assert.deepEqual(menu.closes, ['close'], 'focus inside the menu must not veto the close');
  assert.equal(menu.auto.pending(), false);
});

test('menu idle delay shortens once the pointer leaves the pet and re-arming never leaks a timer', () => {
  let focusInside = false;
  let pointerInside = true;
  const menu = menuHarness({ isFocusInside: () => focusInside, isPointerInside: () => pointerInside });

  assert.equal(menu.auto.arm(), 5000, 'pointer hovering the pet keeps the normal idle delay');
  pointerInside = false;
  assert.equal(menu.auto.arm(), 2000, 'pointer away from the pet collapses to the short delay');
  focusInside = true;
  assert.equal(menu.auto.arm(), 8000, 'keyboard users get the longest delay');
  assert.equal(menu.timers.size, 1, 're-arming replaces the pending timer instead of stacking');

  menu.auto.cancel();
  assert.equal(menu.auto.pending(), false);
  menu.fireAll();
  assert.deepEqual(menu.closes, [], 'a cancelled timer can never fire a late close');
});
