import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterFixture, recordingContext } from '../test-support/dango-raster-fixture.mjs';
import { rasterFixture as reconstructionFixture, recordingContext as reconstructionContext } from '../test-support/dango-reconstruction-fixture.mjs';

for (const [name, create, paths] of [['raster', recordingContext, true], ['reconstruction', reconstructionContext, false]]) {
  test(`dango ${name} recorder preserves image operands, affine order and alpha stacks`, () => {
    const context = create();
    assert.equal(typeof context.arc, paths ? 'function' : 'undefined');
    assert.equal(typeof context.fill, paths ? 'function' : 'undefined');
    const image = { src: 'fixture.png' };
    context.translate(10, 20);
    context.scale(2, -3);
    context.transform(1, 2, 3, 4, 5, 6);
    context.globalAlpha = 0.25;
    context.fillStyle = 'red';
    context.save();
    context.translate(1, 2);
    context.globalAlpha = 0.5;
    context.save();
    context.rotate(Math.PI / 2);
    context.globalAlpha = 0.75;
    context.fillStyle = 'blue';
    context.drawImage(image, 0, 1, 2, 3, 4, 5, 6, 7);
    assert.equal(context.calls[0].image, image);
    assert.deepEqual(context.calls[0].rect, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(context.calls[0].alpha, 0.75);
    context.restore();
    context.drawImage(image, 1, 2);
    assert.deepEqual(context.calls[1], { image, rect: [1, 2], matrix: [2, -6, 6, -12, 34, -28], alpha: 0.5 });
    context.restore();
    context.drawImage(image, 1, 2, 3, 4);
    assert.deepEqual(context.calls[2], { image, rect: [1, 2, 3, 4], matrix: [2, -6, 6, -12, 20, 2], alpha: 0.25 });
    assert.equal(context.fillStyle, 'blue', 'raster stack restores alpha, not styles');
    context.translate(100, 100);
    assert.deepEqual(context.calls[2].matrix, [2, -6, 6, -12, 20, 2]);
    assert.throws(() => context.restore(), TypeError, 'empty raster restore still rejects an unbalanced stack');
  });
}

test('dango geometry profiles retain optional contact sprites, numbering and distinct effects', () => {
  const raster = rasterFixture();
  const reconstruction = reconstructionFixture();
  assert.deepEqual(raster.views, reconstruction.views);
  assert.equal(raster.views.back.face, null);
  assert.equal(raster.tools['small-fin'].rect[2], 8.4);
  assert.equal(raster.tools['support-paw'].rect[3], 10.415094339622641);
  assert.equal(Object.hasOwn(reconstruction.tools, 'small-fin'), false);
  assert.equal(Object.hasOwn(reconstruction.tools, 'support-paw'), false);
  for (const [name, sprite] of Object.entries(reconstruction.tools)) assert.deepEqual(raster.tools[name], sprite);
  const number = sprite => Number(/^fixture-(\d+)\.png$/.exec(sprite.src)[1]);
  for (const name of Object.keys(reconstruction.effects)) {
    assert.equal(number(raster.effects[name]), number(reconstruction.effects[name]) + 2);
    assert.deepEqual(raster.effects[name].rect, reconstruction.effects[name].rect);
  }
  assert.equal(number(raster.appearance.boots.views.front.front[0]), number(reconstruction.appearance.boots.views.front.front[0]) + 2);
  assert.deepEqual(rasterFixture(), raster, 'each fixture resets source IDs');
  assert.deepEqual(reconstructionFixture(), reconstruction, 'reconstruction also resets source IDs');
});
