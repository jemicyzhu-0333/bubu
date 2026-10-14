import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(process.env.BUBU_REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const imp=p=>import(pathToFileURL(path.join(root,p)).href);
const {DANGO_RASTER}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {PET_ACTIONS}=await imp('src/content/behaviors.mjs');
const {sampleRasterPose}=await imp('src/capabilities/companion/presentation/dango-raster-pose.mjs');
const {createSourceContactPoseSelector}=await imp('src/capabilities/companion/presentation/dango-source-contact-pose.mjs');
const {createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const {catchStarContactSpriteKeys:keys,catchStarSourceContactPoseEligible:eligible,
  applyCatchStarSourceContactPose:apply}=await imp('src/capabilities/companion/presentation/dango-catch-star-contact-pose.mjs');
const ID='catch-star-quarter-v1',VIEW='three-quarter';
const b=createRequire(path.join(root,'package.json'))('@napi-rs/canvas');
const image=u=>b.loadImage(fileURLToPath(u));
const manifest=()=>structuredClone(DANGO_RASTER);
const options=(instance='one',p=.5)=>({action:PET_ACTIONS['catch-star'],motion:'reach',view:VIEW,
  progress:p,elapsedMs:p*9500,actionInstanceKey:instance,channel:'pet'});
const pose=(p=.5)=>sampleRasterPose(DANGO_RASTER.views[VIEW],options('sample',p));
const selector=(states={},m=DANGO_RASTER)=>createSourceContactPoseSelector({manifest:m,source:{state:s=>states[s.src]||'ready'}});
const legacy=()=>{const m=manifest();for(const k of keys())m.tools[k].sourceContactPose.runtimeReady=false;return m;};
const decode=async src=>{const im=await image(new URL(src,DANGO_RASTER.baseUrl)),c=b.createCanvas(im.width,im.height),ctx=c.getContext('2d');
  ctx.drawImage(im,0,0);return {width:im.width,height:im.height,data:ctx.getImageData(0,0,im.width,im.height).data};};
const near=(a,z)=>{assert.equal(a.length,z.length);a.forEach((n,i)=>assert.ok(Math.abs(n-z[i])<1e-8,`${a} != ${z}`));};
const pair=r=>r.contact.hands.filter(h=>h.side==='right');
const material=r=>r.contact.tools.filter(t=>t.key===`${ID}-back`);
const originalTools=(r,base)=>{assert.notEqual(r.contact.tools,base.contact.tools);
  assert.equal(r.contact.tools.length,base.contact.tools.length+1);
  base.contact.tools.forEach((t,i)=>assert.equal(r.contact.tools[i],t));
  assert.equal(material(r).length,1);assert.equal(r.contact.tools.at(-1),material(r)[0]);};

// Check bytes and reconstruction, rather than trusting the provenance flags.
test('three sources retain pinned PNG hashes, palette, zero transparent RGB, binary alpha and exact nearest8x',async()=>{
  assert.equal(keys().length,3);const planes={};
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL(DANGO_RASTER.views[VIEW].body.src,DANGO_RASTER.baseUrl))).digest('hex'),
    '8d76b379f2d0e2816e19dc2ef9b5efdfe8d64567a4c866e84471cf8fbe44f450');
  const palette=['26,27,38','240,80,104','248,104,120','248,128,128'];
  for(const key of keys()){
    const sprite=DANGO_RASTER.tools[key],c=sprite.sourceContactPose;
    assert.equal(c.runtimeReady,true);assert.equal(c.id,ID);
    assert.equal(createHash('sha256').update(fs.readFileSync(new URL(sprite.src,DANGO_RASTER.baseUrl))).digest('hex'),c.sourceSha256);
    const [lo,hi]=await Promise.all([sprite.src.replace('-8x.png','-logical.png'),sprite.src].map(decode));
    assert.deepEqual([lo.width,lo.height],[c.part==='helper'?66:80,72]);
    assert.deepEqual([hi.width,hi.height],[lo.width*8,lo.height*8]);
    const colors=new Set();let count=0;
    for(let i=0;i<lo.data.length;i+=4){assert.ok([0,255].includes(lo.data[i+3]));
      if(lo.data[i+3]){count++;colors.add(Array.from(lo.data.slice(i,i+3)).join(','));}
      else assert.deepEqual(Array.from(lo.data.slice(i,i+4)),[0,0,0,0]);}
    assert.ok([...colors].every(x=>palette.includes(x)));assert.equal(colors.size,c.part==='helper'?4:3);
    if(c.part!=='helper')assert.equal(count,c.part==='front'?43:26);
    for(let y=0;y<hi.height;y++)for(let x=0;x<hi.width;x++){
      const a=(y*hi.width+x)*4,z=(Math.floor(y/8)*lo.width+Math.floor(x/8))*4;
      for(let j=0;j<4;j++)assert.equal(hi.data[a+j],lo.data[z+j]);}
    planes[c.part]=lo;
  }
  // Pinned decoded RGBA of the approved 80x72 right-coverage-logical union.
  const union=new Uint8Array(80*72*4);let count=0;
  for(let i=0;i<union.length;i+=4){const f=planes.front.data,back=planes.back.data;
    assert.ok(!(f[i+3]&&back[i+3]),'material partitions must not overlap');
    const chosen=f[i+3]?f:back;for(let j=0;j<4;j++)union[i+j]=chosen[i+j];
    if(union[i+3])count++;}
  assert.equal(count,69);
  assert.equal(createHash('sha256').update(union).digest('hex'),'d82ec1c462f020a19cca1f39ad6d6c9b8510bf9a8b417d748689fbe2ba85fd0d');
  const helper=DANGO_RASTER.tools[`${ID}-helper`],alias=DANGO_RASTER.tools['snack-quarter-near-v1-left'];
  assert.equal(helper.src,alias.src);assert.deepEqual(helper.rect,alias.rect);
  assert.equal(helper.sourceContactPose.sourceSha256,alias.sourceContactPose.sourceSha256);
});

