import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DANGO_RASTER as manifest } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { sampleDangoFace } from '../src/capabilities/companion/presentation/dango-face.mjs';
import { sampleFaceChoreography } from '../src/capabilities/companion/presentation/face-choreography.mjs';
import { sampleActivityStory } from '../src/capabilities/companion/presentation/activity-playback.mjs';
import { SESSION_ACTIVITIES, MIRROR_ACTIVITIES } from '../src/content/session-activities.mjs';
import { EXPRESSIONS } from '../src/content/expressions.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { PET_APPEARANCE_ITEMS } from '../src/content/appearance.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';
import { applyPoint } from '../src/capabilities/companion/presentation/rig/pose.mjs';
import { recordingContext as baseContext } from '../test-support/dango-reconstruction-fixture.mjs';
const recordingContext = () => ({ ...baseContext(), moveTo() {}, lineTo() {}, closePath() {} });
const make = (loadImage=async src=>({src,width:8,height:8}))=>createDangoRasterArtist({manifest,loadImage});
const session=SESSION_ACTIVITIES['focus-browse'];
const options=(progress,view='front',calmVisual=false)=>{const s=sampleActivityStory(session,progress,{calmVisual});return {...s,view,motion:s.action.motion,elapsedMs:progress*38000,expressionId:session.expression,calmVisual};};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const wait=()=>new Promise(resolve=>setImmediate(resolve));

test('Dango named petting is pleasantly content through the phrase, including 0.3 seconds and calm mode',()=>{
 const expr=EXPRESSIONS.find(x=>x.id==='react.petted');
 for(const calmVisual of [false,true])for(const elapsedMs of [0,300,900,1600,2100,3100,4199,6400]){
  const face=sampleDangoFace(expr.face,{expressionId:expr.id,elapsedMs,expressionElapsedMs:elapsedMs,calmVisual});
  assert.equal(face.eyes,'content');assert.equal(face.mouth,'smile');assert.equal(face.eyeOffsetX,0);assert.equal(face.eyeOffsetY,0);
 }
 assert.equal(expr.face.eyes,'shy','shared catalogue remains unchanged');
 assert.equal(sampleFaceChoreography(expr.face,{expressionId:expr.id,elapsedMs:300}).eyes,'shy','other forms remain unchanged');
});

test('petting adaptation follows the winning ID without remapping input identities or stronger feedback',()=>{
 const expr=EXPRESSIONS.find(x=>x.id==='react.petted'),action=PET_ACTIONS['tail-wiggle'];
 assert.equal(sampleDangoFace(expr.face,{action,expressionId:'react.petted',progress:.3}).eyes,'content');
 const priority={eyes:'surprised',mouth:'open'};
 assert.strictEqual(sampleDangoFace(priority,{action,expressionId:'system.restricted',progress:.3}),priority);
 assert.equal(action.id,'tail-wiggle');assert.equal(action.prop,'tail');
});

test('all focus-browse story phases retain their names and duration, and new fins meet actual grips',async()=>{
 const artist=make();await artist.ready({all:true});let laptops=0,notes=0;
 for(const view of ['front','three-quarter','profile'])for(let i=0;i<=380;i++){
  const opts=options(i/380,view),art=artist.resolveArtwork(opts);assert.equal(art.actionReady,true);
  const laptop=art.contact.tools.find(x=>x.key.startsWith('laptop-reverse-'));
  if(laptop){laptops++;assert.equal(laptop.key,`laptop-reverse-${view==='front'?'front':'three-quarter'}`);assert.ok(!laptop.flip);assert.ok(!art.contact.details.some(x=>x.type==='scroll'));}
  else notes++;
  for(const hand of art.contact.hands){assert.equal(hand.pawSprite,'small-fin');assert.equal(hand.connector,false);assert.equal(hand.attachedArm,false);
   const actual=applyPoint(hand.pawMatrix,...manifest.tools['small-fin'].anchors.grip);actual.forEach((v,k)=>near(v,hand.gripPoint[k]));
   const matrix=hand.pawMatrix;near(Math.hypot(matrix[0],matrix[1]),1);near(Math.hypot(matrix[2],matrix[3]),1);
   if(laptop){const anchor=manifest.tools[laptop.key].anchors[hand.side];near(actual[0],laptop.x+anchor[0]);near(actual[1],laptop.y+anchor[1]);assert.equal(hand.pawOcclusion,view==='front'?'behind-tool':'behind-lid');}
  }
 }
 assert.ok(laptops>500&&notes>100);assert.equal(session.durationMs,38000);assert.equal(session.prop,'laptop');assert.equal(session.expression,'work.switch');
 const exact=options(19300/38000);assert.equal(exact.action.prop,'notes');assert.equal(exact.action.sequencePhase.label,'记录一条');
 assert.equal(artist.resolveArtwork(options(.2,'back')).view,'front','unsupported back stays existing semantic fallback');artist.dispose();
});

