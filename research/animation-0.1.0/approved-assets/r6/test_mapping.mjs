import fs from 'node:fs';
import assert from 'node:assert/strict';
import { selectedFaceWeights } from './selected-face-map.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('./weight-fixtures.json',import.meta.url))).cases;
let maxError=0;
for (const c of cases) { const actual=selectedFaceWeights({[c.id]:c.intensity}); for(const [key,value] of Object.entries(c.weights))maxError=Math.max(maxError,Math.abs(actual[key]-value)); }
assert.equal(maxError,0);
assert.throws(()=>selectedFaceWeights({'01':.1,'04':.1}),RangeError);
for(const x of [-1,2,NaN,Infinity])assert.throws(()=>selectedFaceWeights({'07':x}),RangeError);
console.log(JSON.stringify({cases:cases.length,maxError,illegalMultiFaceRejected:true}));
