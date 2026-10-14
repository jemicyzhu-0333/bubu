import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

// BUBU_REPO_ROOT permits running this same test from a sibling review package;
// once copied into repo/test, its default is the ordinary repository root.
const root = path.resolve(process.env.BUBU_REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const imp = p => import(pathToFileURL(path.join(root, p)).href);
const {DANGO_RASTER} = await imp('assets/companion/dango/raster/dango.raster.mjs');
const {PET_ACTIONS} = await imp('src/content/behaviors.mjs');
const {createSourceContactPoseSelector} = await imp('src/capabilities/companion/presentation/dango-source-contact-pose.mjs');
const {createDangoRasterArtist} = await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const {waveSourceContactPoseEligible:eligible, applyWaveSourceContactPose:apply,
  waveContactSpriteKeys:keys, sampleWaveSourcePose:sample} = await imp('src/capabilities/companion/presentation/dango-wave-contact-pose.mjs');
const b = createRequire(path.join(root, 'package.json'))('@napi-rs/canvas');
const image = u => b.loadImage(fileURLToPath(u));
const manifest = () => structuredClone(DANGO_RASTER);
const options = (instance = 'one', p = .3) => ({action:PET_ACTIONS.wave, motion:'wave', view:'front',
  progress:p, elapsedMs:p * 7000, actionInstanceKey:instance, channel:'pet'});
const pose = () => ({data:{body:{sentinel:'unchanged'}}, footwearTransforms:{left:[1,0,0,1,0,0]},
  contact:{hands:[{side:'right', layer:'front', opacity:.4,
    points:[[58.6,39.712821],[61.7,31.7],[63.4,26]]}], tools:[], details:[]}});
const selector = (states = {}, m = DANGO_RASTER) => createSourceContactPoseSelector({manifest:m,
  source:{state:s => states[s.src] || 'ready'}});
const decode = async src => {const im = await image(new URL(src, DANGO_RASTER.baseUrl));
  const c = b.createCanvas(im.width, im.height), ctx = c.getContext('2d');ctx.drawImage(im, 0, 0);
  return {width:im.width, height:im.height, data:ctx.getImageData(0, 0, im.width, im.height).data};};
const legacy = () => {const m = manifest();for (const k of keys()) m.tools[k].sourceContactPose.runtimeReady = false;return m;};

test('all eleven wave PNG pairs retain hashes, four-color binary alpha and exact nearest 8x', async () => {
  assert.equal(keys().length, 11);
  const whitelist = ['26,27,38','240,80,104','248,104,120','248,128,128'].sort();
  for (const [index,key] of keys().entries()) {
    const sprite = DANGO_RASTER.tools[key];assert.equal(sprite.sourceContactPose.runtimeReady, true);
    assert.equal(sprite.sourceContactPose.frame, index);assert.equal(sprite.sourceContactPose.kind, 'free-gesture');
    assert.deepEqual(sprite.rect, [55,30,20,22]);
    const bytes = fs.readFileSync(new URL(sprite.src, DANGO_RASTER.baseUrl));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sprite.sourceContactPose.sourceSha256);
    const [lo,hi] = await Promise.all([sprite.src.replace('-8x.png','-logical.png'), sprite.src].map(decode));
    assert.deepEqual([lo.width,lo.height,hi.width,hi.height], [20,22,160,176]);
    const colors = new Set();
    for (let i=0;i<lo.data.length;i+=4) {
      assert.ok(lo.data[i+3] === 0 || lo.data[i+3] === 255);
      if (lo.data[i+3]) colors.add(Array.from(lo.data.slice(i,i+3)).join(','));
      else assert.deepEqual(Array.from(lo.data.slice(i,i+4)), [0,0,0,0]);
    }
    assert.deepEqual([...colors].sort(), whitelist);
    for(let y=0;y<hi.height;y++)for(let x=0;x<hi.width;x++) {
      const high=(y*hi.width+x)*4, low=(Math.floor(y/8)*lo.width+Math.floor(x/8))*4;
      for(let c=0;c<4;c++)assert.equal(hi.data[high+c],lo.data[low+c]);
    }
  }
});