test('fin paws are painted before exterior laptop lid and garment-covered roots have an underlay',async()=>{
 const artist=make();await artist.ready({all:true});
 for(const view of ['front','three-quarter']){
  const appearance={items:PET_APPEARANCE_ITEMS.filter(x=>['milestone.scarf','milestone.sunhat','milestone.boots'].includes(x.id))};
  const opts={...options(.25,view),appearance},art=artist.resolveArtwork(opts),ctx=recordingContext();
  artist.action(ctx,{artwork:art,action:opts.action,palette:PALETTES.pink,layer:'front'});
  const indices=ctx.calls.map((c,i)=>c.image.src.includes('/small-fin.png')?i:-1).filter(i=>i>=0),lid=ctx.calls.findIndex(c=>c.image.src.includes('/laptop-reverse-'));
  assert.equal(indices.length,2);
  if(view==='front')assert.ok(indices.every(i=>i<lid));
  else {const lids=ctx.calls.map((c,i)=>c.image.src.includes('/laptop-reverse-')?i:-1).filter(i=>i>=0);assert.equal(lids.length,2);assert.ok(indices.every(i=>i>lids[0]&&i<lids[1]));}assert.ok(!ctx.calls.some(c=>/\/(arm|hand-left|hand-right)\.png/.test(c.image.src)));
  assert.equal(art.pawRootsCovered,true);const body=recordingContext();artist.bodyForeground(body,PALETTES.pink,art);assert.equal(body.calls.filter(c=>c.image.src.includes('/small-fin.png')).length,2);
 }
 artist.dispose();
});

test('new laptop or fin loading/failure hides the full contact group and recovers atomically',async()=>{
 for(const key of ['laptop-reverse-front','laptop-reverse-three-quarter','small-fin'])for(const fail of [false,true]){
  let settle;const artist=make(src=>src.includes('/'+key+'.png')?new Promise((resolve,reject)=>{settle=()=>fail?reject(Error('fixture missing')):resolve({src,width:8,height:8});}):Promise.resolve({src,width:8,height:8}));
  const done=artist.ready({all:true});await wait();const opts=options(.25,key.endsWith('three-quarter')?'three-quarter':'front');
  const check=()=>{const art=artist.resolveArtwork(opts);assert.equal(art.actionReady,false);const c=recordingContext();artist.action(c,{artwork:art,action:opts.action,palette:PALETTES.pink,layer:'front'});assert.ok(!c.calls.some(x=>/laptop-reverse|small-fin|\/arm\.png|\/hand-/.test(x.image.src)));};
  check();settle();await done;if(fail)check();else assert.equal(artist.resolveArtwork(opts).actionReady,true);artist.dispose();
 }
});

test('approved tiny fin and original laptop assets remain byte exact',()=>{
 for(const [key,expected] of Object.entries({'small-fin':'93a4101e19ee9d99eee8a71de3e33497e9e205e905199c3e7eb9499f41ebcb1f','laptop':'4e8ac965d4307c68b0034a96132ed905a1ef47fff1dc4fe41c1ec404fd63ffa7'}))assert.equal(createHash('sha256').update(fs.readFileSync(new URL(`../assets/companion/dango/raster/tools/${key}.png`,import.meta.url))).digest('hex'),expected);
});

test('tool-switch boundaries and final breathing keep fins while reusing the existing transition fade',async()=>{
 const artist=make();await artist.ready({all:true});
 for(const boundary of [.14,.43,.61,.85])for(const delta of [-.003,-.0001,0,.0001,.003]){
  const opts=options(boundary+delta),art=artist.resolveArtwork(opts);
  assert.ok(art.contact.hands.length>0);
  for(const hand of art.contact.hands){assert.equal(hand.pawSprite,'small-fin');assert.ok(hand.opacity <= (opts.action.propOpacity ?? 1)+1e-10);}
 }
 const rest=artist.resolveArtwork(options(.94));assert.equal(rest.sample.motion,'breathe');
 assert.ok(rest.contact.tools.every(x=>x.key.startsWith('laptop-reverse-')));
 assert.ok(rest.contact.hands.every(x=>x.pawSprite==='small-fin'));
 const a=artist.resolveArtwork(options(.1,'front',true)),b=artist.resolveArtwork(options(.9,'front',true));
 assert.deepEqual(a.contact,b.contact,'calm mode freezes the same existing representative story pose');artist.dispose();
});

