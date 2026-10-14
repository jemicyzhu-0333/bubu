import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { sampleDangoStepInPlaceEpisode } from '../src/capabilities/companion/presentation/gait/dango-walk.mjs';
import { createBoundedGaitPlayback } from '../src/surfaces/pet/bounded-gait-playback.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { DANGO_WALK_WORKBENCH, DANGO_SOURCE_WALK } from '../src/content/companion/gait/dango-walk.mjs';
const action = DANGO_WALK_WORKBENCH.action;
const input = (p, extra = {}) => ({ view:'three-quarter', state:'idle', motion:'idle', action,
  progress:p, elapsedMs:p*7200, expressionElapsedMs:p*7200, actionInstanceKey:'preview-1', ...extra });
const make = extra => createDangoRasterArtist({manifest:DANGO_RASTER,loadImage:url=>loadImage(fileURLToPath(url)),
  createSurface:createCanvas,walkPreview:{enabled:true,workbench:true},...extra});

test('step-in-place owns constant world contacts, genuine lift/recovery and stand bookends', () => {
  let lifted=0, maxLift=0, maxSweep=0;
  for(let i=0;i<=2000;i++) {
    const s=sampleDangoStepInPlaceEpisode(i/2000);
    assert.equal(s.bodyWorld[0],0);assert.ok(s.bodyWorld[1]>=0&&s.bodyWorld[1]<=1.7);
    assert.ok(s.feet.some(f=>f.support));
    for(const f of s.feet) {
      const hip=DANGO_SOURCE_WALK.hips[f.side];
      assert.deepEqual(f.contactTarget,[hip,DANGO_SOURCE_WALK.groundY]);
      if(f.support) assert.deepEqual(f.soleWorld,f.contactTarget);
      else { lifted++;maxLift=Math.max(maxLift,f.clearance);maxSweep=Math.max(maxSweep,Math.abs(f.soleWorld[0]-hip)); }
    }
  }
  assert.ok(lifted>500&&maxLift>11.9&&maxSweep>.8);
  for(const p of[0,1]) { const s=sampleDangoStepInPlaceEpisode(p);assert.deepEqual(s.bodyWorld,[0,0]);assert.ok(s.feet.every(f=>f.support)); }
});

test('one host-clock phase owner handles pause, policy reset, loop identity, repeated selection and clock reversal', () => {
  const player=createBoundedGaitPlayback(), preview={category:'action',id:action.id,view:'three-quarter',skin:'pink',level:1};
  const sample=(now,extra={})=>player.sample({action,preview,previewStartedAt:0,now,form:{id:'dango'},...extra});
  assert.equal(sample(100).progress,0);const moving=sample(2300);assert.ok(moving.progress>.3);
  const paused=sample(2400,{paused:true});assert.equal(paused.progress,moving.progress);
  assert.equal(sample(99999,{paused:true}).action.previewPlayback.elapsedMs,moving.action.previewPlayback.elapsedMs);
  assert.equal(sample(100000).progress,moving.progress);
  const resumed=sample(100100);assert.ok(resumed.progress>moving.progress);
  const calm=sample(100200,{calmVisual:true});assert.equal(calm.progress,0);assert.equal(sample(120000,{calmVisual:true}).progress,0);
  assert.equal(sample(120001).progress,0);assert.ok(sample(120101).progress>0);
  const a=sample(127201),b=sample(134401);assert.equal(a.progress,b.progress);assert.notEqual(a.action.previewPlayback.id,b.action.previewPlayback.id);
  assert.equal(sample(134401,{previewStartedAt:134401}).progress,0);
  assert.equal(sample(3).progress,0);
  assert.equal(player.sample({action:null,preview:null,now:4}),null);assert.equal(sample(10).progress,0);
});