test('wave is an immutable free gesture with fixed root, distinct poses, bounded discrete steps and a frozen reduced pose', () => {
  const p = pose(), original = structuredClone(p), m = manifest(), poses = new Set();let prior = null;
  for(let i=0;i<=2048;i++) {
    const o=options('one',i/2048), r=apply(m,p,o), h=r.contact.hands[0], s=sample(i/2048);
    poses.add(s.index);assert.equal(r.data,p.data);assert.equal(r.footwearTransforms,p.footwearTransforms);
    assert.equal(r.contact.tools,p.contact.tools);assert.equal(r.contact.details,p.contact.details);
    assert.equal(h.sourceContact.kind,'free-gesture');assert.equal(h.sourceContact.physicalGripClaim,false);
    assert.equal(h.sourceContact.shaftAxis,undefined);assert.equal(h.sourceContact.boundaryNormal,undefined);
    assert.deepEqual(h.points[0],[58.5,45.5]);assert.deepEqual(h.pawMatrix,[1,0,0,1,0,0]);
    assert.equal(h.limb,false);assert.equal(h.connector,false);assert.equal(h.attachedArm,false);
    if(prior&&s.index!==prior.index){assert.ok(Math.abs(s.index-prior.index)<=1);
      assert.ok(Math.hypot(s.target[0]-prior.target[0],s.target[1]-prior.target[1])<1);}
    prior=s;
    for(const property of ['calmVisual','reducedMotion'])assert.equal(apply(m,p,{...o,[property]:true}).contact.hands[0].sourceContact.keypose,3);
  }
  assert.equal(poses.size,11);assert.deepEqual(p,original);
  assert.equal(sample(0).opacity,0);assert.equal(sample(1).opacity,0);
  assert.ok(Math.hypot(sample(1/12).target[0]-sample(.25).target[0],sample(1/12).target[1]-sample(.25).target[1])>8);
  assert.equal(apply(m,p,{...options(),action:{...PET_ACTIONS.wave,propOpacity:0}}).contact.hands[0].opacity,0);
});

test('wave registration rejects unsupported views, transforms, altered source metadata and incomplete sets', () => {
  assert.equal(eligible(DANGO_RASTER,pose(),'front',options()),true);
  for(const view of ['three-quarter','profile','back','three-quarter-left'])assert.equal(eligible(DANGO_RASTER,pose(),view,options()),false);
  for(const extra of [{state:'dragged'},{matrix:[1,0,0,1,0,0]},{transform:{}},
    {action:{...PET_ACTIONS.wave,prop:'cup'}},{action:{...PET_ACTIONS.wave,id:'high-five'}},
    {action:{...PET_ACTIONS.wave,propOpacity:-1}},{action:{...PET_ACTIONS.wave,handoffRecovery:2}}]) {
    assert.equal(eligible(DANGO_RASTER,pose(),'front',{...options(),...extra}),false);
  }
  for(const key of keys())for(const field of ['sourceSha256','bodySha256','kind','frame','angleDegrees','fixedShoulder','target','translationOnly','quantizedOnce','runtimeReady']) {
    const m=manifest();m.tools[key].sourceContactPose[field]='invalid';assert.equal(eligible(m,pose(),'front',options()),false);
  }
  for(const key of keys()){const m=manifest();delete m.tools[key];assert.equal(eligible(m,pose(),'front',options()),false);}
  const m=manifest();m.views.front.body.rect[2]++;assert.equal(eligible(m,pose(),'front',options()),false);
});

test('every single-resource loading, failed, missing and mid-episode loss branch falls back for the complete episode', () => {
  for(const key of keys())for(const state of ['loading','failed','missing']) {
    const states={[DANGO_RASTER.tools[key].src]:state}, s=selector(states), p=pose();
    assert.equal(s.apply(p,'front',options()),p);states[DANGO_RASTER.tools[key].src]='ready';
    assert.equal(s.apply(p,'front',options('one',.5)),p);
    assert.equal(s.apply(p,'front',options('next',0)).sourceContactPose,'wave-front-v1');s.dispose();
  }
  for(const key of keys()) {
    const states={},s=selector(states),p=pose();assert.equal(s.apply(p,'front',options()).sourceContactPose,'wave-front-v1');
    states[DANGO_RASTER.tools[key].src]='failed';assert.equal(s.apply(p,'front',options('one',.4)),p);
    states[DANGO_RASTER.tools[key].src]='ready';assert.equal(s.apply(p,'front',options('one',.5)),p);s.dispose();
  }
});

