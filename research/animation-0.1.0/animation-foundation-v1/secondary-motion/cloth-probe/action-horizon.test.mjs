import test from 'node:test';
import assert from 'node:assert/strict';
import {clothActionHorizon} from './action-horizon.mjs';
import {sample} from '../../../original-parts-hybrid-v1/tea/src/timeline.mjs';
test('complete cancellation horizons include the actual tail at every action phase and sample rate',()=>{
  for(const sampleHz of [60,120,240])for(const cancelAt of [null,0,.2,.5,1.35,2.7,4.1,5.5,6.75,7.5,8.6,9]){
    const end=clothActionHorizon({cancelAt,sampleHz});
    assert(end.time>=9&&sample(end.time,{cancelAt}).done);
    if(end.time>9)assert.equal(sample((end.frames-1)/sampleHz,{cancelAt}).done,false,'No unnecessary tail beyond the first complete tick');
    if(cancelAt>=8.6)assert(end.time>9,'A late cancellation cannot be truncated at nine seconds');
  }
  for(const cancelAt of [-1,NaN,Infinity,9.1])assert.throws(()=>clothActionHorizon({cancelAt}));
});
