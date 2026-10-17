import {test} from 'node:test';import assert from 'node:assert/strict';import {sample,normal} from '../src/isolated-lifecycle.mjs';
test('rest and bounded normal states',()=>{for(let i=0;i<=900;i++){const s=sample(i/100);for(const k of ['handEntry','lift','cupScale','cupOpacity'])assert(s[k]>=0&&s[k]<=1);}assert.equal(sample(0).handEntry,0);assert.equal(sample(9).handEntry,0);assert.equal(sample(9).cupScale,0);});
test('all normal boundaries continuous',()=>{for(const t of [1.2,1.5,2,3.4,4.8,6.2,6.6,6.9,8.1])for(const k of ['handEntry','lift','cupScale'])assert(Math.abs(normal(t-1e-6)[k]-normal(t+1e-6)[k])<1e-5);});
test('cancel never teleports and removes cup before moving hands',()=>{for(const c of [.1,.6,1.3,1.8,2.8,4,5.5,6.75,7.5]){const start=normal(c),at=sample(c,{cancelAt:c});for(const k of ['handEntry','lift','cupScale'])assert.equal(start[k],at[k]);if(start.cupScale>0){const h=sample(c+.09,{cancelAt:c});assert.equal(h.handEntry,start.handEntry);assert.equal(h.lift,start.lift);}const end=sample(c+1.2,{cancelAt:c});assert(end.done);assert.equal(end.handEntry,0);assert.equal(end.cupScale,0);}});

test('reduced motion suppresses scene without residual prop',()=>{for(const t of [0,1,3,5,9]){const s=sample(t,{reducedMotion:true});assert.equal(s.cupScale,0);assert.equal(s.handEntry,0);assert.equal(s.faceRequestAt,null);assert(s.done);}});

test('late cancel preserves already completed normal face release',()=>{assert.equal(sample(7.5,{cancelAt:7.5}).faceReleaseAt,7.2);assert.equal(sample(8.5,{cancelAt:8.5}).faceReleaseAt,7.2);});
