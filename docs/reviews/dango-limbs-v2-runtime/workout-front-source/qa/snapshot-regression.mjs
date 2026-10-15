import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotDraws } from './snapshot-draws.mjs';

test('draw snapshots survive nested mutation, record reuse and capture-array clearing', () => {
  const capture = [{ id: 'hand-left', ctm: [1, 0, 0, 1, 40, 60],
    drawImageArgs: [-12, -1, 90, 81], imageSize: [720, 648], actualFinalStage: true, soleY: 124 }];
  const expected = structuredClone(capture);
  const first = snapshotDraws(capture);
  capture[0].ctm[5] = 999;
  capture[0].drawImageArgs[0] = 999;
  capture[0].imageSize[0] = 1;
  capture[0].soleY = 1063;
  capture[0].id = 'hand-right';
  capture.push({ ctm: [2, 0, 0, 2, 0, 0] });
  const second = snapshotDraws(capture);
  capture.length = 0;
  assert.deepEqual(first, expected);
  assert.equal(second[0].ctm[5], 999);
  assert.equal(second.length, 2);
  assert.notEqual(first[0].ctm, second[0].ctm);
  assert.throws(() => { first[0].ctm[5] = -1; }, TypeError);
  assert.throws(() => { first[0].drawImageArgs[0] = -1; }, TypeError);
  assert.throws(() => first.push({}), TypeError);
});