test('source application is immutable, uses two material parts of one right arm, and keeps helper free and bounded',()=>{
  for(let i=0;i<=256;i++){
    const p=i/256,o=options('dense',p),base=pose(p),saved=structuredClone(base),r=apply(DANGO_RASTER,base,o);
    assert.equal(r.sourceContactPose,ID);assert.deepEqual(base,saved);
    for(const field of ['data','face','matrices','footwearTransforms'])assert.equal(r[field],base[field]);
    originalTools(r,base);assert.equal(r.contact.details,base.contact.details);
    const right=pair(r),back=material(r)[0];assert.equal(right.length,1);assert.equal(right[0].sourcePart,'front');
    assert.equal(back.sourcePart,'back');assert.equal(back.layer,'back');
    assert.equal(back.anatomicalArmId,'right');assert.equal(back.materialPartOf,'single-right-arm');
    near([back.x,back.y],right[0].pawMatrix.slice(4));
    assert.equal(back.opacity,base.contact.hands.find(h=>h.side==='right').opacity??1);
    for(const h of right){assert.equal(h.anatomicalArmId,'right');assert.equal(h.materialPartOf,'single-right-arm');
      assert.equal(h.limb,false);assert.equal(h.connector,false);assert.equal(h.attachedArm,false);
      near(h.gripPoint,base.contact.hands.find(h=>h.side==='right').points.at(-1));
      near([70+h.pawMatrix[4],29+h.pawMatrix[5]],h.gripPoint);}
    assert.equal(right[0].pawOcclusion,'foreground');assert.equal(back.pawOcclusion,undefined);
    if(p>=.42){const star=r.contact.tools.find(t=>t.key==='star');near(right[0].gripPoint,[star.x+8.5,star.y+14]);}
    const left=r.contact.hands.find(h=>h.side==='left'),oldLeft=base.contact.hands.find(h=>h.side==='left');
    assert.equal(Boolean(left),Boolean(oldLeft));
    if(left){assert.equal(left.sourceContact.touchesStar,false);assert.equal(left.sourceContact.physicalGripClaim,false);
      assert.equal(left.sourceContact.kind,'free-preparatory-helper');assert.equal(left.gripPoint[0],23);
      assert.ok(left.gripPoint[1]>=51.5&&left.gripPoint[1]<=54);assert.ok(left.pawMatrix[5]>=-2.5&&left.pawMatrix[5]<=0);
      assert.deepEqual(left.pawMatrix.slice(0,5),[1,0,0,1,0]);}
  }
  const base=pose(.9);base.contact.hands.forEach(h=>h.opacity=.4);
  const r=apply(DANGO_RASTER,base,{...options('opacity',.9),action:{...PET_ACTIONS['catch-star'],propOpacity:.5}});
  assert.ok(r.contact.hands.every(h=>h.opacity===.2));assert.equal(material(r)[0].opacity,.4);
});

