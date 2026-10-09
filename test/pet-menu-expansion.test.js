'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetMenuExpansion } = require('../src/platform/electron/pet-menu-expansion');

const PET = { w: 220, h: 220 };
const MENU = { w: 520, h: 360 };
const WORK_AREA = Object.freeze({ x: 0, y: 38, width: 1512, height: 944 });
const workAreaAt = () => WORK_AREA;
const petCenter = (bounds, offset = { x: 0, y: 0 }) => [
  bounds.x + bounds.width / 2 + offset.x, bounds.y + bounds.height / 2 + offset.y
];

// 宠物在默认的右下角时，对称扩容会把菜单窗口推出屏幕一半。
test('opening at the default bottom-right keeps the window on screen and the pet in place', () => {
  const expansion = createPetMenuExpansion({ petSize: PET, menuSize: MENU });
  const closed = { x: 1272, y: 742, width: 220, height: 220 };
  const opened = expansion.plan({ bounds: closed, open: true, workAreaAt });
  const b = opened.bounds;
  assert.equal(opened.changed, true);
  assert.ok(b.x >= WORK_AREA.x && b.y >= WORK_AREA.y);
  assert.ok(b.x + b.width <= WORK_AREA.x + WORK_AREA.width);
  assert.ok(b.y + b.height <= WORK_AREA.y + WORK_AREA.height);
  assert.deepEqual(petCenter(b, opened.geometry.stageOffset), petCenter(closed),
    'the stage offset puts the pet back where it was');
  assert.equal(opened.geometry.side, 'left', 'the menu opens toward the roomier side');
  const reopened = expansion.plan({ bounds: b, open: true, workAreaAt });
  assert.equal(reopened.changed, false, 'opening twice is a no-op');

  const back = expansion.plan({ bounds: b, open: false, workAreaAt });
  assert.deepEqual(back.bounds, closed, 'closing restores the exact resting bounds');
  assert.deepEqual(back.geometry.stageOffset, { x: 0, y: 0 });
});

test('a pet with room on every side expands symmetrically and opens to the right', () => {
  const expansion = createPetMenuExpansion({ petSize: PET, menuSize: MENU });
  const closed = { x: 400, y: 400, width: 220, height: 220 };
  const opened = expansion.plan({ bounds: closed, open: true, workAreaAt });
  assert.deepEqual(opened.bounds, { x: 250, y: 330, width: 520, height: 360 });
  assert.deepEqual(opened.geometry.stageOffset, { x: 0, y: 0 });
  assert.equal(opened.geometry.side, 'right');
});

test('top-left corners clamp the other way and bad input is refused', () => {
  const expansion = createPetMenuExpansion({ petSize: PET, menuSize: MENU });
  const opened = expansion.plan({ bounds: { x: 0, y: 38, width: 220, height: 220 }, open: true, workAreaAt });
  assert.deepEqual([opened.bounds.x, opened.bounds.y], [0, 38]);
  assert.deepEqual(opened.geometry.stageOffset, { x: -150, y: -70 });
  assert.equal(opened.geometry.side, 'right');
  assert.throws(() => expansion.plan({ bounds: null, open: true, workAreaAt }), /bounds/);
  assert.throws(() => createPetMenuExpansion({}), /sizes/);
});

test('negative-origin and small secondary displays keep fractional pet anchors and round-trip bounds', () => {
  for (const workArea of [
    { x: -1920, y: -240, width: 1280, height: 720 },
    { x: -380, y: 80, width: 380, height: 300 }
  ]) {
    const expansion = createPetMenuExpansion({ petSize: PET, menuSize: MENU });
    const closed = { x: workArea.x + 31, y: workArea.y + 15, width: 221, height: 221 };
    const opened = expansion.plan({ bounds: closed, open: true, workAreaAt: () => workArea });
    assert.deepEqual(petCenter(opened.bounds, opened.geometry.stageOffset), petCenter(closed));
    assert.ok(opened.bounds.x >= workArea.x && opened.bounds.y >= workArea.y);
    assert.ok(opened.bounds.x + opened.bounds.width <= workArea.x + workArea.width);
    assert.ok(opened.bounds.y + opened.bounds.height <= workArea.y + workArea.height);
    assert.equal(expansion.plan({ bounds: opened.bounds, open: true, workAreaAt: () => workArea }).changed, false);
  }
});
