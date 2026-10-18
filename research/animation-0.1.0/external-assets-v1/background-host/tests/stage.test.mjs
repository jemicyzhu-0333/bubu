import test from 'node:test';
import assert from 'node:assert/strict';
import {stageMetrics,createStageResizeHost} from '../src/stage-metrics.mjs';
import {calibration} from './fixtures.mjs';
for (const [width,height] of [[220,220],[440,440],[120,220],[500,150]]) {
  for (const dpr of [1,1.25,1.5,2,3]) test(`metrics ${width}x${height} DPR ${dpr}`,()=>{
    const m=stageMetrics({...calibration,width,height,dpr});
    assert.equal(m.bodyCssWidth,99);assert.equal(m.effectiveDPR,Math.min(dpr,2));
    assert.equal(m.backing.width,Math.round(width*Math.min(dpr,2)));
    assert.equal(m.actorCanvas.width,219);assert.equal(m.backgroundCanvas.width,220);
    assert.equal(m.actorCanvas.x-m.backgroundCanvas.x,2.5);
    assert.equal(m.actorCanvas.y-m.backgroundCanvas.y,5.5);
    assert.equal(m.hitRegion.width,105);
    const p=[.2,.7,-.1],back=m.unproject(m.project(p));
    p.forEach((v,i)=>assert.ok(Math.abs(v-back[i])<1e-12));
    assert.deepEqual(m.floor.normal,[0,1,0]);assert.equal(m.floor.anchor[1],0);
  });
}
test('explicit 2x preview only; arbitrary viewport never auto-fits actor',()=>{
  const m=stageMetrics({...calibration,width:440,height:440,previewScale:2,dpr:3,dprCap:1.5});
  assert.equal(m.bodyCssWidth,198);assert.equal(m.actorCanvas.width,438);assert.equal(m.effectiveDPR,1.5);
});
test('zero-size delays and invalid calibration rejects',()=>{
  for(const [width,height] of [[0,0],[0,220],[220,0]]) assert.equal(stageMetrics({...calibration,width,height}).status,'deferred');
  for(const input of [{dpr:0},{dprCap:Infinity},{projectedBodyWorldWidth:0},{floorY:NaN},{width:-1}]) assert.throws(()=>stageMetrics({...calibration,...input}));
});
test('resize commits backing/projection/hit as one bundle; failed swap retains previous; disposal idempotent',()=>{
  const released=[],swaps=[]; let fail=false;
  const host=createStageResizeHost({prepare:m=>({m,release:()=>released.push(m)}),atomicSwap:(b,m,g)=>{
    assert.equal(b.m,m);if(fail) throw Error('injected');swaps.push({m,g});}});
  assert.equal(host.resize({...calibration,width:0}).status,'deferred');assert.equal(swaps.length,0);
  const first=host.resize(calibration);fail=true;
  assert.throws(()=>host.resize({...calibration,dpr:2}));assert.equal(host.snapshot(),first.metrics);
  fail=false;const second=host.resize({...calibration,dpr:2});
  assert.equal(second.generation,2);assert.equal(second.metrics.backing.width,440);assert.equal(released.length,2);
  host.dispose();host.dispose();assert.equal(released.length,3);assert.throws(()=>host.resize(calibration));
});
test('body projected world width calibrates exactly to 99 CSS; safety rect does not promise geometry fit',()=>{
 const m=stageMetrics(calibration),r=m.camera.basis.right;
 const a=calibration.actorAnchor.map((v,i)=>v-r[i]*.6),b=calibration.actorAnchor.map((v,i)=>v+r[i]*.6);
 assert.ok(Math.abs(m.project(b)[0]-m.project(a)[0]-99)<1e-10);
 assert.deepEqual(m.safeRegion,{left:.5,top:2.5,right:219.5,bottom:220});
 assert.equal(m.camera.frustum.far,20);assert.equal(m.camera.frustum.near,.01);
});
test('caller input mutation cannot change already published projection',()=>{
 const actorAnchor=[0,.6,0],m=stageMetrics({...calibration,actorAnchor});
 const expected=m.project(m.actorAnchor),screen=[100,120,.1],world=m.unproject(screen);
 actorAnchor[0]=10;assert.deepEqual(m.project(m.actorAnchor),expected);assert.deepEqual(m.unproject(screen),world);
});
