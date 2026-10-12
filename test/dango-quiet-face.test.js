'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sampleDangoQuietFace}=require('../src/capabilities/companion/presentation/dango-quiet-face.mjs');
const {sampleDangoFace}=require('../src/capabilities/companion/presentation/dango-face.mjs');
const {sampleFaceChoreography}=require('../src/capabilities/companion/presentation/face-choreography.mjs');
const {EXPRESSIONS}=require('../src/content/expressions.mjs');
const {EXPRESSION_PHRASES}=require('../src/capabilities/companion/presentation/expression-phrases.mjs');

test('quiet idle/focus/rest have three distinct bounded phrases without switching semantic eyes',()=>{
 for(const id of ['life.idle','work.focus','work.rest']){
  const exp=EXPRESSIONS.find(x=>x.id===id),period=EXPRESSION_PHRASES[id][0],seen=new Set();
  for(let cycle=0;cycle<3;cycle++){
   const time=(cycle+.5)*period,opts={expressionId:id,motion:'idle',expressionElapsedMs:time};
   const original=sampleFaceChoreography(exp.face,opts),face=sampleDangoFace(exp.face,opts);
   assert.equal(face.eyes,id==='life.idle'?'neutral':original.eyes);
   assert.ok(Math.abs(face.eyeOffsetX-original.eyeOffsetX)<=.43);
   assert.ok(Math.abs(face.eyeOffsetY-original.eyeOffsetY)<=.13);
   assert.ok(Math.abs(face.openness-original.openness)<=.021);
   seen.add(JSON.stringify([face.mouth,face.eyeOffsetX,face.eyeOffsetY,face.openness]));
  }
  assert.equal(seen.size,3);
 }
});

test('DND, reduced motion, calm, actions, unrelated winners and static portrait remain unchanged',()=>{
 const face={eyes:'neutral',mouth:'smile',openness:.92,eyeOffsetX:.4};
 const opts={expressionId:'life.idle',expressionElapsedMs:7800};
 for(const gate of [{dnd:true},{calmVisual:true},{reducedMotion:true},{action:{id:'read-book'}},{motion:'read'},{expressionId:'react.surprised'}])assert.strictEqual(sampleDangoQuietFace(face,{...opts,...gate}),face);
 assert.strictEqual(sampleDangoQuietFace(face,{expressionId:'life.idle'}),face);
});

test('quiet offsets converge at cycle boundaries and never modify the input',()=>{
 const face=Object.freeze({eyes:'focused',mouth:'closed',openness:.8,eyeOffsetX:0,eyeOffsetY:0});
 for(const boundary of [5100,10200,15300])for(const t of [boundary-.01,boundary,boundary+.01]){
  const out=sampleDangoQuietFace(face,{expressionId:'work.focus',expressionElapsedMs:t});
  assert.ok(Math.abs(out.eyeOffsetX)<1e-9);assert.ok(Math.abs(out.eyeOffsetY)<1e-9);assert.ok(Math.abs(out.openness-.8)<1e-9);
 }
 assert.deepEqual(face,{eyes:'focused',mouth:'closed',openness:.8,eyeOffsetX:0,eyeOffsetY:0});
});

test('live sync DND reaches the actual renderer face sampler and suppresses only the added quiet variation',async()=>{
 const {RasterBrowserImage}=require('../test-support/raster-browser-image.js');globalThis.Image=RasterBrowserImage;
 const artist=require('../src/capabilities/companion/presentation/dango-raster-production.mjs').default;
 await artist.ready({all:true});
 const {createPetRuntimeFixture}=require('../test-support/pet-runtime-fixture');
 const content=require('../src/pet-content.js');
 const {adaptLegacyPetContent}=require('../src/core/content-pack');
 const {pathBounds}=require('../tools/rig-build/svg-geometry.mjs');
 globalThis.Path2D=class{constructor(d){this.d=d;this.bounds=pathBounds(d);}};
 const images=[];
 const harness=createPetRuntimeFixture({contentPayload:{...content,manifest:adaptLegacyPetContent(content)},styleProperties:false,liveReducedMotion:false})({
  deterministicRandom:true
 });
 const drawPet=harness.petContext.drawImage;
 harness.petContext.drawImage=function(image,...args){if(image.src)images.push(image.src);return drawPet.call(this,image,...args);};
 try{
  await new Promise(resolve=>setImmediate(()=>setImmediate(()=>setImmediate(resolve))));
  harness.bridge.handlers.sync({dnd:false,stimulationMode:'high',motionMode:'full',skin:'pink'});
  for(let i=0;i<300&&harness.runtime.sample().expressionId!=='life.idle';i++)harness.frameBy(1000/60);
  harness.frameBy(1000/60,468);
  assert.equal(harness.runtime.sample().expressionId,'life.idle');
  const before=images.filter(x=>x.includes('mouth-')).at(-1);
  assert.ok(before.includes('mouth-neutral'),before);
  images.length=0;harness.bridge.handlers.sync({dnd:true});harness.frameBy(1000/60,2);
  const quiet=images.filter(x=>x.includes('mouth-')).at(-1);
  assert.ok(quiet.includes('mouth-smile'),quiet);
  assert.equal(harness.runtime.sample().expressionId,'life.idle');
 }finally{harness.runtime.stop();delete globalThis.Image;delete globalThis.Path2D;}
});