test('workbench adapter never admits travelling episodes or unrelated actions and keeps native source identity', async()=>{
  const artist=make();await artist.ready();
  const art=artist.resolveArtwork(input(.42));assert.equal(art.walkMode,'step-in-place');assert.equal(art.walk.bodyWorld[0],0);
  assert.deepEqual(art.data,DANGO_RASTER.views['three-quarter-right']);
  for(const key of['foot-left','foot-right'])assert.equal(art.data.parts[key].src,`views/three-quarter-right/${key}.png`);
  assert.equal(artist.resolveArtwork({...input(.42),action:null,walkEpisode:{id:'travel',progress:.5}}).walk,undefined);
  assert.equal(artist.resolveArtwork(input(.42,{facing:-1})).walk,undefined);
  assert.equal(artist.resolveArtwork(input(.42,{action:{...action,prop:'cup'}})).walk,undefined);
  artist.dispose();
});

test('unsupported view/outfit remains whole-episode fallback until a fresh host episode',async()=>{
  const artist=make();await artist.ready();
  assert.equal(artist.resolveArtwork(input(.1,{view:'front'})).walk,null);
  assert.equal(artist.resolveArtwork(input(.2)).walk,null);
  assert.ok(artist.resolveArtwork(input(.2,{actionInstanceKey:'preview-2'})).walk);
  assert.equal(artist.resolveArtwork(input(.3,{actionInstanceKey:'preview-2',appearance:{items:[{id:'hat'}]}})).walk,null);
  assert.equal(artist.resolveArtwork(input(.4,{actionInstanceKey:'preview-2'})).walk,null);
  artist.dispose();
});

test('all native foot matrices stay world-fixed through support at four DPRs; cache excludes progress',async()=>{
  const artist=make();await artist.ready();const keys=new Set();
  for(const dpr of[1,1.25,1.5,2]) {let previous=null;
    for(let i=0;i<=144;i++) {const art=artist.resolveArtwork(input(i/144,{actionInstanceKey:`dpr-${dpr}`}));keys.add(art.key);
      for(let side=0;side<2;side++){const foot=art.walk.feet[side];if(foot.support){assert.equal(foot.soleWorld[1],64);if(previous?.[side].support)assert.deepEqual(foot.matrix,previous[side].matrix);}}
      previous=art.walk.feet;
    }
  }
  assert.equal(keys.size,1);artist.dispose();
});

test('workbench close keeps the last pose then settles feet to the same native stand, while higher priority clears it', () => {
  const player=createBoundedGaitPlayback(), preview={category:'action',id:action.id,view:'three-quarter',skin:'pink',level:1};
  const form={id:'dango'},state={state:'idle'},base={action,preview,previewStartedAt:0,form,state,source:'base'};
  player.sample({...base,now:0});const walking=player.sample({...base,now:2800});
  player.reset({state,policy:{calmVisual:false},hidden:false});
  const close={action:null,preview:null,form,state,source:'base'};
  const first=player.sample({...close,now:2825});assert.equal(first.progress,walking.progress);assert.equal(first.action.previewPlayback.settle,0);
  assert.equal(first.viewHint,'three-quarter');
  const mid=player.sample({...close,now:2935}),end=player.sample({...close,now:3045});
  assert.equal(mid.action.previewPlayback.settle,.5);assert.equal(end.action.previewPlayback.settle,1);
  const a=sampleDangoStepInPlaceEpisode(walking.progress),b=sampleDangoStepInPlaceEpisode(first.progress,{settle:0});assert.deepEqual(a,b);
  const stand=sampleDangoStepInPlaceEpisode(end.progress,{settle:1});assert.deepEqual(stand.bodyWorld,[0,0]);assert.ok(stand.feet.every(f=>f.support&&f.clearance===0));assert.equal(stand.supportCount,2);
  assert.equal(player.sample({...close,now:3100,source:'input-safe'}),null);
  assert.equal(player.sample({...close,now:3200}),null);
  assert.equal(player.sample({...base,now:3300,previewStartedAt:3300}).progress,0);
  player.reset({state,policy:{calmVisual:false},hidden:true});assert.equal(player.sample({...close,now:3400}),null);
});

test('session pause cannot reintroduce independent body bob, while input-safe feedback still has priority',async()=>{
  const {bodyStateOffset,resolveActionBodyPose}=await import('../src/surfaces/pet/body-presentation.mjs');
  const current={...action,previewPlayback:{id:'pause',paused:true}},options={action:current,expressionId:current.expression,source:'session'};
  const body={tone:'normal',x:2,y:3,scaleX:.98,scaleY:1.02,rotateDeg:1};
  assert.equal(bodyStateOffset({...options,state:'idle',formId:'dango',calmVisual:false,legacyFrames:10,bob:2}),0);
  assert.deepEqual(resolveActionBodyPose(body,options),{tone:'normal',x:0,y:0,scaleX:1,scaleY:1,rotateDeg:0});
  assert.equal(resolveActionBodyPose(body,{...options,source:'input-safe'}),body);
});

