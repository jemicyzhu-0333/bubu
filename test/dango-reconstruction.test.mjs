import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DANGO_RASTER as manifest } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { toolMatrix } from '../src/capabilities/companion/presentation/dango-raster-actions.mjs';
import { applyPoint } from '../src/capabilities/companion/presentation/rig/pose.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';
import { recordingContext } from '../test-support/dango-reconstruction-fixture.mjs';
const wait = () => new Promise(resolve => setImmediate(resolve));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const options = (id, view='front', progress=.4) => ({action:PET_ACTIONS[id],motion:PET_ACTIONS[id].motion,view,progress,elapsedMs:progress*9000});
const make = (loadImage=async src=>({src,width:8,height:8}))=>createDangoRasterArtist({manifest,loadImage});

test('recovered deterministic pawn PNGs match independently retained final hashes',()=>{
 for(const [key,expected] of Object.entries({'small-fin':'93a4101e19ee9d99eee8a71de3e33497e9e205e905199c3e7eb9499f41ebcb1f','support-paw':'e0ae1f268ae5acde1979f2dc46665e6d20da74f18ff629af6e551e03603f848d'})){
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../assets/companion/dango/raster/tools/'+key+'.png',import.meta.url))).digest('hex'),expected);
  assert.equal(manifest.tools[key].tint,'body');
 }
});

test('actual fin grip matrices meet transformed cup/crystal grips with uniform scale',async()=>{
 const artist=make();await artist.ready({all:true});
 for(const id of ['hiccup','carry-energy']) for(const view of ['front','three-quarter']) for(let i=0;i<=30;i++){
  const artwork=artist.resolveArtwork(options(id,view,i/30));assert.equal(artwork.actionReady,true);
  const item=artwork.contact.tools.find(x=>x.key===(id==='hiccup'?'cup':'energy'));
  for(const hand of artwork.contact.hands){assert.equal(hand.pawSprite,'small-fin');const matrix=hand.pawMatrix;
   const actual=applyPoint(matrix,...manifest.tools['small-fin'].anchors.grip);
   const target=applyPoint(toolMatrix(item,manifest.tools[item.key]),...manifest.tools[item.key].anchors[hand.side]);
   actual.forEach((n,i)=>near(n,target[i]));near(Math.hypot(matrix[0],matrix[1]),1);near(Math.hypot(matrix[2],matrix[3]),1);
  }
  if(id==='hiccup')assert.ok(!artwork.contact.details.some(x=>x.type==='steam'));
 }
 artist.dispose();
});

test('actual support source soles stay on ground64 across complete phase range',async()=>{
 const artist=make();await artist.ready({all:true});
 for(const view of ['front','three-quarter']) for(let i=0;i<=80;i++){
  const opts=options('workout',view,i/80),artwork=artist.resolveArtwork(opts),offset=artist.motionOffset('pushup',i/80,false,opts);
  assert.equal(artwork.actionReady,true);
  for(const hand of artwork.contact.hands){assert.equal(hand.pawSprite,'support-paw');const sole=applyPoint(hand.pawMatrix,...manifest.tools['support-paw'].anchors.sole);near(sole[1]+offset.y,64);}
  near(artwork.matrices['foot-left'][4],view==='front'?0:-6);near(artwork.matrices['foot-right'][4],view==='front'?0:-6);
  near(artwork.matrices['foot-left'][5]+offset.y,0);
 }
 artist.dispose();
});

test('each pending or failed new pawn atomically hides hands and held tools',async()=>{
 for(const [id,paw,prop] of [['hiccup','small-fin','cup'],['carry-energy','small-fin','energy'],['workout','support-paw',null]]) for(const failure of [false,true]){
  let settle;const artist=make(src=>src.includes('/'+paw+'.png')?new Promise((resolve,reject)=>{settle=()=>failure?reject(Error('fixture failure')):resolve({src,width:8,height:8});}):Promise.resolve({src,width:8,height:8}));
  const ready=artist.ready({all:true});await wait();
  const check=()=>{const artwork=artist.resolveArtwork(options(id));assert.equal(artwork.actionReady,false);const ctx=recordingContext();
   artist.action(ctx,{artwork,action:PET_ACTIONS[id],palette:PALETTES.pink,layer:'back'});artist.body(ctx,PALETTES.pink,'front',artwork);artist.action(ctx,{artwork,action:PET_ACTIONS[id],palette:PALETTES.pink,layer:'front'});
   assert.equal(ctx.calls.filter(c=>/\/(small-fin|support-paw|hand-left|hand-right|arm)\.png/.test(c.image.src)).length,0);
   if(prop)assert.equal(ctx.calls.filter(c=>c.image.src.includes('/'+prop+'.png')).length,0);
   if(id==='workout')for(const foot of ['foot-left','foot-right'])assert.deepEqual(artwork.matrices[foot],[1,0,0,1,0,0]);
  };check();settle();await ready;
  if(failure)check();else {const artwork=artist.resolveArtwork(options(id));assert.equal(artwork.actionReady,true);const ctx=recordingContext();artist.action(ctx,{artwork,action:PET_ACTIONS[id],palette:PALETTES.pink,layer:'front'});assert.equal(ctx.calls.filter(c=>c.image.src.includes('/'+paw+'.png')).length,2);if(prop)assert.equal(ctx.calls.filter(c=>c.image.src.includes('/'+prop+'.png')).length,1);}
  artist.dispose();
 }
});

test('old connector failure does not block new paw actions or weaken unknown prop rejection',async()=>{
 const artist=make(async src=>{if(src.includes('/arm.png'))throw Error('old connector absent');return {src,width:8,height:8};});await artist.ready({all:true});
 for(const id of ['workout','hiccup','carry-energy'])assert.equal(artist.resolveArtwork(options(id)).actionReady,true);
 const bad=artist.resolveArtwork({action:{id:'future',motion:'idle',prop:'unknown-future-equipment'},motion:'idle'});assert.equal(bad.actionReady,false);assert.ok(bad.missingAssets.includes('unsupported-prop:unknown-future-equipment'));
 artist.dispose();
});

test('hiccup canonical eyes do not override higher-priority expression arbitration',async()=>{
 const artist=make();await artist.ready({all:true});const opts=options('hiccup');
 const ordinary=artist.resolveArtwork({...opts,expressionId:PET_ACTIONS.hiccup.expression,face:{eyes:'wide',mouth:'wavy'}});assert.equal(ordinary.face.eyes,'neutral');assert.equal(ordinary.face.mouth,'neutral');
 const priority=artist.resolveArtwork({...opts,expressionId:'priority.example',face:{eyes:'wide',mouth:'wavy'}});assert.notEqual(priority.face.eyes,'neutral');
 artist.dispose();
});

test('sunhat paints exactly two original static ear supports before its garment layers',async()=>{
 const artist=make();await artist.ready({all:true});const item={id:'milestone.sunhat',renderKey:'sunhat',exclusiveGroup:'headwear',formId:'dango'};const appearance={items:[item]};
 for(const view of ['front','three-quarter']){const artwork=artist.resolveArtwork({...options('chase-butterfly',view),appearance});const ctx=recordingContext();artist.appearance(ctx,{item,appearance,view,artwork,palette:PALETTES.pink,layer:'back'});
  const ears=ctx.calls.filter(c=>/\/ear-(left|right)\.png/.test(c.image.src));assert.equal(ears.length,2);for(const c of ears)assert.deepEqual(c.matrix,[1,0,0,1,0,0]);assert.deepEqual(ctx.calls.slice(0,2),ears);assert.equal(ctx.calls.length,4);
 }
 artist.dispose();
});
