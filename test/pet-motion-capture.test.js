'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveLifecycleSuite,LIFECYCLE_SUITES}=require('../tools/pet-motion-craft/lifecycle-suites.mjs');
test('replay suites are explicit, bounded and preserve the original 24-case base',()=>{
  assert.deepEqual(Object.keys(LIFECYCLE_SUITES),['base','full-tea','tea-boundaries']);
  const base=resolveLifecycleSuite();assert.equal(base.cases.length*base.dressed.length*2,24);assert.equal(base.replacementHoldMs,500);
  assert.throws(()=>resolveLifecycleSuite('__proto__'),/Unknown/);assert.throws(()=>resolveLifecycleSuite('all'),/Unknown/);
  assert.ok(Object.isFrozen(base)&&Object.isFrozen(base.cases)&&Object.isFrozen(base.cases[0]));
});
test('committed full-tea replay includes both dressed forms, full business duration and idle',()=>{
  const s=resolveLifecycleSuite('full-tea');assert.deepEqual(s.dressed,[true]);assert.equal(s.replacementHoldMs,9000);
  assert.equal(s.cases[0].end-(600+s.cases[0].cut+s.replacementHoldMs),1000);
});
test('committed boundary replay interrupts recovery before expiry without changing the runtime deadline',()=>{
  const s=resolveLifecycleSuite('tea-boundaries');assert.equal(s.cases.length*2,4);assert.deepEqual(s.cases.map(c=>c.force),['drag','wave']);
  for(const c of s.cases){assert.equal(600+c.cut+s.replacementHoldMs,15100);assert.equal(c.forceAt,14900);assert.ok(c.end>15100&&c.end<=18000);}
});
