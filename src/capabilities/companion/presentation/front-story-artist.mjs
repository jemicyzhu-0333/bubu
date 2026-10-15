import {FRONT_STORY_ASSETS as A} from '../../../../assets/companion/dango/front-stories/assets.mjs';
import {FRONT_STORY_GARMENTS as GARMENTS} from '../../../content/companion/front-stories.mjs';
import {createRasterSource} from './raster/source.mjs';
import {createRasterPainter} from './raster/paint.mjs';
import {sampleFrontStory,storyResourceKeys} from './front-story-sample.mjs';
const CLOTH_KEYS=Object.freeze(['hat','lapels','cape']);
const garment=appearance=>(appearance?.items||[]).filter(item=>Object.hasOwn(GARMENTS,item.id));
const spriteKeys=Object.keys(A.sprites);

// Narrow companion artist adapter: no timers, state writes, category inference or new renderer responsibility.
function createFrontStoryArtist(base,{loadImage,createSurface,sourceOptions={},painterOptions={}}={}) {
 const source=createRasterSource({baseUrl:A.baseUrl,versionKey:A.version,maxEntries:32,maxBytes:16*1024*1024,...sourceOptions,loadImage});
 const painter=createRasterPainter({source,createSurface,maxEntries:16,maxBytes:8*1024*1024,...painterOptions});
 let disposed=false;
 const strip=appearance=>appearance?{...appearance,items:appearance.items.filter(item=>!Object.hasOwn(GARMENTS,item.id))}:appearance;
 const paint=(context,key,palette,x=0,y=0,opacity=1)=>painter.paint(context,A.sprites[key],palette,[1,0,0,1,x,y],opacity);
 function resolveArtwork(options={}) {
  const requested=options.view||'front',view=base.resolveView(requested,options);
  const story=sampleFrontStory(options.action,options.progress,options);
  const admitted=Boolean(story&&view==='front'&&requested==='front'&&options.state!=='dragged');
  // Request the full selected group even if its first entry is not yet ready.
  const storyStates=admitted?storyResourceKeys(story.kind).map(key=>source.state(A.sprites[key])):[];
  const selected=admitted&&!disposed&&storyStates.every(state=>state==='ready');
  const clothes=garment(options.appearance);
  const clothStates=clothes.length&&view==='front'?CLOTH_KEYS.map(key=>source.state(A.sprites[key])):[];
  const clothesReady=clothes.length>0&&view==='front'&&!disposed&&clothStates.every(state=>state==='ready');
  let input={...options,appearance:strip(options.appearance)};
  if(selected){
   const original=options.action,combination=original.activityCombination;
   const neutral={...original,id:'dango-front-neutral-pose',motion:'idle',prop:'none',effect:'none',motionCaps:{},
    ...(combination?{activityCombination:{...combination,primary:'dango-front-neutral-pose',extras:combination.extras.filter(key=>key!=='robot')}}:{})};
   const expected=original.baseExpression||original.expression;
   const ownsFace=!options.expressionId||!expected||options.expressionId===expected;
   const face=ownsFace?{...options.face,eyes:story.phase==='greet'?'smile':'neutral',
    mouth:story.phase==='greet'||story.phase==='acknowledge'?'talk':'neutral',openness:1,
    eyeOffsetX:story.kind==='ai'?1:0,eyeOffsetY:story.kind==='ai'?.3:0}:options.face;
   input={...input,action:neutral,motion:'idle',face};
  }
  const artwork=base.resolveArtwork(input);
  return Object.freeze({...artwork,frontStory:selected?story:null,
   frontStoryStatus:!story?'inactive':!admitted?'unsupported-view':selected?'ready':storyStates.includes('failed')?'failed':'loading',
   frontStoryOriginalAction:selected?options.action:null,frontStoryClothesReady:clothesReady,
   frontStoryClothes:Object.freeze(clothes.map(item=>item.id))});
 }
 return Object.freeze({...base,resolveArtwork,
  action(context,options){
   // A full cape belongs behind the separated feet, not merely behind the torso.
   // The normal wardrobe-back pass runs after anatomy, so place this authored rear panel here.
   const rear=options.layer==='back'&&options.artwork?.frontStoryClothesReady
    &&options.artwork.frontStoryClothes.includes('seasonal.plum-cape')&&!disposed
    ?paint(context,'cape',options.palette):false;
   const painted=base.action(context,options)||rear,story=options.artwork?.frontStory;
   if(!story||options.layer!=='front'||disposed)return painted;
   let added=false;for(const item of story.layers)added=paint(context,item.key,options.palette,item.x,item.y,item.opacity)||added;
   return added||painted;
  },
  applyMotionTransform(context,motion,progress,options){
   if(options?.artwork?.frontStory)return;
   return base.applyMotionTransform(context,motion,progress,options);
  },
  appearance(context,options){
   const key=GARMENTS[options.item?.id];if(!key)return base.appearance(context,options);
   const view=options.artwork?.view||options.view;
   if(disposed||view!=='front'||!options.artwork?.frontStoryClothesReady)return false;
   if(key==='pumpkin-beret')return options.layer==='front'&&paint(context,'hat',options.palette);
   return options.layer==='back'?(Boolean(options.fit)&&paint(context,'cape',options.palette)):paint(context,'lapels',options.palette);
  },
  appearanceLayers(item,view){return GARMENTS[item?.id]?view==='front'?item.parts:[]:base.appearanceLayers(item,view);},
  portraitBounds(appearance){
   const bounds=base.portraitBounds(strip(appearance));if(!garment(appearance).length)return bounds;
   return Object.freeze({x:Math.min(bounds.x,-5),y:Math.min(bounds.y,-10),
    width:Math.max(bounds.x+bounds.width,71)-Math.min(bounds.x,-5),
    height:Math.max(bounds.y+bounds.height,66)-Math.min(bounds.y,-10)});
  },
  ready(options={}){return Promise.all([base.ready(options),options.all?source.ready(spriteKeys.map(key=>A.sprites[key])):Promise.resolve()]);},
  subscribeArtwork(listener){const a=base.subscribeArtwork(listener),b=source.subscribe(listener);return()=>{a();b();};},
  cacheStats(){return Object.freeze({...base.cacheStats(),frontStories:source.stats(),frontStoryPalette:painter.stats()});},
  dispose(){if(disposed)return;disposed=true;source.dispose();painter.dispose();base.dispose();}
 });
}

export { createFrontStoryArtist };