test('registration pins action, view, original body/star and all source metadata; invalid inputs fail closed',()=>{
  assert.equal(eligible(DANGO_RASTER,pose(),VIEW,options()),true);
  for(const view of ['front','profile','back','three-quarter-left','three-quarter-right',null])assert.equal(eligible(DANGO_RASTER,pose(),view,options()),false);
  for(const patch of [{id:'wave'},{motion:'wave'},{prop:'cup'},{propOpacity:-1},{propOpacity:2},{handoffRecovery:NaN}])
    assert.equal(eligible(DANGO_RASTER,pose(),VIEW,{...options(),action:{...PET_ACTIONS['catch-star'],...patch}}),false);
  for(const patch of [{state:'dragged'},{matrix:[1,0,0,1,0,0]},{transform:{}},{progress:NaN},{progress:-.1},{progress:1.1}])
    assert.equal(eligible(DANGO_RASTER,pose(),VIEW,{...options(),...patch}),false);
  for(const key of keys()){
    for(const field of Object.keys(DANGO_RASTER.tools[key].sourceContactPose)){
      const m=manifest();m.tools[key].sourceContactPose[field]='invalid';
      assert.equal(eligible(m,pose(),VIEW,options()),false,`${key}.${field}`);}
    for(const [field,value] of Object.entries({src:'wrong.png',rect:[0,0,1,1],tint:'other',matrix:[1,0,0,1,0,0],scale:2,rotate:1,flip:true})){
      const m=manifest();m.tools[key][field]=value;assert.equal(eligible(m,pose(),VIEW,options()),false,`${key}.${field}`);}
    const m=manifest();delete m.tools[key];assert.equal(eligible(m,pose(),VIEW,options()),false);
  }
  for(const target of ['body','star'])for(const patch of [{src:'wrong.png'},{rect:[0,0,1,1]},{matrix:[1,0,0,1,0,0]},{scale:2},{rotate:1}]){
    const m=manifest();Object.assign(target==='body'?m.views[VIEW].body:m.tools.star,patch);
    assert.equal(eligible(m,pose(),VIEW,options()),false,`${target} ${JSON.stringify(patch)}`);}
  const m=manifest();m.views[VIEW].body.sha256='invalid';assert.equal(eligible(m,pose(),VIEW,options()),false);
  for(const patch of [{src:'wrong.png'},{tint:'other'},{rect:[0,0,1,1]}]){const m=manifest();Object.assign(m.tools['snack-quarter-near-v1-left'],patch);assert.equal(eligible(m,pose(),VIEW,options()),false);}
  for(const mutate of [p=>p.contact.phase=-1,p=>p.contact.phase=NaN,p=>p.contact.layer='back',
    p=>p.contact.tools[0].x++,p=>p.contact.tools[0].y++,p=>p.contact.tools[0].key='cup',
    p=>p.contact.tools[0].coversPaw=true,p=>p.contact.tools[0].matrix=[1,0,0,1,0,0],
    p=>p.contact.hands[0].points[0][0]++,p=>p.contact.hands[0].points[2][0]++,
    p=>p.contact.hands[0].style='mitten',p=>p.contact.hands[0].pawSprite='small-fin',
    p=>p.contact.hands.push(structuredClone(p.contact.hands[0])),p=>p.contact.hands=[],
    p=>p.contact.tools.push({key:'cup',x:0,y:0})]){
    const p=pose();mutate(p);assert.equal(eligible(DANGO_RASTER,p,VIEW,options()),false);
    assert.equal(apply(DANGO_RASTER,p,options()),p);}
});

test('each loading, failed, missing or lost source locks whole episode to complete legacy pose',()=>{
  for(const key of keys())for(const state of ['loading','failed','missing']){
    const src=DANGO_RASTER.tools[key].src,states={[src]:state},s=selector(states),p=pose();
    assert.equal(s.apply(p,VIEW,options()),p);states[src]='ready';assert.equal(s.apply(p,VIEW,options('one',.6)),p);
    assert.equal(s.apply(pose(0),VIEW,options('next',0)).sourceContactPose,ID);s.dispose();}
  for(const key of keys()){
    const states={},s=selector(states),p=pose();assert.equal(s.apply(p,VIEW,options()).sourceContactPose,ID);
    states[DANGO_RASTER.tools[key].src]='failed';assert.equal(s.apply(p,VIEW,options('one',.6)),p);
    states[DANGO_RASTER.tools[key].src]='ready';assert.equal(s.apply(p,VIEW,options('one',.7)),p);s.dispose();}
});