test('opacity/recovery do not reopen readiness; cancellation, restart and bounded channels cannot leak a wave hand', () => {
  const states={[DANGO_RASTER.tools[keys()[0]].src]:'loading'},s=selector(states),p=pose();
  const implicit={...options(),actionInstanceKey:undefined};assert.equal(s.apply(p,'front',implicit),p);
  states[DANGO_RASTER.tools[keys()[0]].src]='ready';
  for(const opacity of [.7,.1,0])assert.equal(s.apply(p,'front',{...implicit,progress:.5,action:{...PET_ACTIONS.wave,propOpacity:opacity,handoffRecovery:1-opacity}}),p);
  assert.equal(s.apply(p,'front',options('new',0)).sourceContactPose,'wave-front-v1');
  assert.equal(s.apply(p,'front',{...options('cancel'),action:null}).sourceContactPose,undefined);
  assert.equal(s.apply(p,'front',options('reopen',0)).sourceContactPose,'wave-front-v1');
  for(let i=0;i<40;i++)s.apply(p,'front',{...options('overflow-'+i),channel:'test-'+i});
  assert.equal(s.stats().channels,16);assert.equal(s.apply(p,'front',{...options(),channel:'over-budget'}),p);
  s.dispose();assert.equal(s.stats().channels,3);
});

test('the real integrated artist keeps body, face, feet and tools unchanged across 257 wave phases', async () => {
  const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs'),limbs=await loadLimbSource();
  const a=createDangoRasterArtist({manifest:DANGO_RASTER,limbs,loadImage:image,createSurface:b.createCanvas});
  const old=createDangoRasterArtist({manifest:legacy(),limbs,loadImage:image,createSurface:b.createCanvas});
  try {await Promise.all([a.ready({all:true}),old.ready({all:true})]);
    for(let i=0;i<=256;i++){const o=options('dense',i/256),r=a.resolveArtwork(o),p=old.resolveArtwork(o);
      assert.equal(r.sourceContactPose,'wave-front-v1');assert.ok(r.ready&&r.actionReady);
      for(const field of ['data','face','matrices','footwearTransforms'])assert.deepEqual(r[field],p[field]);
      assert.deepEqual(r.contact.tools,p.contact.tools);assert.equal(r.contact.hands.length,1);
      assert.equal(r.contact.hands[0].sourceContact.physicalGripClaim,false);
    }
  } finally {a.dispose();old.dispose();}
  assert.equal(a.cacheStats().source.bytes,0);assert.equal(a.cacheStats().palette.bytes,0);
});

test('a real delayed PNG cannot join a started episode; a new episode recovers and disposal releases all resources', async () => {
  let release;const gate=new Promise(r=>release=r);let delayed=false;
  const a=createDangoRasterArtist({manifest:DANGO_RASTER,createSurface:b.createCanvas,loadImage:async u=>{
    if(new URL(u).pathname.endsWith('/wave-front-v1/wave-05-8x.png')){delayed=true;await gate;}return image(u);
  }});
  try {const ready=a.ready({all:true});assert.notEqual(a.resolveArtwork(options()).sourceContactPose,'wave-front-v1');
    await new Promise(r=>setImmediate(r));assert.equal(delayed,true);release();await ready;
    assert.notEqual(a.resolveArtwork(options('one',.5)).sourceContactPose,'wave-front-v1');
    assert.equal(a.resolveArtwork(options('new',0)).sourceContactPose,'wave-front-v1');
  } finally {release();a.dispose();}
  assert.equal(a.cacheStats().source.entries,0);assert.equal(a.cacheStats().source.bytes,0);
  assert.equal(a.cacheStats().palette.bytes,0);
});

test('real PNG failure with generic limbs loaded matches whole legacy fallback without a partial source gesture', async () => {
  const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs'),limbs=await loadLimbSource();
  const a=createDangoRasterArtist({manifest:DANGO_RASTER,limbs,createSurface:b.createCanvas,loadImage:u=>
    new URL(u).pathname.endsWith('/wave-front-v1/wave-05-8x.png')?Promise.reject(Error('test unavailable wave PNG')):image(u)});
  const old=createDangoRasterArtist({manifest:legacy(),limbs,createSurface:b.createCanvas,loadImage:image});
  try {await Promise.all([a.ready({all:true}),old.ready({all:true})]);
    for(const instance of ['first','reopened']){const r=a.resolveArtwork(options(instance)),p=old.resolveArtwork(options(instance));
      assert.notEqual(r.sourceContactPose,'wave-front-v1');assert.deepEqual(r.contact,p.contact);
      assert.ok(r.contact.hands.every(h=>!keys().includes(h.pawSprite)));assert.ok(r.actionReady);}
    assert.equal(a.cacheStats().source.failed,1);
  } finally {a.dispose();old.dispose();}
  assert.equal(a.cacheStats().source.entries,0);assert.equal(a.cacheStats().palette.bytes,0);
});
