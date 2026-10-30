import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderPinMeasure} from './render-pin-witnesses.mjs';

test('rendered witnesses detect motion even when the physical support is unchanged', () => {
  const coarse = {positions:[0, 0, 0, 1, 0, 0]}, source = new Float32Array([0, 0, 0, 2, 0, 0]);
  const measure = createRenderPinMeasure(coarse, [0, 1], source);
  assert.equal(measure.witnesses.length, 1);
  assert.equal(measure.unmatched, 1);
  assert.equal(measure.measure(source), 0);
  const moved = source.slice(); moved[1] = 2e-5;
  assert(measure.measure(moved) > 1e-5);
  assert.deepEqual(coarse.positions, [0, 0, 0, 1, 0, 0]);
});

test('pin checks reject missing witnesses, incomplete or nonfinite render buffers', () => {
  const coarse = {positions:[0, 0, 0]}, source = new Float32Array([0, 0, 0]);
  const measure = createRenderPinMeasure(coarse, [0], source);
  assert.throws(() => measure.measure(new Float32Array([0, 0])), /Invalid pin output/);
  assert.throws(() => measure.measure(new Float32Array([0, NaN, 0])), /Invalid pin output/);
  assert.throws(() => createRenderPinMeasure(coarse, [0], [1, 0, 0]), /No matching/);
});
