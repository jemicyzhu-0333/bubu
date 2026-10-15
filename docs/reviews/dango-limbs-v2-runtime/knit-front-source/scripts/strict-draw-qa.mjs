import{root,out as outputRoot}from'./qa-paths.mjs';
import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
const out=outputRoot+'/',work=out+'evidence/strict-guard-renderer-fixture';fs.mkdirSync(work,{recursive:true});
const url=p=>pathToFileURL(path.resolve(root,p)).href,imp=p=>import(url(p));const backend=createRequire(root+'/package.json')('@napi-rs/canvas');const{installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={hidden:false,createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};

const literal=JSON.stringify,artistFile=work+'/artists.mjs';fs.writeFileSync(artistFile,`
import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
import{createDangoRasterArtist}from${literal(url('src/capabilities/companion/presentation/dango-raster-art.mjs'))};
import{DANGO_RASTER}from${literal(url('assets/companion/dango/raster/dango.raster.mjs'))};
const{createCanvas,loadImage}=createRequire(${literal(root+'/package.json')})('@napi-rs/canvas');
import{createSourceDrawGuard}from${literal(new URL('./source-draw-guard.mjs',import.meta.url).href)};
export const traces={actual:[],left:[],right:[]};export const manifests={};
export const guard=createSourceDrawGuard({targets:['left','right'].map(side=>({id:side,spriteKey:'knit-front-round-v2-'+side,request:new URL('action-contact/knit-front-round-v2/'+side+'-8x.png',DANGO_RASTER.baseUrl),filePath:${literal(root+'/assets/companion/dango/raster/action-contact/knit-front-round-v2/')}+side+'-8x.png'})),createSurface:createCanvas,loadImage:u=>loadImage(String(u).includes('/knit-front-round-v2/')?${literal(root+'/assets/companion/dango/raster/action-contact/knit-front-round-v2/')}+String(u).split('/').at(-1):u)});
export const controls={left:guard.omit('left'),right:guard.omit('right')};
function make(mode){
 const manifest=structuredClone(DANGO_RASTER);manifests[mode]=manifest;

 const artist=createDangoRasterArtist({manifest,createSurface:createCanvas,loadImage:mode==='actual'?guard.loadImage:controls[mode].loadImage});
 return{...artist,resolveArtwork(options){
  let art=artist.resolveArtwork(options);
  // The actual production artist invokes the registered selector itself.
  traces[mode].push({artwork:art,id:options.action?.id||null,progress:options.progress,view:art.view,source:art.sourceContactPose||null,ready:art.ready,body:art.data.body,tools:art.contact?.tools||[],details:art.contact?.details||[],hands:art.contact?.hands||[]});return art;
 }};
}
export const artists={actual:make('actual'),left:make('left'),right:make('right')};await Promise.all(Object.values(artists).map(a=>a.ready({all:true})));
`);
const redirect=(text,file,overrides)=>text.replace(/from '([^']+)'/g,(_,ref)=>`from '${overrides[ref]||new URL(ref,pathToFileURL(file)).href}'`);
const commonPaths={compositor:'surfaces/pet/compositor.mjs',scene:'surfaces/pet/scene.mjs',effects:'surfaces/pet/effects.mjs',frame:'surfaces/pet/frame-context.mjs',forms:'capabilities/companion/form-registry.mjs',art:'core/pet-art.mjs',face:'core/pet-face.mjs',sceneArt:'core/pet-scene-art.mjs',motion:'core/pet-motion.mjs',sprite:'core/pet-sprite.mjs',expression:'core/pet-expression.mjs',appearance:'core/pet-appearance.mjs',expressions:'content/expressions.mjs',behaviors:'content/behaviors.mjs',sessions:'content/session-activities.mjs',scenes:'content/scenes.mjs',wardrobe:'content/appearance.mjs',skins:'skins.mjs',interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
const common=Object.fromEntries(await Promise.all(Object.entries(commonPaths).map(async([k,p])=>[k,await imp('src/'+p)])));const sources={};for(const mode of['actual','left','right']){let adapter=work+'/artist-'+mode+'.mjs',form=work+'/form-'+mode+'.mjs',bridge=work+'/bridge-'+mode+'.mjs',renderer=work+'/renderer-'+mode+'.mjs';fs.writeFileSync(adapter,`import{artists}from${literal(pathToFileURL(artistFile).href)};export default artists.${mode};`);let fp=root+'/src/capabilities/companion/presentation/form-art.mjs';fs.writeFileSync(form,redirect(fs.readFileSync(fp,'utf8'),fp,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));fs.writeFileSync(bridge,`export * from ${literal(url('src/capabilities/companion/index.mjs'))};import * as formArt from ${literal(pathToFileURL(form).href)};export{formArt};`);let rp=root+'/src/surfaces/pet/renderer.mjs';fs.writeFileSync(renderer,redirect(fs.readFileSync(rp,'utf8'),rp,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));sources[mode]={...common,formArt:await import(pathToFileURL(form).href),renderer:await import(pathToFileURL(renderer).href)};}
const fixture=await import(pathToFileURL(artistFile).href);
const{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
const report=[];
fixture.guard.assertLoaded();
for(const skin of ['pink','ocean','moon'])for(const dpr of[1,1.25,1.5,2])for(const facing of[1,-1])for(const calmVisual of[false,true]){
 const pairs={};const opts={skin,outfit:false,dpr,blink:false,facing,calm:calmVisual};
 for(const mode of ['actual','left','right']){
  const h=createRenderHarness(sources[mode],{...opts,expressionFor:s=>common.behaviors.PET_ACTIONS[s.currentEgg?.id]?.expression||'life.idle'});h.select('expression','life.idle');
  const egg={...common.interactionPlayback.createManualActionPlayback(common.behaviors,'knit-scarf',{formId:'dango'}),presentationEventId:'knit-guard-'+JSON.stringify(opts)};
  h.updateState({renderChannel:'pet',facing,calmVisual,currentEgg:egg,actionStartedAt:0,devPreview:null,appearanceItemIds:[]});pairs[mode]=h;
 }
 fixture.guard.observeFinalStage(pairs.actual.body);for(const side of ['left','right'])fixture.controls[side].observeFinalStage(pairs[side].body);
 for(let i=0;i<=32;i++){
  const now=i*12000/32,frames={};for(const [mode,h]of Object.entries(pairs)){const f=h.draw(now);frames[mode]=JSON.parse(JSON.stringify({at:now,state:f.state,stage:f.stage,current:f.current,options:opts}));}
  for(const side of['left','right'])report.push(fixture.guard.assertContribution({targetId:side,stage:pairs.actual.body,omittedStage:pairs[side].body,artwork:fixture.traces.actual.at(-1).artwork,omittedArtwork:fixture.traces[side].at(-1).artwork,renderInputs:{manifest:fixture.manifests.actual,frame:frames.actual},omittedRenderInputs:{manifest:fixture.manifests[side],frame:frames[side]},label:JSON.stringify({...opts,now})}));
  for(const t of Object.values(fixture.traces))t.length=0;if(i%8===0)await new Promise(r=>setImmediate(r));
 }
 for(const h of Object.values(pairs))h.dispose();
}
fs.writeFileSync(out+'evidence/strict-source-draw-guard.json',JSON.stringify({actualProduction:true,selectionRoute:'Unchanged production artist, selector, manifest and PNGs; only one decoded source image is made transparent per omission control',report,loads:fixture.guard.snapshot()},null,2));console.log({passed:report.length,minContribution:Math.min(...report.map(r=>r.changedPixels))});
for(const a of Object.values(fixture.artists))a.dispose();