test('opacity/recovery changes cannot reopen readiness; invalid view, cancellation, restart and channel budget stay isolated',()=>{
  const states={[DANGO_RASTER.tools[keys()[0]].src]:'loading'},s=selector(states),p=pose();
  const implicit={...options(),actionInstanceKey:undefined};assert.equal(s.apply(p,VIEW,implicit),p);
  states[DANGO_RASTER.tools[keys()[0]].src]='ready';
  for(const opacity of [.7,.1,0,1])assert.equal(s.apply(p,VIEW,{...implicit,progress:.6,action:{...PET_ACTIONS['catch-star'],propOpacity:opacity,handoffRecovery:1-opacity}}),p);
  assert.equal(s.apply(pose(0),VIEW,options('new',0)).sourceContactPose,ID);
  assert.equal(s.apply(p,'front',options('new',.2)),p);
  assert.equal(s.apply(p,VIEW,options('new',.3)),p);
  assert.equal(s.apply(p,VIEW,{...options('cancel'),action:null}),p);
  assert.equal(s.apply(pose(0),VIEW,options('reopen',0)).sourceContactPose,ID);
  for(let i=0;i<40;i++)s.apply(p,VIEW,{...options('overflow-'+i),channel:'test-'+i});
  assert.equal(s.stats().channels,16);assert.equal(s.apply(p,VIEW,{...options(),channel:'over-budget'}),p);
  s.dispose();assert.equal(s.stats().channels,3);
});

test('independent channels and implicit restarts cannot inherit another episode readiness',()=>{
  const src=DANGO_RASTER.tools[keys()[1]].src,states={[src]:'loading'},s=selector(states);
  const implicit={...options(),actionInstanceKey:undefined};
  assert.equal(s.apply(pose(),VIEW,implicit).sourceContactPose,undefined);
  states[src]='ready';
  assert.equal(s.apply(pose(.6),VIEW,{...implicit,progress:.6,elapsedMs:5700,channel:'portrait'}).sourceContactPose,ID);
  assert.equal(s.apply(pose(.6),VIEW,{...implicit,progress:.6,elapsedMs:5700}).sourceContactPose,undefined);
  assert.equal(s.apply(pose(0),VIEW,{...implicit,progress:0,elapsedMs:0}).sourceContactPose,ID);
  for(const channel of [128,'x'.repeat(129)]){
    const p=pose();assert.equal(s.apply(p,VIEW,{...options(),channel}),p);
  }
  s.dispose();
});

test('context accessories and reduced-motion sampling preserve their original non-hand results',()=>{
  const base=pose(.9),accessory={key:'context-test',contextAccessory:true,x:2,y:3};base.contact.tools.push(accessory);
  const r=apply(DANGO_RASTER,base,options('accessory',.9));assert.equal(r.sourceContactPose,ID);
  originalTools(r,base);assert.equal(r.contact.tools.at(-2),accessory);
  for(const flag of ['calmVisual','reducedMotion']){
    const o={...options('frozen',.9),[flag]:true},p=sampleRasterPose(DANGO_RASTER.views[VIEW],o),a=apply(DANGO_RASTER,p,o);
    assert.equal(a.sourceContactPose,ID);assert.equal(a.contact.phase,p.contact.phase);
    originalTools(a,p);assert.equal(a.face,p.face);assert.equal(a.footwearTransforms,p.footwearTransforms);
  }
});

test('real artist with generic limbs preserves body, face, feet, star and tools across 257 ready phases',async()=>{
  const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs'),limbs=await loadLimbSource();
  const a=createDangoRasterArtist({manifest:DANGO_RASTER,limbs,loadImage:image,createSurface:b.createCanvas});
  const old=createDangoRasterArtist({manifest:legacy(),limbs,loadImage:image,createSurface:b.createCanvas});
  try{await Promise.all([a.ready({all:true}),old.ready({all:true})]);assert.equal(limbs.state(),'ready');
    for(let i=0;i<=256;i++){const o=options('dense',i/256),r=a.resolveArtwork(o),p=old.resolveArtwork(o);
      assert.equal(r.sourceContactPose,ID,`phase ${i}/256`);assert.ok(r.ready&&r.actionReady);
      for(const field of ['data','face','matrices','footwearTransforms'])assert.deepEqual(r[field],p[field]);
      assert.deepEqual(r.contact.tools.slice(0,-1),p.contact.tools);assert.equal(material(r).length,1);
      assert.deepEqual(r.contact.details,p.contact.details);
      const hands=pair(r);assert.equal(hands.length,1);near([material(r)[0].x,material(r)[0].y],hands[0].pawMatrix.slice(4));
      assert.equal(material(r)[0].opacity,hands[0].opacity);
      if(i/256>=.42){const star=r.contact.tools.find(t=>t.key==='star');near(hands[0].gripPoint,[star.x+8.5,star.y+14]);}
      assert.equal(r.contact.hands.filter(h=>h.side==='left').length,p.contact.hands.filter(h=>h.side==='left').length);
    }
  }finally{a.dispose();old.dispose();}
  assert.equal(a.cacheStats().source.bytes,0);assert.equal(a.cacheStats().palette.bytes,0);
});

