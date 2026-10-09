'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileDangoSvg, emitDangoModule, rasterizePaths } = require('../tools/dango-build/build.mjs');
const { BODY_GRIDS, PART_GRIDS, BODY_ANCHORS, VIEW_LAYOUTS } = require('../src/content/companion/dango-body.mjs');
const petArt = require('../src/core/pet-art.mjs');
const face = require('../src/core/pet-face.mjs');
const source = fs.readFileSync(path.join(__dirname, '../assets/companion/dango/dango.body.svg'), 'utf8');

function connectedComponents(grid) {
  const seen = new Set(); let count = 0;
  for (let y = 0; y < 33; y += 1) for (let x = 0; x < 33; x += 1) {
    if (grid[y][x] === '.' || seen.has(`${x},${y}`)) continue;
    count += 1; const queue = [[x, y]];
    while (queue.length) {
      const [px, py] = queue.pop(), key = `${px},${py}`;
      if (seen.has(key) || !grid[py]?.[px] || grid[py][px] === '.') continue;
      seen.add(key);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) queue.push([px + dx, py + dy]);
    }
  }
  return count;
}

test('editable dango SVG compiles byte-for-byte to the committed grid and anchor module', () => {
  const compiled = compileDangoSvg(source);
  assert.deepEqual(compiled.grids, BODY_GRIDS);
  assert.deepEqual(compiled.layouts, VIEW_LAYOUTS);
  assert.deepEqual(compiled.parts, PART_GRIDS);
  assert.deepEqual(compiled.anchors, BODY_ANCHORS);
  assert.equal(emitDangoModule(compiled), fs.readFileSync(path.join(__dirname, '../src/content/companion/dango-body.mjs'), 'utf8'));
  assert.deepEqual(compileDangoSvg(source), compileDangoSvg(source), 'DPR, wall clock and randomness never enter compilation');
});

test('separate feet and torso compose exactly to each four-view body grid', () => {
  for (const [view, grid] of Object.entries(BODY_GRIDS)) {
    assert.equal(connectedComponents(grid), 1, `${view} silhouette must stay connected`);
    const parts = PART_GRIDS[view];
    assert.deepEqual(Object.keys(parts), ['foot-left', 'foot-right', 'torso']);
    for (let y = 0; y < 33; y += 1) for (let x = 0; x < 33; x += 1) {
      const glyph = Object.values(parts).reduce((prior, part) => part[y][x] === '.' ? prior : part[y][x], '.');
      assert.equal(glyph, grid[y][x], `${view}/${x},${y}`);
    }
    for (const key of ['foot-left', 'foot-right']) {
      assert.equal(connectedComponents(parts[key]), 1, `${view}/${key} is a real connected foot`);
      const anchor = BODY_ANCHORS[view][key];
      assert.equal(anchor.y, 54);
      assert.ok(parts[key][anchor.y / 2][anchor.x / 2] !== '.', `${view}/${key} pivot is inside its authored art`);
    }
  }
});

test('source-authored face anchors stay inside real silhouettes and true profile shows one eye', () => {
  assert.equal(Object.keys(VIEW_LAYOUTS.profile.eyeAnchors).length, 1);
  assert.equal(Object.keys(VIEW_LAYOUTS.back.eyeAnchors).length, 0);
  for (const view of ['front', 'three-quarter', 'profile']) {
    const { eyeAnchors, mouthAnchor } = VIEW_LAYOUTS[view];
    const boxes = [...Object.values(eyeAnchors).map(anchor => [anchor, face.EYE_GRID_WIDTH, face.EYE_GRID_HEIGHT]),
      [mouthAnchor, face.MOUTH_GRID_WIDTH, face.MOUTH_GRID_HEIGHT]];
    for (const [anchor, width, height] of boxes) for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      assert.ok(['2', '3'].includes(BODY_GRIDS[view][anchor.gridY + y][anchor.gridX + x]), `${view} face must be in fill, not on an outline`);
    }
  }
});

test('all ten skin palettes keep the same geometry and the back paints no artificial spine', () => {
  assert.equal(Object.keys(petArt.PALETTES).length, 10);
  for (const palette of Object.values(petArt.PALETTES)) {
    for (const key of [1, 2, 3, 4]) assert.match(palette[key], /^#[0-9a-f]{6}$/i);
  }
  const painted = [];
  petArt.drawBackDetails({ fillRect: (...args) => painted.push(args) }, petArt.PALETTES.pink);
  assert.deepEqual(painted, []);
  for (let y = 7; y < 23; y += 1) for (let x = 12; x < 21; x += 1) assert.equal(BODY_GRIDS.back[y][x], '2');
});

test('unsupported SVG features fail closed instead of silently changing the compiled artwork', () => {
  assert.throws(() => compileDangoSvg(source.replace('data-body-size="66"', 'data-body-size="64"')), /66 art/);
  assert.throws(() => compileDangoSvg(source.replace('data-part="torso"', 'data-part="torso" transform="scale(.5)"')), /untransformed/);
  assert.throws(() => compileDangoSvg(source.replace('fill="#f7768e"', 'fill="url(#gradient)"')), /palette color/);
  assert.throws(() => compileDangoSvg(source.replace('M6.5 25.5', 'M6.5 25.5 A4 4 0 0 0 12 28')), /unsupported path/);
});

test('the reusable prop rasterizer samples negative origins and ordered fills without anti-aliased colors', () => {
  const pixels = rasterizePaths([
    { d: 'M-2 -2 H2 V2 H-2Z', fill: '#123456' },
    { d: 'M0 0 H2 V2 H0Z', fill: '#abcdef' }
  ], { x: -2, y: -2, width: 4, height: 4 });
  assert.deepEqual(pixels[0], Array(4).fill('#123456'));
  assert.deepEqual(pixels[3], ['#123456', '#123456', '#abcdef', '#abcdef']);
  const outline = rasterizePaths([{ d: 'M.5 .5 H3.5', fill: 'none', stroke: 'ink', strokeWidth: .8 }], { width: 4, height: 2 });
  assert.deepEqual(outline, [Array(4).fill('ink'), Array(4).fill(null)]);
  assert.throws(() => rasterizePaths([], { width: 0 }), /bounds/);
  assert.throws(() => rasterizePaths([{ d: 'M0 0 H2', stroke: 'ink', strokeWidth: NaN }]), /stroke width/);
});
