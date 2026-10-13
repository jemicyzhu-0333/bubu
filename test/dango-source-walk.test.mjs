import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire}from 'node:module';
import test from 'node:test';import assert from 'node:assert/strict';
import {sampleDangoSourceWalk as walk,sampleDangoWalkEpisode as episode}from '../src/capabilities/companion/presentation/gait/dango-walk.mjs';
import {paintDangoWalkFeet as paint}from '../src/capabilities/companion/presentation/gait/paint-dango-walk.mjs';
import {DANGO_SOURCE_WALK as C}from '../src/content/companion/gait/dango-walk.mjs';
test('world-fixed stance, continuous roots, opaque two-foot motion, single/double support',()=>{
 let prev=null,maxStep=0;const counts=new Set;
 for(let i=0;i<=10000;i++){const s=walk(i/2000);counts.add(s.supportCount);assert.equal(s.feet.length,2);
  for(let j=0;j<2;j++){const f=s.feet[j];assert.ok(f.clearance>=-1e-9);assert.equal(f.opacity,1);assert.equal(f.source,C.foot.src);if(f.support)assert.deepEqual(f.soleWorld,f.contactTarget);if(prev)maxStep=Math.max(maxStep,...f.rootWorld.map((x,k)=>Math.abs(x-prev.feet[j].rootWorld[k])));}
  prev=s;
 }assert.deepEqual([...counts].sort(),[1,2]);assert.ok(maxStep<.05);
});
test('cycle repeats relative to one exact world stride',()=>{
 for(const q of[0,.123,.62,.83,.99999]){const a=walk(q),b=walk(q+1),d=b.bodyWorld[0]-a.bodyWorld[0];for(let i=0;i<2;i++)for(let k=0;k<2;k++)assert.ok(Math.abs(b.feet[i].rootWorld[k]-a.feet[i].rootWorld[k]-(k?0:d))<1e-10);assert.ok(Math.abs(a.bodyWorld[1]-b.bodyWorld[1])<1e-10);}
});
test('entry and exit are stationary full planted poses with continuous approach',()=>{
 for(const p of[0,1]){const s=episode(p);assert.equal(s.bodyWorld[1],0);assert.equal(s.supportCount,2);for(const f of s.feet)assert.deepEqual(f.rootWorld,[s.bodyWorld[0]+C.hips[f.side],C.groundY-7]);}
 for(const p of[1e-6,1-1e-6]){const a=episode(p<.5?0:1),b=episode(p);assert.ok(Math.abs(a.bodyWorld[0]-b.bodyWorld[0])<1e-8);for(let i=0;i<2;i++)assert.ok(Math.hypot(...a.feet[i].rootWorld.map((x,k)=>x-b.feet[i].rootWorld[k]))<1e-6);}
 for(let i=0;i<=5000;i++){const s=episode(i/5000);for(const f of s.feet){assert.ok(f.clearance>=-1e-9);if(f.support)assert.deepEqual(f.soleWorld,f.contactTarget);}}
});
test('reduced motion is stable; unsupported scope fails closed',()=>{
 assert.deepEqual(walk(99,{reducedMotion:true}),walk(-8,{reducedMotion:true}));assert.equal(walk(0,{view:'front'}).supported,false);assert.equal(walk(0,{outfit:'shoes'}).supported,false);assert.throws(()=>walk(NaN));assert.throws(()=>walk(0,{travelAt:()=>NaN}));
});