test('real delayed PNG cannot join a running catch episode, but the next episode recovers',async()=>{
  let release;const gate=new Promise(r=>release=r);let delayed=false;
  const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs'),limbs=await loadLimbSource();
  const a=createDangoRasterArtist({manifest:DANGO_RASTER,limbs,createSurface:b.createCanvas,loadImage:async u=>{
    if(new URL(u).pathname.endsWith(`/${ID}/right-back-8x.png`)){delayed=true;await gate;}return image(u);}});
  const old=createDangoRasterArtist({manifest:legacy(),limbs,loadImage:image,createSurface:b.createCanvas});
  try{await old.ready({all:true});const ready=a.ready({all:true});
    const cold=a.resolveArtwork(options());assert.notEqual(cold.sourceContactPose,ID);assert.deepEqual(cold.contact,old.resolveArtwork(options()).contact);
    await new Promise(r=>setImmediate(r));assert.equal(delayed,true);release();await ready;
    const still=a.resolveArtwork(options('one',.6));assert.notEqual(still.sourceContactPose,ID);
    assert.deepEqual(still.contact,old.resolveArtwork(options('one',.6)).contact);
    assert.equal(a.resolveArtwork(options('new',0)).sourceContactPose,ID);
  }finally{release();a.dispose();old.dispose();}
  assert.equal(a.cacheStats().source.entries,0);assert.equal(a.cacheStats().palette.bytes,0);
});

test('each real source PNG failure retains complete generic-host fallback, never half a right arm',async()=>{
  const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs'),limbs=await loadLimbSource();
  const old=createDangoRasterArtist({manifest:legacy(),limbs,loadImage:image,createSurface:b.createCanvas});
  try{await old.ready({all:true});for(const key of keys()){
    const suffix='/'+DANGO_RASTER.tools[key].src;
    const a=createDangoRasterArtist({manifest:DANGO_RASTER,limbs,createSurface:b.createCanvas,loadImage:u=>
      new URL(u).pathname.endsWith(suffix)?Promise.reject(Error('test unavailable catch PNG')):image(u)});
    try{await a.ready({all:true});for(const instance of ['first','reopened'])for(const p of [.3,.8,.95]){
      const r=a.resolveArtwork(options(instance,p)),baseline=old.resolveArtwork(options(instance,p));
      assert.notEqual(r.sourceContactPose,ID);assert.deepEqual(r.contact,baseline.contact);
      assert.ok(r.contact.hands.every(h=>!keys().includes(h.pawSprite)));assert.ok(r.actionReady);}
      assert.equal(a.cacheStats().source.failed,1);
    }finally{a.dispose();}
    assert.equal(a.cacheStats().source.entries,0);assert.equal(a.cacheStats().palette.bytes,0);
  }}finally{old.dispose();}
});

