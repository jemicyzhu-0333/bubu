'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { sampleActionContact } = require('../src/core/pet-action-contact.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { pathToFileURL } = require('node:url');

test('raster build-blocks seats the cube on the support pixels then withdraws its paw', async t => {
  const packagePath = process.env.USAGI_CANVAS_PACKAGE;
  if (!packagePath) return t.skip('Pass the existing USAGI_CANVAS_PACKAGE for actual alpha contact');
  const { createCanvas, loadImage } = createRequire(__filename)(packagePath);
  const sprite = DANGO_RASTER.tools.block;
  const image = await loadImage(path.resolve('assets/companion/dango/raster', sprite.src));
  const options = { soft: true, toolSprites: DANGO_RASTER.tools };
  for (const view of ['front', 'three-quarter']) {
    const before = sampleActionContact(PET_ACTIONS['build-blocks'], .2, view, options);
    const settled = sampleActionContact(PET_ACTIONS['build-blocks'], .6, view, options);
    const masks = settled.tools.map(tool => {
      const surface = createCanvas(400, 400), context = surface.getContext('2d');
      context.drawImage(image, tool.x * 4, tool.y * 4, 48, 48);
      return context.getImageData(0, 0, 400, 400).data;
    });
    let touching = 0, overlap = 0;
    for (let y = 1; y < 399; y++) for (let x = 1; x < 399; x++) {
      const at = (y * 400 + x) * 4 + 3;
      if (masks[2][at] < 16) continue;
      if (masks[0][at] >= 16 || masks[1][at] >= 16) overlap++;
      for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
        const near = ((y + dy) * 400 + x + dx) * 4 + 3;
        if (masks[0][near] >= 16 || masks[1][near] >= 16) touching++;
      }
    }
    assert.ok(touching > 0, `${view}: placed cube must reach its actual support pixels`);
    assert.ok(overlap < 80, `${view}: support contact must not bury the cube`);
    assert.ok(before.tools[2].y < settled.tools[2].y - 5, 'approach remains visible');
    const grip = settled.hands.find(hand => hand.side === 'right').points.at(-1);
    assert.deepEqual(grip, [settled.tools[2].x + sprite.anchors.right[0], settled.tools[2].y + sprite.anchors.right[1]]);
    const released = sampleActionContact(PET_ACTIONS['build-blocks'], .98, view, options);
    const paw = released.hands.find(hand => hand.side === 'right');
    assert.equal(paw.opacity, 0, 'finished stack has no paw stuck to its top');
    assert.deepEqual(paw.points.at(-1), paw.points[0], 'recovery goes back into the body');
    assert.deepEqual(released.tools, settled.tools, 'stack stays seated during release');
    const legacy = sampleActionContact(PET_ACTIONS['build-blocks'], .98, view);
    assert.equal(legacy.tools[2].y, 41, 'legacy geometry stays unchanged');
    assert.equal(legacy.hands[0].opacity, undefined, 'legacy visibility stays unchanged');
  }
});

test('carry, bubble wand and broom avoid both eyes through the actual renderer while grips stay attached', async t => {
  const packagePath = process.env.DANGO_CANVAS_PACKAGE || process.env.USAGI_CANVAS_PACKAGE;
  if (!packagePath) return t.skip('Pass the existing Canvas package for production eye/tool alpha contact');
  const backend = createRequire(__filename)(packagePath);
  const { installOffscreenImages } = await import('../tools/usagi-gallery/offscreen-images.mjs');
  installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  const { loadSource, createRenderHarness } = await import('../tools/usagi-gallery/runtime-harness.mjs');
  const source = await loadSource(pathToFileURL(path.resolve(__dirname, '..')).href);
  for (const [id, key] of [['carry-energy', 'energy'], ['bubble-blow', 'bubble-wand'], ['sweep', 'broom']]) {
    for (const view of ['front', 'three-quarter']) {
      const h = createRenderHarness(source, { skin: 'pink', outfit: false, view, dpr: 2, blink: false });
      const selected = h.select('action', id), context = h.body.getContext('2d');
      const eyeMask = backend.createCanvas(h.body.width, h.body.height), toolMask = backend.createCanvas(h.body.width, h.body.height);
      const original = context.drawImage;
      context.drawImage = function (image, ...rect) {
        const src = typeof image.src === 'string' ? image.src : '';
        const target = /\/eye[^/]*\.png/.test(src) ? eyeMask : src.includes(`/tools/${key}.png`) ? toolMask : null;
        if (target) {
          const c = target.getContext('2d'), m = this.getTransform();
          c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); c.globalAlpha = this.globalAlpha;
          c.imageSmoothingEnabled = this.imageSmoothingEnabled; c.drawImage(image, ...rect);
        }
        return original.call(this, image, ...rect);
      };
      try {
        for (let index = 0; index <= 120; index++) {
          for (const surface of [eyeMask, toolMask]) {
            const c = surface.getContext('2d'); c.resetTransform(); c.clearRect(0, 0, surface.width, surface.height);
          }
          const progress = index / 120; h.draw(progress * selected.duration);
          const eyes = eyeMask.getContext('2d').getImageData(0, 0, eyeMask.width, eyeMask.height).data;
          const prop = toolMask.getContext('2d').getImageData(0, 0, toolMask.width, toolMask.height).data;
          let overlap = 0, eyePixels = 0, toolPixels = 0;
          for (let i = 3; i < eyes.length; i += 4) {
            eyePixels += eyes[i] >= 16; toolPixels += prop[i] >= 16;
            overlap += eyes[i] >= 16 && prop[i] >= 16;
          }
          assert.ok(eyePixels > 0 && toolPixels > 30, `${id}/${view}/${progress}: actual eyes and equipment must render`);
          assert.equal(overlap, 0, `${id}/${view}/${progress}: unintended eye cover`);
          const data = DANGO_RASTER.views[view];
          const contact = sampleActionContact(PET_ACTIONS[id], progress, view, { soft: true, anchors: data.anchors,
            muzzle: { x: data.face.mouth.neutral.pivot[0], y: data.face.mouth.neutral.pivot[1] }, toolSprites: DANGO_RASTER.tools });
          const tool = contact.tools.find(value => value.key === key), sprite = DANGO_RASTER.tools[key];
          for (const hand of contact.hands.filter(value => key !== 'broom' || value.side === 'right')) {
            const grip = sprite.anchors[hand.side];
            assert.deepEqual(hand.points.at(-1), [tool.x + grip[0], tool.y + grip[1]]);
          }
          assert.ok(tool.x >= -40 && tool.x + sprite.rect[2] <= 106 && tool.y >= -40 && tool.y + sprite.rect[3] <= 106);
        }
      } finally {
        context.drawImage = original; h.dispose(); eyeMask.width = 1; toolMask.width = 1;
      }
    }
  }
  assert.equal(sampleActionContact(PET_ACTIONS['carry-energy'], .5, 'front', { soft: true }).tools[0].x, 21);
});

