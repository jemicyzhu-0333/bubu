'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFrontStoryArtist}=require('../src/capabilities/companion/presentation/front-story-artist.mjs');
const {sampleFrontStory}=require('../src/capabilities/companion/presentation/front-story-sample.mjs');
const {FRONT_STORY_PREVIEWS,FRONT_STORY_GARMENTS}=require('../src/content/companion/front-stories.mjs');
const {PET_APPEARANCE_ITEMS}=require('../src/content/appearance.mjs');
const {PET_ACTIONS}=require('../src/content/behaviors.mjs');
const {MIRROR_ACTIVITIES}=require('../src/content/session-activities.mjs');
const {projectAppearance}=require('../src/core/pet-appearance.mjs');
const {selectAppearance}=require('../src/capabilities/companion/domain/appearance-selection');
const {createMirrorPlayback}=require('../src/surfaces/pet/mirror-playback.mjs');
const halloween=FRONT_STORY_PREVIEWS['halloween-lantern'],ai=MIRROR_ACTIVITIES['mirror-ai'];
function fixture(loadImage){
 const seen=[];let disposed=0;const base={resolveView:v=>v,resolveArtwork:o=>(seen.push(o),{view:o.view,identity:'original-body'}),
 action:()=>true,applyMotionTransform(){},appearance:()=>true,appearanceLayers:i=>i.parts,
 portraitBounds:()=>({x:0,y:0,width:66,height:66}),ready:async()=>{},subscribeArtwork:()=>()=>{},cacheStats:()=>({}),dispose:()=>disposed++};
 return {artist:createFrontStoryArtist(base,{loadImage}),seen,get disposed(){return disposed;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clothes=PET_APPEARANCE_ITEMS.filter(item=>Object.hasOwn(FRONT_STORY_GARMENTS,item.id));
test('manual Halloween entry never joins autonomous PET_ACTIONS; garments explicitly opt in',()=>{
 assert.equal(PET_ACTIONS[halloween.id],undefined);assert.equal(clothes.length,2);
 for(const item of clothes){assert.equal(item.optInOnly,true);assert.deepEqual(item.views,['front']);}
});
test('original automatic wardrobe and saved preferences are unchanged across all levels and skins',()=>{
 const old=PET_APPEARANCE_ITEMS.filter(item=>!Object.hasOwn(FRONT_STORY_GARMENTS,item.id));
 const skins=['pink',...new Set(old.map(i=>i.skin).filter(Boolean))];
 for(const currentSkin of skins)for(let level=1;level<=45;level++){
  const equipped=Object.freeze({headwear:'milestone.sunhat',sidebag:'milestone.satchel'});
  for(const preferences of [{},equipped]){
   const input={level,currentSkin,unlockedSkins:skins,equipped:preferences};
   assert.deepEqual(selectAppearance({...input,items:PET_APPEARANCE_ITEMS}).worn,selectAppearance({...input,items:old}).worn);
  }
  for(const view of ['front','three-quarter','back'])assert.deepEqual(
   projectAppearance({skin:currentSkin,level,view,items:PET_APPEARANCE_ITEMS}),projectAppearance({skin:currentSkin,level,view,items:old}));
 }
});
test('atomic pending/failure preserves original action and wardrobe input without mutation',async()=>{
 let release;const f=fixture(()=>new Promise(r=>release=r));
 const options=Object.freeze({view:'front',action:ai,progress:.2,appearance:Object.freeze({items:Object.freeze(clothes)})});
 const pending=f.artist.resolveArtwork(options);assert.equal(pending.frontStoryStatus,'loading');assert.equal(f.seen.at(-1).action,ai);
 assert.equal(options.appearance.items.length,2);await tick();f.artist.dispose();release({width:2,height:2,close(){}});await tick();assert.equal(f.disposed,1);
 const broken=fixture(async()=>{throw Error('source failure');});broken.artist.resolveArtwork(options);await broken.artist.ready({all:true});
 assert.equal(broken.artist.resolveArtwork(options).frontStoryStatus,'failed');assert.equal(broken.seen.at(-1).action,ai);broken.artist.dispose();
});
test('ready front uses authored story; unsupported view retains original; outfit survives action end',async()=>{
 const f=fixture(async()=>({width:2,height:2}));await f.artist.ready({all:true});
 const original={view:'front',action:halloween,progress:.5,appearance:{items:clothes}};
 const art=f.artist.resolveArtwork(original);assert.equal(art.frontStory.kind,'halloween');assert.equal(art.frontStoryClothesReady,true);
 assert.equal(f.seen.at(-1).action.prop,'none');assert.deepEqual(original.appearance.items,clothes);
 const off=f.artist.resolveArtwork({...original,action:null});assert.equal(off.frontStory,null);assert.equal(off.frontStoryClothesReady,true);
 const quarter=f.artist.resolveArtwork({...original,view:'three-quarter',action:ai});assert.equal(quarter.frontStory,null);assert.equal(quarter.frontStoryStatus,'unsupported-view');assert.equal(f.seen.at(-1).action,ai);
 const dragged=f.artist.resolveArtwork({...original,state:'dragged'});assert.equal(dragged.frontStory,null);
 f.artist.dispose();f.artist.dispose();assert.equal(f.disposed,1);assert.equal(f.artist.cacheStats().frontStories.entries,0);
});
test('failed transient prop does not remove independently selected clothing',async()=>{
 const f=fixture(async url=>{if(url.includes('ghost'))throw Error('missing ghost');return{width:2,height:2};});await f.artist.ready({all:true});
 const art=f.artist.resolveArtwork({view:'front',action:halloween,progress:.5,appearance:{items:clothes}});
 assert.equal(art.frontStoryStatus,'failed');assert.equal(art.frontStoryClothesReady,true);assert.equal(f.seen.at(-1).action,halloween);f.artist.dispose();
});
test('real mirror lifecycle drives AI enter/exit; authored loops never claim completion',()=>{
 const playback=createMirrorPlayback();const sample=(action,now,extra={})=>playback.sample({action,now,progress:.2,formId:'dango',...extra});
 const enter=sample(ai,0);assert.equal(sampleFrontStory(enter.action,enter.progress).opacity,0);
 const working=sample(ai,125000);assert.ok(sampleFrontStory(working.action,working.progress));
 const stop=sample(null,125001);assert.equal(sampleFrontStory(stop.action,stop.progress).phase,'settle');
 assert.equal(sample(null,125601).action,null);
 sample(ai,130000);assert.equal(sample(ai,130100,{blocked:true}).action,null);
 assert.equal(sample(null,130200).action,null);
});
test('Halloween complete and reduced motion are bounded and preserve complete hand source',()=>{
 const end=sampleFrontStory(halloween,1);assert.equal(end.opacity,0);assert.ok(end.layers.every(i=>i.opacity===0));
 const still=sampleFrontStory(halloween,.8,{reducedMotion:true});assert.equal(still.elapsed,2400);assert.deepEqual(still,sampleFrontStory(halloween,.1,{reducedMotion:true}));
});
test('cape rear panel precedes anatomy; ordinary back wardrobe cannot redraw it over feet',async()=>{
 const order=[];const f=fixture(async()=>({width:2,height:2}));await f.artist.ready({all:true});
 const artwork=f.artist.resolveArtwork({view:'front',action:halloween,progress:.4,appearance:{items:clothes}});
 const context={globalAlpha:1,save(){},restore(){},transform(){},drawImage(){order.push('cape');}};
 assert.equal(f.artist.action(context,{layer:'back',artwork,palette:[]}),true);assert.deepEqual(order,['cape']);
 assert.equal(f.artist.appearance(context,{layer:'back',artwork,item:clothes.find(x=>x.id==='seasonal.plum-cape'),palette:[]}),false);
 assert.deepEqual(order,['cape']);f.artist.dispose();
});
test('late decoded images all release after terminal disposal; subscriptions do not fire',async()=>{
 const releases=[];let closes=0,notifications=0;const f=fixture(()=>new Promise(resolve=>releases.push(resolve)));
 f.artist.subscribeArtwork(()=>notifications++);const ready=f.artist.ready({all:true});await tick();f.artist.dispose();await ready;
 for(const release of releases)release({width:2,height:2,close(){closes++;}});await tick();
 assert.equal(closes,releases.length);assert.ok(closes>=21);assert.equal(notifications,0);assert.equal(f.artist.cacheStats().frontStories.bytes,0);assert.equal(f.disposed,1);
});
test('actual catalog resolves Halloween preview without admitting it to gait playback',()=>{
 const {createPetCatalog}=require('../src/capabilities/companion/pet-catalog');const content=require('../src/content');
 const {SKINS}=require('../src/skins.mjs');const {previewAction}=require('../src/capabilities/companion/presentation/form-art.mjs');const {PET_FORMS}=require('../src/capabilities/companion/form-registry.mjs');
 const catalog=createPetCatalog({content,skins:SKINS});assert.ok(catalog.actions.some(x=>x.id===halloween.id));assert.equal(previewAction(PET_FORMS.dango,halloween.id),halloween);assert.equal(previewAction(PET_FORMS.usagi,halloween.id),null);
 assert.equal(previewAction(PET_FORMS.dango,'toString'),null);assert.equal(previewAction(PET_FORMS.dango,'unknown-action'),null);
 assert.equal(halloween.motionCaps.stepInPlace,undefined);assert.ok(catalog.appearances.filter(x=>Object.hasOwn(FRONT_STORY_GARMENTS,x.id)).every(x=>x.optInOnly));
});
