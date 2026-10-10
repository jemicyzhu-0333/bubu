'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { USAGI_FORM: form } = require('../src/content/companion/usagi-form.mjs');
const { projectAppearance } = require('../src/core/pet-appearance.mjs');
const { selectAppearance } = require('../src/capabilities/companion/domain/appearance-selection');
const { defaultCompanionState, normalizeCompanionState } = require('../src/core/companion-state');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { createPathCache } = require('../src/capabilities/companion/presentation/rig/paint.mjs');
const { validateRig } = require('../src/capabilities/companion/presentation/rig/schema.mjs');
const { multiply, applyPoint, IDENTITY } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { MOTION_NAMES } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
const { default: document } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
const { default: support } = require('../src/capabilities/companion/presentation/usagi-support.mjs');
const { expressionAccent, statusEffect } = require('../src/capabilities/companion/presentation/usagi-accents.mjs');
const { sampleBodyMotion } = require('../src/capabilities/companion/presentation/usagi-body-motion.mjs');
const { USAGI_OUTFIT_SETS } = require('../src/content/companion/usagi-wardrobe.mjs');
const { USAGI_WARDROBE } = require('../assets/companion/usagi/wardrobe/usagi.wardrobe.mjs');
const { validateUsagiWardrobe } = require('../src/capabilities/companion/presentation/usagi-raster-wardrobe.mjs');

const items = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'usagi');
const rasterOnly = new Set(['usagi.garden-apron', 'usagi.garden-clogs', 'usagi.rain-satchel', 'usagi.moon-boots']);
const vectorItems = items.filter(item => !rasterOnly.has(item.id));
const views = ['front', 'three-quarter', 'profile', 'back'];
const rig = validateRig(document).rig;
const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });

// Record actual transformed Bezier samples, not untransformed control points.
// Stroke radii are included so a one-pixel outline cannot silently clip.
function recorder() {
  let matrix = [...IDENTITY], lineWidth = 1, path = [], current = [0, 0];
  const stack = [], marks = [], calls = [];
  const point = (x, y) => applyPoint(matrix, x, y);
  const recordCurve = (end, sample) => {
    const from = current;
    for (let index = 1; index <= 20; index += 1) path.push(sample(from, index / 20));
    current = end;
  };
  const ctx = {
    marks, calls,
    save() { stack.push({ matrix: [...matrix], lineWidth }); },
    restore() { ({ matrix, lineWidth } = stack.pop()); },
    transform(...next) { matrix = multiply(matrix, next); calls.push(['transform', ...next]); },
    translate(x, y) { matrix = multiply(matrix, [1, 0, 0, 1, x, y]); },
    scale(x, y) { matrix = multiply(matrix, [x, 0, 0, y, 0, 0]); },
    beginPath() { path = []; }, closePath() { if (path.length) path.push(path[0]); },
    moveTo(x, y) { current = point(x, y); path.push(current); },
    lineTo(x, y) { current = point(x, y); path.push(current); },
    quadraticCurveTo(x1, y1, x2, y2) {
      const a = point(x1, y1), end = point(x2, y2);
      recordCurve(end, (start, t) => [0, 1].map(i => (1 - t) ** 2 * start[i] + 2 * (1 - t) * t * a[i] + t * t * end[i]));
    },
    bezierCurveTo(x1, y1, x2, y2, x3, y3) {
      const a = point(x1, y1), b = point(x2, y2), end = point(x3, y3);
      recordCurve(end, (start, t) => [0, 1].map(i => (1 - t) ** 3 * start[i]
        + 3 * (1 - t) ** 2 * t * a[i] + 3 * (1 - t) * t * t * b[i] + t ** 3 * end[i]));
    },
    fill() { marks.push({ points: [...path], radius: 0 }); },
    stroke() { marks.push({ points: [...path], radius: lineWidth / 2 * Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])) }); },
    set lineWidth(value) { lineWidth = value; }
  };
  return ctx;
}

function bounds(mark) {
  return {
    left: Math.min(...mark.points.map(p => p[0])) - mark.radius,
    right: Math.max(...mark.points.map(p => p[0])) + mark.radius,
    top: Math.min(...mark.points.map(p => p[1])) - mark.radius,
    bottom: Math.max(...mark.points.map(p => p[1])) + mark.radius
  };
}

function paint(item, view, motion = 'idle', progress = 0, calmVisual = false) {
  const ctx = recorder();
  const artwork = artist.resolve(rig, { view, motion, progress, calmVisual });
  assert.equal(artist.appearance(ctx, { item, layer: 'front', form, view, artwork }), true, item.id);
  assert.ok(ctx.marks.length, `${item.id}@${view} paints`);
  return { ctx, artwork };
}

