'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileDangoAppearance, emitDangoAppearance } = require('../tools/dango-build/appearance-build.mjs');
const { DANGO_APPEARANCE, APPEARANCE_VERSION } = require('../src/content/companion/dango-appearance.mjs');
const { BODY_GRIDS, PART_GRIDS, VIEW_LAYOUTS } = require('../src/content/companion/dango-body.mjs');
const { APPEARANCE_SPRITES, APPEARANCE_COLORS } = require('../src/core/pet-appearance-sprites.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { projectAppearance } = require('../src/core/pet-appearance.mjs');
const { drawAppearanceLayer, HEAD_LIFT } = require('../src/core/pet-appearance-art.mjs');
const VIEWS = ['front', 'three-quarter', 'profile', 'back'];
const ITEMS = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'dango');
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'assets/companion/dango/dango.appearance.svg'), 'utf8');

function cells(runs) {
  const set = new Set();
  for (const [x, y, width] of runs) for (let px = x; px < x + width; px += 2) set.add(`${px / 2},${y / 2}`);
  return set;
}
function gridCells(grid) {
  const set = new Set();
  grid.forEach((row, y) => [...row].forEach((value, x) => { if (value !== '.') set.add(`${x},${y}`); }));
  return set;
}
function touches(a, b) {
  for (const cell of a) {
    const [x, y] = cell.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      if (b.has(`${x + dx},${y + dy}`)) return true;
    }
  }
  return false;
}
function components(set) {
  const remaining = new Set(set), groups = [];
  while (remaining.size) {
    const seed = remaining.values().next().value, group = new Set([seed]), queue = [seed];
    remaining.delete(seed);
    while (queue.length) {
      const [x, y] = queue.pop().split(',').map(Number);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        const next = `${x + dx},${y + dy}`;
        if (remaining.delete(next)) { group.add(next); queue.push(next); }
      }
    }
    groups.push(group);
  }
  return groups;
}
function recorder() {
  const calls = [], stack = [];
  let x = 0, y = 0;
  return { calls, save() { stack.push([x, y]); }, restore() { [x, y] = stack.pop(); },
    translate(dx, dy) { x += dx; y += dy; },
    transform(...matrix) { calls.push(['matrix', ...matrix]); },
    fillRect(px, py, w, h) { calls.push(['rect', px + x, py + y, w, h, this.fillStyle]); } };
}

test('editable wardrobe source deterministically reproduces all sixteen generated four-view accessories', () => {
  const result = compileDangoAppearance(source);
  assert.equal(result.version, APPEARANCE_VERSION);
  assert.deepEqual(result.items, DANGO_APPEARANCE);
  assert.equal(emitDangoAppearance(result), fs.readFileSync(path.join(ROOT, 'src/content/companion/dango-appearance.mjs'), 'utf8'));
  assert.deepEqual(Object.keys(result.items).sort(), ITEMS.map(item => item.renderKey).sort());
  for (const item of ITEMS) {
    assert.deepEqual(Object.keys(result.items[item.renderKey].views), VIEWS);
    for (const view of VIEWS) for (const layer of ['back', 'front']) {
      const parts = result.items[item.renderKey].views[view][layer];
      if (!item.parts.includes(layer)) assert.equal(parts.length, 0, `${item.id}: no undeclared layer`);
      for (const part of parts) for (const run of part.runs) {
        assert.ok(run.slice(0, 3).every(value => Number.isInteger(value) && value % 2 === 0));
        assert.ok(run[2] > 0);
      }
    }
  }
});

test('malformed authoring sources fail instead of silently warping, dropping views or accepting unsafe colors', () => {
  assert.throws(() => compileDangoAppearance(source.replace('data-art-scale="2"', 'data-art-scale="1"')), /two art units/);
  assert.throws(() => compileDangoAppearance(source.replace('data-version="1"', 'data-version="0"')), /positive wardrobe version/);
  assert.throws(() => compileDangoAppearance(source.replace('data-view="front"', 'transform="scale(.5 1)" data-view="front"')), /untransformed/);
  assert.throws(() => compileDangoAppearance(source.replace('data-view="profile"', 'data-view="sideways"')), /explicit and unique/);
  assert.throws(() => compileDangoAppearance(source.replace('<path ', '<path transform="scale(.5 1)" ')), /plain authored paths/);
  assert.throws(() => compileDangoAppearance(source.replace('data-accent="#81bf78"', 'data-accent="url(unsafe)"')), /palette roles/);
});

test('ear clips, hats, short capes and bags make physical contact in each independently authored view', () => {
  for (const item of ITEMS.filter(item => item.renderKey !== 'halo')) for (const view of VIEWS) {
    const data = DANGO_APPEARANCE[item.renderKey].views[view];
    const ink = cells([...data.back, ...data.front].flatMap(part => part.runs));
    const body = gridCells(BODY_GRIDS[view]);
    assert.ok(ink.size, `${item.id}@${view}`);
    for (const piece of components(ink)) {
      assert.ok(touches(piece, body), `${item.id}@${view}: detached component ${[...piece].slice(0, 4)}`);
    }
  }
});

