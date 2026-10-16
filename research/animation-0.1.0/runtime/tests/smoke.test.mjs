import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preparePack
}
from '../src/pack-loader.mjs';
import {
  localPackReader
}
from '../tools/read-local-pack.mjs';
import {
  ResourceCache
}
from '../src/resource-cache.mjs';
import {
  createSuite
}
from '../src/suite.mjs';
const read=localPackReader(new URL('../fixtures/', import.meta.url).pathname);
test('actual GLB -> profile -> timeline -> face -> accessory -> release lifecycle', async()=> {
  const pack=await preparePack(read), cache=new ResourceCache(), suite=await createSuite(pack, cache);
  assert.equal(pack.budget.vertices, 148);
  suite.enqueue({
    time:0, type:'play', segment:'raise'
  });
  suite.advance(.1);
  assert(suite.face.value>0);
  assert(suite.lanes.get('joint:arm.left').value[2]>0);
  assert(suite.lanes.get('accessory:testCap').value[2]>0);
  suite.enqueue({
    time:.1, type:'play', segment:'turn'
  });
  const before=Array.from(suite.lanes.get('joint:arm.left').value), face=suite.face.value;
  suite.advance(.1);
  assert.deepEqual(Array.from(suite.lanes.get('joint:arm.left').value), before);
  assert.equal(suite.face.value, face);
  suite.advance(.18);
  assert.equal(suite.face.value, 0);
  suite.advance(.3);
  assert.equal(suite.face.path, 'fixture.B');
  suite.enqueue({
    time:.3, type:'cancel'
  });
  suite.advance(.5);
  assert.equal(suite.face.value, 0);
  assert(!suite.isAnimating(.5));
  suite.dispose();
  suite.dispose();
  assert.equal(cache.stats.live, 0);
  assert.equal(cache.retainedReferences, 0);
  assert.equal(cache.stats.disposals, 2);
});
