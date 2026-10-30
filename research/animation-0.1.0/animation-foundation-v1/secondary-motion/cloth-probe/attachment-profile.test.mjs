import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveCapeAttachment} from './attachment-profile.mjs';
const bytes=fs.readFileSync(new URL('./cape-coarse.json',import.meta.url));

test('private attachment repair retains immutable failed baselines and changes only support ownership',()=>{
  const before=Buffer.from(bytes),original=resolveCapeAttachment(bytes,'original-65-v1'),legacy=resolveCapeAttachment(bytes,'legacy-local-55-v1'),repaired=resolveCapeAttachment(bytes);
  assert.equal(original.pins.length,65);assert.equal(legacy.pins.length,55);assert.equal(repaired.pins.length,51);
  assert.deepEqual(original.pins,JSON.parse(bytes).pins);
  assert.deepEqual(repaired.releasedPins,[6,9,13,17,22,28,34,403,410,416,422,427,431,435]);
  assert.deepEqual(legacy.pins.filter(p=>repaired.releasedPins.includes(p)),[22,28,34,403,410,416]);
  assert(repaired.pins.includes(3)&&repaired.pins.includes(438),'Do not release safe supports just because the older candidate did');
  assert.equal(repaired.productionAccepted,false);assert.throws(()=>repaired.pins.pop(),TypeError);
  assert.deepEqual(bytes,before);
});

test('attachment identity rejects changed coarse geometry and unknown versions',()=>{
  const changed=JSON.parse(bytes);changed.positions[0]+=.001;
  assert.throws(()=>resolveCapeAttachment(Buffer.from(JSON.stringify(changed))),/identity changed/);
  assert.throws(()=>resolveCapeAttachment(bytes,'unknown'),/Unknown/);
  assert.throws(()=>resolveCapeAttachment(bytes,'__proto__'),/Unknown/);
});
