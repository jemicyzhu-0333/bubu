'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const content = require('../src/content/expressions.mjs');
const expressionEngine = require('../src/core/pet-expression.mjs');
const galleryEngine = require('../src/core/pet-gallery.mjs');

function fixture() {
  const calls = [], events = {}, frames = [], context = new Proxy({}, { get: (_object,key) => (...args) => calls.push([key,...args]) });
  const element = tag => ({ tag, dataset:{}, style:{}, attributes:{}, children:[], listeners:{},
    getContext:()=>context, setAttribute(key,value){this.attributes[key]=value;},
    getAttribute(key){return this.attributes[key];}, addEventListener(key,fn){this.listeners[key]=fn;},
    append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
    toDataURL:()=> 'data:image/png;base64,fixture',replaceWith(){},
    set src(value){this.value=value;this.listeners.load?.();} });
  const roots=Object.fromEntries(['#gallery','#playAll','#staticAll'].map(id=>[id,element('div')]));
  const document={createElement:element,querySelector:id=>roots[id],documentElement:{dataset:{}}};
  const stage={bodySize:66,deviceScale:2,artWidth:146,artHeight:146,rasterWidth:292,rasterHeight:292,cssWidth:219,cssHeight:219,bodyOrigin:{x:40,y:40}};
  const form={id:'dango',renderer:'vector'};let ready=false,settled,unsubscribed=false;
  const formArt={
    paletteForSkin:()=>({}),spriteBounds:()=>({x:-9,y:-10,width:84,height:84}),
    resolveArtwork:(_form,options)=>({kind:'dango-raster',ready,key:ready?'loaded':'loading',...options}),
    bodySpriteKey:(_form,_skin,tone,_view,_fit,artwork)=>`${tone}:${artwork.key}`,
    paintBodySprite:(_surface,options)=>calls.push(['body',options]),
    drawFace:(_context,options)=>calls.push(['face',options]),
    drawActionLayer:(_context,options)=>calls.push(['limbs',options]),
    drawExpressionAccent:(_context,...args)=>calls.push(['accent',...args]),
    subscribeArtwork:(_form,listener)=>{settled=listener;return()=>{unsubscribed=true;};}
  };
  const sandbox={content,expressionEngine,galleryEngine,forms:{resolvePetForm:()=>form,resolveFormStage:()=>stage},formArt,
    art:{applyBodyPose:()=>{}},document,window:{location:{search:'?capture=static'},devicePixelRatio:2,
      addEventListener:(event,fn)=>{events[event]=fn;},requestAnimationFrame:fn=>frames.push(fn)},URLSearchParams,performance:{now:()=>0},exports:{}};
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/expression-gallery.mjs'),'utf8')
    .replace(/^import[^\n]+\n/gm,'').replace(/export \{ galleryDebug \};/,'exports.galleryDebug = galleryDebug;');
  vm.runInNewContext(source,sandbox);
  return{calls,roots,document,form,stage,debug:sandbox.exports.galleryDebug,frames,
    settle(){ready=true;settled();},dispose(){events.pagehide();},get unsubscribed(){return unsubscribed;}};
}

test('all expression gallery cards use the selected production artist, native bounds and both limb layers',()=>{
  const f=fixture();assert.equal(f.debug.ids().length,32);
  const faces=f.calls.filter(c=>c[0]==='face').map(c=>c[1]);
  assert.equal(faces.length,32);
  assert.deepEqual(new Set(faces.map(o=>o.artwork.expressionId)),new Set(content.EXPECTED_EXPRESSION_IDS));
  assert.ok(faces.some(o=>o.artwork.accent==='sleep-zzz'),'non-neutral accent assets participate in readiness');
  assert.ok(faces.every(o=>o.form===f.form&&o.artwork.kind==='dango-raster'&&o.blinking===false));
  const limbs=f.calls.filter(c=>c[0]==='limbs').map(c=>c[1]);
  assert.equal(limbs.filter(o=>o.layer==='back').length,32);assert.equal(limbs.filter(o=>o.layer==='front').length,32);
  assert.ok(limbs.every(o=>o.action===null&&o.calmVisual));
  assert.ok(f.calls.some(c=>c[0]==='drawImage'&&c[2]===31&&c[3]===30&&c[4]===84&&c[5]===84),'native sprite bleed is preserved');
  assert.equal(f.frames.length,0,'static captures do not add a perpetual animation loop');
});

test('a truthy loading artwork cannot mark the gallery ready or permanently cache a blank capture',async()=>{
  const f=fixture(),before=f.calls.filter(c=>c[0]==='body').length;
  assert.equal(f.document.documentElement.dataset.galleryReady,'false');
  await assert.rejects(f.debug.rasterize(),/still loading/);
  f.settle();assert.equal(f.document.documentElement.dataset.galleryReady,'true');
  assert.ok(f.calls.filter(c=>c[0]==='body').length>before,'asset settlement invalidates cached loading surfaces');
  assert.equal(await f.debug.rasterize(),32);
  f.dispose();assert.equal(f.unsubscribed,true);
});
