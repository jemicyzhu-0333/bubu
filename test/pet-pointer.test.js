'use strict';

// pet 指针交互适配器的行为验证。
//
// 这里守的是“拿起→拖动”的形变契约：快速抓起即拖时，按压压缩弹簧还在朝 1 冲，
// 转入拖动必须把 squash 弹簧“连值带速度”瞬时归零，否则拖动头几帧身体会被压扁
// （1.06 宽 / 0.90 高）——这正是用户反馈的“拖动的时候人都瘪了”。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetPointer } = require('../src/surfaces/pet/pointer.mjs');

function stubElement() {
  const handlers = new Map();
  return {
    handlers,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type) { handlers.delete(type); },
    setPointerCapture() {},
    hasPointerCapture() { return true; },
    releasePointerCapture() {},
    querySelector() { return null; },
    dispatch(type, event) { const handler = handlers.get(type); if (handler) handler(event); }
  };
}

function harness(extraCallbacks = {}, clientOverrides = {}) {
  const petHit = stubElement();
  const petLayer = stubElement();
  const document = { getElementById() { return null; } };
  const window = { addEventListener() {}, removeEventListener() {} };
  const client = {
    pet_getBounds: async () => ({ x: 100, y: 100, width: 80, height: 80 }),
    pet_setPosition: async () => {},
    pet_dragStart: async () => {},
    pet_dragEnd: async () => {},
    pet_savePosition: async () => {},
    pet_interaction: async () => ({}),
    ...clientOverrides
  };
  const squashSets = [];
  const squashTargets = [];
  createPetPointer({
    window, document, petHit, petLayer, client,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    callbacks: {
      calmMotionRequested: () => false,
      readWallClock: () => 0,
      setSquash: (value, velocity) => squashSets.push([value, velocity]),
      setSquashTarget: value => squashTargets.push(value),
      ...extraCallbacks
    }
  });
  return { petHit, squashSets, squashTargets };
}

function pointerEvent(overrides = {}) {
  return { pointerId: 7, isPrimary: true, button: 0, ctrlKey: false, screenX: 0, screenY: 0, ...overrides };
}

test('快速“抓起即拖”把按压压缩弹簧瞬时归零，拖动头几帧不再压扁', () => {
  const { petHit, squashSets, squashTargets } = harness();

  // 按下：进入 pressed，按压压缩目标设为 1（身体开始朝 1.06 宽 / 0.90 高压）。
  petHit.dispatch('pointerdown', pointerEvent({ screenX: 0, screenY: 0 }));
  assert.deepEqual(squashTargets, [1], '按下应把 squash 目标设为 1');
  assert.deepEqual(squashSets, [], '按下阶段不直接改写弹簧值');

  // 越过 14px 阈值转入拖动：先 onPressChange(false) 把目标归零，再 onDragStart 把弹簧瞬时归零。
  petHit.dispatch('pointermove', pointerEvent({ screenX: 20, screenY: 0 }));
  assert.deepEqual(squashTargets, [1, 0], '转入拖动应把 squash 目标归零');
  assert.ok(squashSets.some(([value, velocity]) => value === 0 && velocity === 0),
    '拖动开始必须 setSquash(0,0) 瞬时抹掉按压压缩的残留过冲，而不是只改目标等它慢慢衰减');
});

test('低刺激/减少动效时拖动不驱动任何 squash 形变', () => {
  const { petHit, squashSets, squashTargets } = harness({ calmMotionRequested: () => true });

  petHit.dispatch('pointerdown', pointerEvent({ screenX: 0, screenY: 0 }));
  petHit.dispatch('pointermove', pointerEvent({ screenX: 20, screenY: 0 }));

  assert.deepEqual(squashTargets, [], '静态降级下不设置任何 squash 目标');
  assert.deepEqual(squashSets, [], '静态降级下不写入任何 squash 弹簧值');
});

test('releasing while a menu is closing cannot start a stale native drag', async () => {
  let closeMenu;
  const closing = new Promise(resolve => { closeMenu = resolve; });
  let starts = 0;
  const { petHit } = harness({ toggleCommandMenu: () => closing }, { pet_dragStart: async () => { starts++; } });
  petHit.dispatch('pointerdown', pointerEvent());
  petHit.dispatch('pointermove', pointerEvent({ screenX: 30 }));
  petHit.dispatch('pointerup', pointerEvent({ screenX: 30 }));
  closeMenu();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 0);
});

test('native drag anchors are captured only after the menu has restored the small window', async () => {
  const order = [];
  const { petHit } = harness({ toggleCommandMenu: async () => { order.push('closed'); } }, {
    pet_dragStart: async () => { order.push('native-start'); },
    pet_getBounds: async () => { order.push('bounds'); return { x: -500, y: 80 }; }
  });
  petHit.dispatch('pointerdown', pointerEvent());
  petHit.dispatch('pointermove', pointerEvent({ screenX: 30 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['closed', 'native-start', 'bounds']);
  petHit.dispatch('pointercancel', pointerEvent());
});