test('Usagi has twenty-seven distinct choices in seven independent ordered slots', () => {
  assert.equal(items.length, 27);
  assert.equal(new Set(items.map(item => item.label)).size, items.length);
  assert.equal(form.supportedSlots.length, 7);
  for (const item of items) {
    assert.deepEqual(item.views, views);
    assert.ok(form.supportedSlots.includes(item.exclusiveGroup));
    assert.ok(form.slotLabels[item.exclusiveGroup]);
  }
  for (const level of [3, 5, 8, 10, 12, 15, 20]) {
    assert.ok(items.some(item => item.unlockKind === 'level' && item.minLevel === level), `level ${level}`);
  }
});

test('three styling recipes use valid complementary slots and cover all seasonal alternatives', () => {
  const seasonal = ['garden-beret', 'daisy-clip', 'petal-collar', 'seed-pouch', 'rain-cape',
    'rain-boots', 'moon-beret', 'envelope-pouch', 'constellation', 'garden-apron', 'garden-clogs',
    'rain-satchel', 'moon-boots'].map(id => `usagi.${id}`);
  assert.equal(USAGI_OUTFIT_SETS.length, 3);
  const used = new Set();
  for (const look of USAGI_OUTFIT_SETS) {
    const selected = look.itemIds.map(id => items.find(item => item.id === id));
    assert.ok(selected.every(Boolean), look.id);
    assert.equal(new Set(selected.map(item => item.exclusiveGroup)).size, selected.length, look.id);
    for (const slot of ['usagi.backwear', 'usagi.sidebag', 'usagi.footwear']) {
      assert.ok(selected.some(item => item.exclusiveGroup === slot), `${look.id} completes ${slot}`);
    }
    for (const item of selected) used.add(item.id);
    for (const view of views) {
      const projection = projectAppearance({ skin: 'usagi', formId: 'usagi', level: 25, view, itemIds: look.itemIds });
      assert.equal(projection.items.length, selected.length, `${look.id}@${view} loses no item`);
      const cape = projection.items.find(item => item.exclusiveGroup === 'usagi.backwear');
      const bag = projection.items.find(item => item.exclusiveGroup === 'usagi.sidebag');
      const neck = projection.items.find(item => item.exclusiveGroup === 'usagi.neckwear');
      if (cape && bag) assert.ok(cape.z < bag.z, 'pouch stays visible in front of cape');
      if (cape && neck) assert.ok(cape.z < neck.z, 'collar lies over the shoulder seam');
    }
  }
  assert.ok(seasonal.every(id => used.has(id)));
});

test('new alternatives never replace the original automatic choices at any level', () => {
  const original = items.slice(0, 12);
  for (let level = 1; level <= 50; level += 1) {
    const options = { skin: 'usagi', formId: 'usagi', level };
    assert.deepEqual(projectAppearance(options).items.map(item => item.id),
      projectAppearance({ ...options, items: original }).items.map(item => item.id));
  }
});

test('new alternatives use the existing equipment command shape and survive normalization', () => {
  for (const item of items.slice(12)) {
    const saved = defaultCompanionState();
    saved.appearance.equipped = { [item.exclusiveGroup]: item.id, 'usagi.earwear': null };
    // Also check the ear option itself rather than replacing it with the null fixture.
    saved.appearance.equipped[item.exclusiveGroup] = item.id;
    const normalized = normalizeCompanionState(saved);
    assert.deepEqual(normalized.appearance.equipped, saved.appearance.equipped);
    const selection = selectAppearance({ items: PET_APPEARANCE_ITEMS, level: item.minLevel,
      currentSkin: 'usagi', unlockedSkins: [], equipped: normalized.appearance.equipped });
    assert.ok(selection.worn.some(choice => choice.id === item.id), item.id);
    if (item.minLevel > 1) {
      const locked = selectAppearance({ items: PET_APPEARANCE_ITEMS, level: item.minLevel - 1,
        currentSkin: 'usagi', unlockedSkins: [], equipped: normalized.appearance.equipped });
      assert.ok(!locked.worn.some(choice => choice.id === item.id), `${item.id} remains level-gated`);
    }
  }
});