// Observe actual drawImage calls, never substitute a selector-derived painter.
test('production renderer composites right back, canonical body, star and right front in that order',async()=>{
  const {fixture}=await imp('docs/reviews/dango-limbs-v2-runtime/catch-star-quarter-source/scripts/renderer-fixture.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catch-layer-test-'));
  let order=[],bodySurface,canonicalBodySeen=false;
  const decoded=new Map(),targets={body:DANGO_RASTER.views[VIEW].body.src,back:DANGO_RASTER.tools[`${ID}-back`].src,
    front:DANGO_RASTER.tools[`${ID}-front`].src,star:DANGO_RASTER.tools.star.src};
  const f=await fixture(root,dir,{candidate:async({manifest,limbs,createArtist,trace})=>{
    const a=createArtist({manifest,limbs,createSurface:b.createCanvas,loadImage:async u=>{
      const im=await image(u);for(const [name,src] of Object.entries(targets))
        if(new URL(String(u)).pathname.endsWith('/'+src))decoded.set(name,im);return im;
    }});
    return {...a,resolveArtwork(o){const art=a.resolveArtwork(o);trace(o,art);return art;},
      body(ctx,...args){bodySurface=ctx.canvas;const draw=ctx.drawImage;ctx.drawImage=function(im,...da){
        if(im===decoded.get('body'))canonicalBodySeen=true;return draw.call(ctx,im,...da);
      };try{return a.body(ctx,...args);}finally{ctx.drawImage=draw;}},
      action(ctx,o){const draw=ctx.drawImage;ctx.drawImage=function(im,...args){
        for(const [name,raw] of decoded)if(im===raw)order.push(name);
        return draw.call(ctx,im,...args);
      };try{return a.action(ctx,o);}finally{ctx.drawImage=draw;}}};
  }});
  try{for(const dpr of [1,1.25,1.5,2])for(const facing of [1,-1]){
    const h=f.createRenderHarness(f.sources.candidate,{skin:'pink',outfit:false,dpr,blink:false,facing});
    h.select('expression','life.idle');h.updateState({renderChannel:`catch-layer-${dpr}-${facing}`,facing,
      devPreview:null,currentEgg:{...f.sources.candidate.interactionPlayback.createManualActionPlayback(
        f.sources.candidate.behaviors,'catch-star',{formId:'dango'}),presentationEventId:`layer-${dpr}-${facing}`},actionStartedAt:0});
    const ctx=h.body.getContext('2d'),draw=ctx.drawImage;
    ctx.drawImage=function(im,...args){if(im===bodySurface)order.push('body');return draw.call(ctx,im,...args);};
    try{for(const p of [.1,.42,.7,.83,.95]){
      order=[];h.draw(p*9500);
      assert.equal(f.traces.candidate.at(-1).art.sourceContactPose,ID);
      assert.ok(canonicalBodySeen,'composited body surface must contain the canonical body PNG');
      assert.deepEqual(order,['back','body','star','front'],`actual stage order at ${p}, DPR ${dpr}, facing ${facing}`);
    }}finally{ctx.drawImage=draw;h.dispose();}
  }}finally{f.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});

test('real tool and paw painters apply the prop envelope once, including zero and inherited canvas alpha',async()=>{
  const decoded=new Map(),targets={back:DANGO_RASTER.tools[`${ID}-back`].src,
    front:DANGO_RASTER.tools[`${ID}-front`].src,star:DANGO_RASTER.tools.star.src};
  const a=createDangoRasterArtist({manifest:DANGO_RASTER,createSurface:b.createCanvas,loadImage:async u=>{
    const im=await image(u);for(const [name,src] of Object.entries(targets))
      if(new URL(String(u)).pathname.endsWith('/'+src))decoded.set(name,im);return im;
  }});
  try{await a.ready({all:true});
    for(const propOpacity of [0,.1,.5,1])for(const handOpacity of [.4,1]){
      const o={...options(`paint-${propOpacity}-${handOpacity}`,.9),action:{...PET_ACTIONS['catch-star'],propOpacity}};
      const base=pose(.9);base.contact.hands.forEach(h=>h.opacity=handOpacity);
      // Keep the real resolved artist host while supplying an eligible contact with
      // non-unit source opacity, a case ordinary phase sampling need not produce.
      const artwork={...a.resolveArtwork(o),...apply(DANGO_RASTER,base,o)};
      const canvas=b.createCanvas(160,160),ctx=canvas.getContext('2d'),draw=ctx.drawImage,records=[];
      ctx.globalAlpha=.8;const inherited=ctx.globalAlpha;
      ctx.drawImage=function(im,...args){for(const [name,raw] of decoded)if(im===raw)
        records.push({name,alpha:ctx.globalAlpha});return draw.call(ctx,im,...args);};
      try{for(const layer of ['back','front'])a.action(ctx,{...o,artwork,layer,palette:a.palette('pink')});}
      finally{ctx.drawImage=draw;}
      if(propOpacity===0)assert.deepEqual(records,[],'zero envelope must suppress both material draws and star');
      else{assert.deepEqual(records.map(r=>r.name),['back','star','front']);
        for(const record of records){const expected=inherited*propOpacity*(record.name==='star'?1:handOpacity);
          // This backend quantizes globalAlpha to an 8-bit value.
          assert.ok(Math.abs(record.alpha-expected)<=1/255,`${record.name}: ${record.alpha} != ${expected}`);}}
      assert.equal(ctx.globalAlpha,inherited,'painter must restore inherited opacity');
    }
  }finally{a.dispose();}
});