test('every foreground accessory avoids current authored eyes, mouth and cheeks for all four views', () => {
  for (const view of VIEWS) {
    const layout = VIEW_LAYOUTS[view];
    const boxes = [...Object.values(layout.eyeAnchors).map(a => [a.gridX, a.gridY, 5, 5]),
      ...layout.cheekAnchors.map(([x, y]) => [x, y, 3, 2])];
    if (layout.mouthAnchor) boxes.push([layout.mouthAnchor.gridX, layout.mouthAnchor.gridY, 7, 4]);
    for (const item of ITEMS) for (const part of DANGO_APPEARANCE[item.renderKey].views[view].front) {
      for (const cell of cells(part.runs)) {
        const [x, y] = cell.split(',').map(Number);
        assert.ok(!boxes.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height),
          `${item.id}@${view}: foreground occupies facial cell ${cell}`);
      }
    }
  }
});

test('each view has two separately attached boots aligned to its real foot cells', () => {
  for (const view of VIEWS) {
    const parts = DANGO_APPEARANCE.boots.views[view].front;
    assert.deepEqual(parts.map(p => p.attachment), ['foot-left', 'foot-right']);
    for (const part of parts) {
      const shoe = cells(part.runs), foot = gridCells(PART_GRIDS[view][part.attachment]);
      assert.ok(touches(shoe, foot), `${view}:${part.attachment}`);
      assert.ok([...shoe].some(cell => foot.has(cell)), 'boots overlap the actual feet rather than hover below them');
    }
    const ctx = recorder(), matrices = { 'foot-left': [1, 0, 0, 1, -2, -3], 'foot-right': [1, 0, 0, 1, 2, -1] };
    APPEARANCE_SPRITES.boots(ctx, { outline: '#101010', ...APPEARANCE_COLORS.boots }, { view, part: 'front', footwearTransforms: matrices });
    assert.deepEqual(ctx.calls.filter(call => call[0] === 'matrix'), Object.values(matrices).map(matrix => ['matrix', ...matrix]));
  }
});

test('all ten palette skins render the full wardrobe with unchanged IDs, slots and level projection', () => {
  assert.equal(Object.keys(PALETTES).length, 10);
  assert.equal(new Set(ITEMS.map(item => item.exclusiveGroup)).size, 7);
  for (const [skin, palette] of Object.entries(PALETTES)) for (const item of ITEMS) for (const view of VIEWS) {
    const projection = projectAppearance({ skin, level: 30, view, itemIds: [item.id], includeLocked: true });
    // This suite renders the retained historical pixel source. The live
    // catalog also declares native-only parts, such as the curved front brim.
    for (const layer of ['back', 'front'].filter(layer => DANGO_APPEARANCE[item.renderKey].views[view][layer].length)) {
      const ctx = recorder();
      drawAppearanceLayer(ctx, projection, palette, { layer, calmVisual: true, elapsedMs: 700 });
      const marks = ctx.calls.filter(call => call[0] === 'rect');
      assert.ok(marks.length, `${skin}/${item.id}/${view}/${layer}: historical authored part is painted`);
      assert.ok(marks.every(call => /^#[0-9a-f]{6}$/i.test(call[5])), `${skin}/${item.id}: all roles resolve to colors`);
    }
  }
});


test('effect anchors follow the authored view and remain held in low-stimulation mode', () => {
  for (const item of ITEMS.filter(item => item.effect)) for (const view of VIEWS) {
    const appearance = projectAppearance({ skin: item.skin || 'pink', itemIds: [item.id], view, includeLocked: true });
    const render = elapsedMs => {
      const ctx = recorder();
      drawAppearanceLayer(ctx, appearance, PALETTES.pink, { layer: item.layer, calmVisual: true, elapsedMs });
      return ctx.calls;
    };
    assert.deepEqual(render(0), render(1250), `${item.id}@${view}: calm illustration cannot advance`);
  }
});

test('thin halo preserves its open center and clears every hat while reserving jump headroom', () => {
  const hats = ITEMS.filter(item => item.exclusiveGroup === 'headwear');
  for (const view of VIEWS) {
    const runs = DANGO_APPEARANCE.halo.views[view].front.flatMap(part => part.runs);
    const top = Math.min(...runs.map(run => run[1])) - HEAD_LIFT;
    const bottom = Math.max(...runs.map(run => run[1] + 2)) - HEAD_LIFT;
    assert.equal(top, -24, `${view}: halo leaves sixteen art units of top stage margin`);
    assert.equal(bottom, -18);
    const middle = runs.filter(run => run[1] === -6);
    const left = Math.min(...middle.map(run => run[0]));
    const right = Math.max(...middle.map(run => run[0] + run[2]));
    const center = (left + right) / 2;
    assert.ok(middle.every(([x, , width]) => center < x || center >= x + width),
      `${view}: halo must remain a ring rather than a filled gold bar`);
    for (const hat of hats) {
      const layers = DANGO_APPEARANCE[hat.renderKey].views[view];
      const hatTop = Math.min(...[...layers.back, ...layers.front].flatMap(part => part.runs).map(run => run[1]));
      assert.ok(hatTop - bottom >= 2, `${hat.id}/${view}: at least two art units above the real hat pixels`);
    }
  }
});