test('back tail remains visible and attached in actual composite pixels without changing front/angled tool poses', async t => {
  const packagePath = process.env.DANGO_CANVAS_PACKAGE || process.env.USAGI_CANVAS_PACKAGE;
  if (!packagePath) return t.skip('Pass the existing Canvas package for actual tail visibility');
  const backend = createRequire(__filename)(packagePath);
  const { installOffscreenImages } = await import('../tools/usagi-gallery/offscreen-images.mjs');
  installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  const { loadSource, createRenderHarness } = await import('../tools/usagi-gallery/runtime-harness.mjs');
  const { sampleFreeVectorAction } = await import('../src/core/pet-action-vector-poses.mjs');
  const source = await loadSource(pathToFileURL(path.resolve(__dirname, '..')).href);
  const action = PET_ACTIONS['tail-wiggle'];
  for (const view of ['front', 'three-quarter']) for (const progress of [.1, .3, .5, .7, .9]) {
    const anchors = DANGO_RASTER.views[view].anchors;
    assert.deepEqual(sampleFreeVectorAction(action, progress, view, anchors, { toolSprites: DANGO_RASTER.tools }),
      sampleFreeVectorAction(action, progress, view, anchors), `${view} preserved`);
  }
  const h = createRenderHarness(source, { skin: 'pink', outfit: false, view: 'back', dpr: 2, blink: false });
  const selected = h.select('action', action.id), context = h.body.getContext('2d'), original = context.drawImage;
  const mask = backend.createCanvas(h.body.width, h.body.height);
  try {
    for (let index = 0; index <= 24; index++) {
      const at = index / 25 * selected.duration, mc = mask.getContext('2d');
      mc.resetTransform(); mc.clearRect(0, 0, mask.width, mask.height);
      context.drawImage = function (image, ...rect) {
        if (typeof image.src === 'string' && image.src.includes('/tools/tail.png')) {
          const m = this.getTransform(); mc.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); mc.drawImage(image, ...rect);
        }
        return original.call(this, image, ...rect);
      };
      h.draw(at); const withTail = context.getImageData(0, 0, h.body.width, h.body.height).data;
      context.drawImage = function (image, ...rect) {
        if (typeof image.src === 'string' && image.src.includes('/tools/tail.png')) return;
        return original.call(this, image, ...rect);
      };
      h.draw(at); const withoutTail = context.getImageData(0, 0, h.body.width, h.body.height).data;
      const tail = mc.getImageData(0, 0, mask.width, mask.height).data;
      let visible = 0, attached = 0;
      for (let i = 0; i < tail.length; i += 4) {
        if (tail[i + 3] < 16) continue;
        attached += withoutTail[i + 3] >= 16;
        if ([0, 1, 2, 3].some(c => Math.abs(withTail[i + c] - withoutTail[i + c]) > 16)) visible++;
      }
      assert.ok(visible > 30, `tail visible pixels ${visible} at ${at}`);
      assert.ok(attached > 30, `tail must overlap its body root (${attached}) at ${at}`);
    }
  } finally { context.drawImage = original; h.dispose(); mask.width = 1; }
});