test('AI mirror reuses approved browse fins and reverse laptop with bounded typing at every sampled phase', async () => {
  const artist = make(); await artist.ready({ all: true });
  const action = MIRROR_ACTIVITIES['mirror-ai'], original = JSON.stringify(action), keys = new Set();
  try {
    for (const view of ['front', 'three-quarter', 'profile', 'back']) for (let n = 0; n <= 100; n++) {
      const opts = { action, motion: action.motion, view, progress: n / 100 };
      const art = artist.resolveArtwork(opts);
      const existing = artist.resolveArtwork({ ...opts, action: { ...action, id: 'focus-browse', prop: 'laptop' } });
      assert.equal(art.ready, true); assert.deepEqual(art.missingAssets, []);
      assert.deepEqual(art.contact.tools.filter(tool => tool.key.startsWith('laptop-reverse-')), existing.contact.tools);
      assert.equal(art.contact.tools.filter(tool => tool.key === 'ai-robot-buddy').length, 1);
      for (let index = 0; index < art.contact.hands.length; index++) {
        const actual = art.contact.hands[index], baseline = existing.contact.hands[index];
        assert.deepEqual(actual.pawMatrix.slice(0, 5), baseline.pawMatrix.slice(0, 5));
        assert.ok(Math.abs(actual.pawMatrix[5] - baseline.pawMatrix[5]) <= .48);
      }
      assert.deepEqual(art.contact.details, []);
      assert.ok(art.contact.hands.every(hand => hand.pawSprite === 'small-fin'));
      assert.ok(art.contact.tools.every(tool => tool.key.startsWith('laptop-reverse-') || tool.key === 'ai-robot-buddy'));
      const key = `${art.view}:${art.key}`; keys.add(key);
    }
    assert.equal(keys.size, 2, 'phase, AI dots and semantic prop do not grow cached body variants');
    assert.equal(JSON.stringify(action), original);
    assert.equal(action.durationMs, 30000);
  } finally { artist.dispose(); }
});

test('AI mirror keeps keyboard, fins and lid ordering with the accepted garment root underlay', async () => {
  const artist = make(); await artist.ready({ all: true });
  const action = MIRROR_ACTIVITIES['mirror-ai'];
  try {
    for (const view of ['front', 'three-quarter']) {
      const appearance = { items: PET_APPEARANCE_ITEMS.filter(item => ['milestone.scarf', 'milestone.sunhat', 'milestone.boots'].includes(item.id)) };
      const art = artist.resolveArtwork({ action, motion: action.motion, view, progress: .5, appearance });
      const context = recordingContext();
      artist.action(context, { artwork: art, action, layer: 'front', palette: PALETTES.pink });
      const paws = context.calls.flatMap((call, index) => call.image.src.includes('/small-fin.png') ? [index] : []);
      const lids = context.calls.flatMap((call, index) => call.image.src.includes('/laptop-reverse-') ? [index] : []);
      assert.equal(paws.length, 2);
      assert.ok(!context.calls.some(call => call.image.src.includes('/ellipsis.png')));
      if (view === 'front') assert.ok(paws.every(index => index < lids[0]));
      else {
        assert.equal(lids.length, 2);
        assert.ok(paws.every(index => index > lids[0] && index < lids[1]));
      }
      assert.ok(!context.calls.some(call => /\/(arm|hand-left|hand-right)\.png/.test(call.image.src)));
      assert.equal(art.pawRootsCovered, true);
      const underlay = recordingContext(); artist.bodyForeground(underlay, PALETTES.pink, art);
      assert.equal(underlay.calls.filter(call => call.image.src.includes('/small-fin.png')).length, 2);
    }
  } finally { artist.dispose(); }
});

test('AI mirror laptop and fin loading or failure remains atomic and recovers without phantom hands', async () => {
  const action = MIRROR_ACTIVITIES['mirror-ai'];
  for (const key of ['laptop-reverse-front', 'laptop-reverse-three-quarter', 'small-fin']) for (const fail of [false, true]) {
    let settle;
    const artist = make(src => src.includes(`/${key}.png`) ? new Promise((resolve, reject) => {
      settle = () => fail ? reject(Error('fixture unavailable')) : resolve({ src, width: 8, height: 8 });
    }) : Promise.resolve({ src, width: 8, height: 8 }));
    try {
      const pending = artist.ready({ all: true }); await wait();
      const opts = { action, motion: action.motion, view: key.endsWith('three-quarter') ? 'three-quarter' : 'front', progress: .5 };
      const check = () => {
        const artwork = artist.resolveArtwork(opts); assert.equal(artwork.actionReady, false); assert.equal(artwork.ready, false);
        const context = recordingContext(); artist.action(context, { artwork, action, palette: PALETTES.pink, layer: 'front' });
        assert.ok(!context.calls.some(call => /laptop-reverse|small-fin|\/arm\.png|\/hand-/.test(call.image.src)));
      };
      check(); settle(); await pending;
      if (fail) check(); else assert.equal(artist.resolveArtwork(opts).ready, true);
    } finally { artist.dispose(); }
  }
});