test('level growth never removes Usagi defaults and explicit old choices survive form switches', () => {
  const original = ['usagi.ear-bow', 'usagi.star-collar', 'usagi.travel-cape'];
  const equipped = { headwear: 'skin.crown', 'usagi.earwear': null, 'usagi.neckwear': 'usagi.star-collar',
    'usagi.backwear': 'usagi.travel-cape', 'usagi.sidebag': 'usagi.carrot-satchel' };
  const before = structuredClone(equipped);
  for (let level = 1; level <= 25; level += 1) {
    const auto = projectAppearance({ skin: 'usagi', formId: 'usagi', level }).items.map(item => item.id);
    for (const id of original) assert.ok(auto.includes(id), `${id} remains at ${level}`);
  }
  for (const currentSkin of ['usagi', 'pink', 'usagi']) {
    const selected = selectAppearance({ items: PET_APPEARANCE_ITEMS, level: 20,
      currentSkin, unlockedSkins: ['pink', 'crown'], equipped });
    if (currentSkin === 'usagi') {
      assert.ok(!selected.worn.some(item => item.exclusiveGroup === 'usagi.earwear'));
      assert.ok(selected.worn.some(item => item.id === 'usagi.carrot-satchel'));
    } else assert.ok(selected.worn.some(item => item.id === 'skin.crown'));
  }
  assert.deepEqual(equipped, before);
  const saved = defaultCompanionState();
  saved.appearance.equipped = equipped;
  assert.deepEqual(normalizeCompanionState(saved).appearance.equipped, before, 'no new persisted shape is needed');
});

test('every wardrobe choice has an authored raster or vector renderer and a rig-owned anchor', () => {
  validateUsagiWardrobe(USAGI_WARDROBE);
  for (const item of items) for (const view of views) {
    assert.ok(rig.views[view].anchors[item.exclusiveGroup]);
    assert.ok(vectorItems.includes(item) || USAGI_WARDROBE.appearance[item.renderKey]?.views[view], `${item.id}@${view}`);
  }
});

test('retained vector rollback garments stay inside their declared rest bleed', () => {
  for (const view of views) for (const item of vectorItems) {
    assert.ok(rig.views[view].anchors[item.exclusiveGroup], `${item.id}@${view}: rig anchor`);
    const { ctx } = paint(item, view);
    for (const mark of ctx.marks) {
      const box = bounds(mark);
      assert.ok(box.left >= -item.bleed.left && box.right <= 66 + item.bleed.right
        && box.top >= -item.bleed.top && box.bottom <= 66 + item.bleed.bottom,
      `${item.id}@${view}: declared bleed ${JSON.stringify(box)}`);
    }
  }
});

test('hat and ear-clasp pairs retain separation or explicit near-ear profile occlusion', () => {
  const hats = vectorItems.filter(item => item.exclusiveGroup === 'usagi.headwear');
  const clips = vectorItems.filter(item => item.exclusiveGroup === 'usagi.earwear');
  const extent = (item, view) => {
    const boxes = paint(item, view).ctx.marks.map(bounds);
    return { left: Math.min(...boxes.map(box => box.left)), right: Math.max(...boxes.map(box => box.right)),
      top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)) };
  };
  for (const view of views) for (const hat of hats) for (const clip of clips) {
    if (view === 'profile') {
      // A skull-seated profile hat can meet the near ear ornament. Preserve
      // its real ear attachment and later slot; visible pixels are tested below.
      const plan = projectAppearance({ skin: 'usagi', formId: 'usagi', level: 25, view,
        itemIds: [hat.id, clip.id] });
      assert.deepEqual(plan.items.map(item => item.id), [hat.id, clip.id]);
      assert.match(rig.views[view].anchors[clip.exclusiveGroup].bone, /^ear_/);
      continue;
    }
    const head = extent(hat, view), ear = extent(clip, view);
    assert.ok(head.right < ear.left || ear.right < head.left || head.bottom < ear.top || ear.bottom < head.top,
      `${hat.id} + ${clip.id}@${view} keep the headwear and earwear spaces separate ${JSON.stringify({head,ear})}`);
  }
});

test('every profile rollback hat/clasp pair preserves the complete opaque near-ear glyph',
  { skip: !process.env.USAGI_CANVAS_PACKAGE }, () => {
    const { createCanvas, Path2D } = require(process.env.USAGI_CANVAS_PACKAGE);
    const painter = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => new Path2D(d) }) });
    const view = 'profile', artwork = painter.resolve(rig, { view, motion: 'idle', progress: 0 });
    const render = selected => {
      const surface = createCanvas(360, 360), context = surface.getContext('2d');
      context.translate(90, 110); context.scale(3, 3);
      for (const item of selected) painter.appearance(context, { item, layer: 'front', form, view, artwork });
      return context.getImageData(0, 0, 360, 360).data;
    };
    const hats = vectorItems.filter(item => item.exclusiveGroup === 'usagi.headwear');
    const clips = vectorItems.filter(item => item.exclusiveGroup === 'usagi.earwear');
    let verified = 0, reversedOrderLoss = 0;
    for (const hat of hats) for (const clip of clips) {
      const plan = projectAppearance({ skin: 'usagi', formId: 'usagi', level: 25, view,
        itemIds: [hat.id, clip.id] });
      const alone = render([clip]), combined = render(plan.items), reversed = render([...plan.items].reverse());
      let opaque = 0;
      for (let i = 0; i < alone.length; i += 4) if (alone[i + 3] === 255) {
        opaque += 1;
        assert.deepEqual([...combined.subarray(i, i + 4)], [...alone.subarray(i, i + 4)],
          `${hat.id}/${clip.id}: near-ear knot, lobes and outline remain visible`);
        if (reversed[i] !== alone[i] || reversed[i + 1] !== alone[i + 1] || reversed[i + 2] !== alone[i + 2]) reversedOrderLoss += 1;
      }
      assert.ok(opaque > 20, `${clip.id}: nonempty authored glyph`);
      verified += 1;
    }
    assert.equal(verified, hats.length * clips.length);
    assert.ok(reversedOrderLoss > 0, 'negative control detects an incorrectly overpainted ear clasp');
  });