test('the narrow switch exposes only a manual workbench catalog preview, never an autonomous action', async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const content=require('../src/content/index.js');const {createPetCatalog}=require('../src/capabilities/companion/pet-catalog.js');
  const {previewAction}=await import('../src/capabilities/companion/presentation/form-art.mjs');
  const catalog=createPetCatalog({content,skins:require('../src/skins.mjs').SKINS});
  const entry=catalog.actions.find(item=>item.id===action.id);
  assert.equal(Boolean(entry),DANGO_WALK_WORKBENCH.enabled);
  if(entry){assert.deepEqual(entry.previewDefaults,{skin:'pink',view:'three-quarter',level:1});assert.equal(entry.category,'action');}
  assert.equal(content.PET_ACTIONS[action.id],undefined);
  assert.equal(content.EASTER_EGGS.some(item=>item.id===action.id),false);
  assert.equal(previewAction({id:'dango'},action.id),DANGO_WALK_WORKBENCH.enabled?action:null);
  assert.equal(previewAction({id:'usagi'},action.id),null);assert.equal(previewAction({id:'dango'},'walking'),null);
  assert.equal(DANGO_SOURCE_WALK.runtimeReady,false);assert.equal(DANGO_SOURCE_WALK.host,null);
});


test('native preview facing is presentation-only, exact-action scoped and retained only by its close bridge', () => {
  const player=createBoundedGaitPlayback(), state={state:'idle',facing:-1}, form={id:'dango'};
  const preview={category:'action',id:action.id,view:'three-quarter',skin:'pink',level:1};
  const base={action,preview,previewStartedAt:0,form,state,source:'base'};
  assert.equal(player.sample({...base,now:0}).facingHint,1);
  player.sample({...base,now:1800});
  const close={action:null,preview:null,form,state,source:'base'};
  assert.equal(player.sample({...close,now:1825}).facingHint,1);
  assert.equal(player.sample({...close,now:2200}).facingHint,1);
  assert.equal(state.facing,-1);
  assert.equal(player.sample({...close,now:2250,source:'input-safe'}),null);
  assert.equal(player.sample({...close,now:2300}),null);
  assert.equal(player.sample({...base,now:2400,form:{id:'usagi'}}),null);
  assert.equal(player.sample({...base,now:2500,action:{...action,id:'other'}}),null);
  assert.equal(player.sample({...base,now:2600,action:{...action}}),null);
  for(const changes of[{view:'front'},{view:'three-quarter-left'},{level:99}]) {
    assert.equal(player.sample({...base,now:2700,preview:{...preview,...changes}}).facingHint,undefined);
  }
  assert.equal(player.sample({...base,now:2800,state:{...state,dragging:true}}),null);
  assert.equal(player.sample({...base,now:2900,source:'input-safe'}),null);
  for(const unsupported of ['focused','sleeping','resting','celebrating','dragged']) {
    assert.equal(player.sample({...base,now:3000,state:{...state,state:unsupported}}),null);
  }
  assert.equal(player.sample({...base,now:3100,paused:true,source:'session'}).facingHint,1);
  assert.equal(state.facing,-1);
});


test('presentation facing checks the resolved outfit and native view again after close', async () => {
  const {resolveGaitFacing}=await import('../src/surfaces/pet/body-presentation.mjs');
  const base={facing:-1,facingHint:1,formId:'dango',state:'idle',view:'three-quarter',appearance:{items:[]}};
  assert.equal(resolveGaitFacing(base),1);
  for(const override of [{facingHint:undefined},{formId:'usagi'},{state:'sleeping'},
    {view:'front'},{view:'three-quarter-left'},{appearance:{items:[{id:'milestone.scarf'}]}},{appearance:null}]) {
    assert.equal(resolveGaitFacing({...base,...override}),-1);
  }
});
