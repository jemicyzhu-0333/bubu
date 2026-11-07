'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('capture Node gate follows package.json engines, not a separate hard-coded major', async () => {
  const { nodeSatisfiesEngine, MIN_NODE } = await import('../tools/pet-realtime-capture/node-engine.mjs');
  assert.deepEqual(MIN_NODE, [22, 12, 0]);
  assert.equal(nodeSatisfiesEngine(process.versions.node), true);
  for (const v of ['22.12.0', '22.23.3', '24.0.0']) assert.equal(nodeSatisfiesEngine(v), true, v);
  for (const v of ['22.11.9', '20.18.0']) assert.equal(nodeSatisfiesEngine(v), false, v);
});