test('vector rollback garments stay on stage and outside the face in every motion/view', () => {
  for (const view of views) for (const motion of MOTION_NAMES) for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const body = sampleBodyMotion(motion, progress);
    const a = Math.cos(body.r) * body.sx, b = Math.sin(body.r) * body.sx;
    const c = -Math.sin(body.r) * body.sy, d = Math.cos(body.r) * body.sy;
    const transform = [a, b, c, d, 33 - 33 * a - 33 * c, 33 - 33 * b - 33 * d];
    for (const item of vectorItems) {
      const { ctx } = paint(item, view, motion, progress);
      for (const mark of ctx.marks) {
        const box = bounds(mark);
        assert.ok(box.left >= -40 && box.right <= 106 && box.top >= -40 && box.bottom <= 106,
          `${item.id}@${view}/${motion}/${progress} stays in stage`);
        const wholeBody = bounds({ points: mark.points.map(([x, y]) => applyPoint(transform, x + body.x, y + body.y)),
          radius: mark.radius * Math.max(body.sx, body.sy) });
        assert.ok(wholeBody.left >= -40 && wholeBody.right <= 106 && wholeBody.top >= -40 && wholeBody.bottom <= 106,
          `${item.id}@${view}/${motion}/${progress} includes the whole-body transform`);
        if (view !== 'back') {
          // The whole face band is stricter than separate eye/cheek/mouth masks.
          assert.ok(box.bottom < 17 || box.top > 42 || box.right < 0 || box.left > 66,
            `${item.id}@${view}/${motion}/${progress} never crosses the face band: ${JSON.stringify(box)}`);
        }
      }
    }
  }
});

test('both vector rollback footwear styles retain separate moving ankle attachments', () => {
  for (const item of vectorItems.filter(item => item.exclusiveGroup === 'usagi.footwear')) for (const view of views) {
    const { ctx, artwork } = paint(item, view, 'hop', 0.25);
    const anchors = rig.views[view].anchors;
    assert.equal(anchors['usagi.footwear'].bone, 'leg_l');
    assert.equal(anchors['usagi.footwear-r'].bone, 'leg_r');
    const transforms = ctx.calls.filter(([kind]) => kind === 'transform').map(call => call.slice(1));
    assert.deepEqual(transforms[0], artwork.pose.world.leg_l);
    const combined = multiply(transforms[0], transforms[1]);
    artwork.pose.world.leg_r.forEach((value, index) => assert.ok(Math.abs(combined[index] - value) < 1e-9));
    assert.equal(ctx.marks.length, item.id === 'usagi.soft-boots' ? 8 : 12,
      'both distinct boot outlines and their small material details are drawn');
  }
});

test('all expression accents and statuses are semantic, animated, bounded and held when calm', () => {
  for (const view of views) for (const key of ['sleep-zzz', 'drowsy-zzz', 'hungry', 'coffee']) {
    const draw = key.endsWith('zzz') ? expressionAccent : statusEffect;
    const render = (elapsedMs, calmVisual) => {
      const ctx = recorder();
      assert.ok(draw(ctx, key, { elapsedMs, calmVisual, view }));
      for (const mark of ctx.marks) {
        const box = bounds(mark);
        assert.ok(box.left >= -40 && box.right <= 106 && box.top >= -40 && box.bottom <= 106);
        assert.ok(box.bottom < 17 || box.left > 64, `${key} leaves the face clear`);
      }
      return ctx.marks;
    };
    assert.notDeepEqual(render(0, false), render(550, false), `${key} animates`);
    assert.deepEqual(render(0, true), render(550, true), `${key} is held when calm`);
  }
  const ctx = recorder();
  assert.equal(expressionAccent(ctx, 'none'), 0);
  assert.equal(expressionAccent(ctx, 'unknown'), 0);
  assert.equal(statusEffect(ctx, 'unknown'), false);
  assert.deepEqual(ctx.marks, []);
});