// Use the host's existing canvas dependency; no package/dependency is added by this module.
const hostRoot=process.env.BUBU_GAIT_TEST_REPO||process.cwd();
const hostRequire=createRequire(path.join(hostRoot,'package.json'));
const {createCanvas,loadImage}=hostRequire('@napi-rs/canvas');
const verified={sourceReady:true,sourceSha256:C.foot.sha256};
const transform=ctx=>{const m=ctx.getTransform();return[m.a,m.b,m.c,m.d,m.e,m.f]};
const state=ctx=>({alpha:ctx.globalAlpha,smoothing:ctx.imageSmoothingEnabled,matrix:transform(ctx)});
test('actual canvas inherits parent alpha .4 and restores transform/smoothing without state leakage',async()=>{
 const image=await loadImage(path.join(hostRoot,C.foot.src));const canvas=createCanvas(100,100),ctx=canvas.getContext('2d');
 ctx.globalAlpha=.4;ctx.imageSmoothingEnabled=true;ctx.setTransform(1,0,0,1,7,9);const before=state(ctx),s=walk(.25);
 assert.ok(s.feet.every(f=>!Object.hasOwn(f,'matrix')));let draws=0;const native=ctx.drawImage.bind(ctx);ctx.drawImage=(...a)=>{draws++;return native(...a)};
 assert.equal(paint(ctx,s,image,verified),true);assert.equal(draws,2);assert.deepEqual(state(ctx),before);
 const pixels=ctx.getImageData(0,0,100,100).data,alpha=new Set;for(let i=3;i<pixels.length;i+=4)if(pixels[i])alpha.add(pixels[i]);
 assert.deepEqual([...alpha],[102]);
 // A subsequent unrelated host draw still inherits the original alpha and transform.
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1,1);assert.equal(ctx.getImageData(7,9,1,1).data[3],102);
});
test('actual canvas fail-closed paths draw nothing and preserve all parent state',async()=>{
 const image=await loadImage(path.join(hostRoot,C.foot.src)),good=walk(.25),canvas=createCanvas(100,100),ctx=canvas.getContext('2d');
 ctx.globalAlpha=.4;ctx.imageSmoothingEnabled=true;ctx.setTransform(1,0,0,1,7,9);const before=state(ctx);
 const mutate=fn=>{const s=structuredClone(good);fn(s);return s};
 const invalid=[null,{}, {...good,supported:false},{...good,feet:null},{...good,feet:[good.feet[0]]},{...good,feet:[null,good.feet[1]]},
  mutate(s=>s.feet[1].side='near'),mutate(s=>s.feet[0].source='wrong.png'),mutate(s=>s.feet[0].opacity=.5),
  mutate(s=>s.feet[0].rootWorld=[NaN,10]),mutate(s=>s.feet[0].rootWorld=[1]),mutate(s=>s.feet[0].rootWorld=null)];
 for(const sample of invalid)assert.equal(paint(ctx,sample,image,verified),false);
 for(const opts of[{sourceReady:false,sourceSha256:C.foot.sha256},{sourceReady:true,sourceSha256:'wrong'},{}])assert.equal(paint(ctx,good,image,opts),false);
 assert.equal(paint(ctx,good,createCanvas(24,14),verified),false);assert.equal(paint(ctx,good,null,verified),false);
 assert.ok(ctx.getImageData(0,0,100,100).data.every(x=>x===0));assert.deepEqual(state(ctx),before);
});
test('all full repository asset-reference paths match their recorded SHA-256',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../src/content/companion/gait/dango-walk.sources.json',import.meta.url)));
 assert.ok(manifest.sources.length>=8);
 for(const r of manifest.sources){assert.ok(r.path.startsWith('assets/companion/dango/'));assert.ok(!r.path.includes('/sources/'));assert.ok(!r.path.split('/').includes('..'));const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(hostRoot,r.path))).digest('hex');assert.equal(actual,r.sha256,r.path);}
 const foot=manifest.sources.find(r=>r.path===C.foot.src);assert.equal(foot.sha256,C.foot.sha256);
});

test('host ground translates body and both feet together in walk, episode endpoints and reduced motion',()=>{
 const compare=(base,shifted,delta)=>{
  assert.equal(shifted.bodyWorld[0],base.bodyWorld[0]);assert.ok(Math.abs(shifted.bodyWorld[1]-base.bodyWorld[1]-delta)<1e-10);
  assert.equal(shifted.groundY,base.groundY+delta);assert.equal(shifted.supportCount,base.supportCount);
  for(let i=0;i<2;i++){
   const a=base.feet[i],b=shifted.feet[i];assert.equal(a.support,b.support);assert.equal(a.phase,b.phase);
   for(const point of ['rootWorld','soleWorld','contactTarget']){assert.equal(b[point][0],a[point][0]);assert.ok(Math.abs(b[point][1]-a[point][1]-delta)<1e-10);}
   assert.ok(Math.abs(b.clearance-a.clearance)<1e-10);
   assert.ok(Math.abs((b.rootWorld[1]-shifted.bodyWorld[1])-(a.rootWorld[1]-base.bodyWorld[1]))<1e-10);
  }
 };
 for(const groundY of[-20,0,31.25,64.5,92,140.75]){
  const delta=groundY-C.groundY;
  for(const q of[0,.25,.62,.83,1,2.75])for(const reducedMotion of[false,true])compare(walk(q,{reducedMotion}),walk(q,{groundY,reducedMotion}),delta);
  for(const p of[0,.1,.5,.9,1])for(const reducedMotion of[false,true])compare(episode(p,{reducedMotion}),episode(p,{groundY,reducedMotion}),delta);
 }
});
