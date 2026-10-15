import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
import { root, out } from './qa-paths.mjs';
const modes=['legacy','actual','omitLeft','omitRight','omitFootL','omitFootR','omitBootL','omitBootR'].concat(process.env.WORKOUT_QA_FAILURES === '1' ? ['failedLeft', 'failedRight'] : []);
const base=new URL('../',import.meta.url).pathname,work=out+'fixture';fs.mkdirSync(work,{recursive:true});
const url=p=>pathToFileURL(path.resolve(root,p)).href,imp=p=>import(url(p)),literal=JSON.stringify;
const backend=createRequire(root+'/package.json')('@napi-rs/canvas');const{installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={hidden:false,createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const redirect=(text,file,overrides={})=>text.replace(/from '([^']+)'/g,(_,ref)=>`from '${overrides[ref]||new URL(ref,pathToFileURL(file)).href}'`);
const artistFile=work+'/artists.mjs';fs.writeFileSync(artistFile,`
import{createRequire}from'node:module';
import{createDangoRasterArtist}from${literal(url('src/capabilities/companion/presentation/dango-raster-art.mjs'))};
import{DANGO_RASTER}from${literal(url('assets/companion/dango/raster/dango.raster.mjs'))};
import{createSourceDrawGuard}from${literal(new URL('./source-draw-guard.mjs', import.meta.url).href)};
import { loadLimbSource } from ${literal(url('tools/dango-limbs-qa.mjs'))};
import { DANGO_WALK_WORKBENCH } from ${literal(url('src/content/companion/gait/dango-walk.mjs'))};
const genericLimbsEnabled = process.env.WORKOUT_QA_LIMBS === '1';
const limbs = genericLimbsEnabled ? await loadLimbSource() : null;
const productionOptions = genericLimbsEnabled ? { limbs, runFootTiming: 'forward-recovery', walkPreview: { enabled: DANGO_WALK_WORKBENCH.enabled, workbench: true } } : {};
export const artistConfiguration = { genericLimbsEnabled, runFootTiming: genericLimbsEnabled ? 'forward-recovery' : null, walkAdapter: genericLimbsEnabled };
const{createCanvas,loadImage}=createRequire(${literal(root+'/package.json')})('@napi-rs/canvas');
export const traces={},manifests={},bodyCaches=new WeakMap(),failureAttempts={};
export const guard=createSourceDrawGuard({targets:['left','right'].map(side=>({id:side,spriteKey:'workout-front-support-v4-'+side,request:new URL('action-contact/workout-front-support-v4/'+side+'-8x.png',DANGO_RASTER.baseUrl),filePath:${literal(root+'/assets/companion/dango/raster/action-contact/workout-front-support-v4/')}+side+'-8x.png'})).concat(['left','right'].map(side=>({id:'foot-'+side,spriteKey:'foot-'+side,request:new URL('views/front/foot-'+side+'.png',DANGO_RASTER.baseUrl),filePath:${literal(root+'/assets/companion/dango/raster/views/front/')}+'foot-'+side+'.png'}))).concat(['left','right'].map(side=>({id:'boot-'+side,spriteKey:'boot-'+side,appearanceKey:'boots',request:new URL('wardrobe/boots-front-foot-'+side+'.png',DANGO_RASTER.baseUrl),filePath:${literal(root+'/assets/companion/dango/raster/wardrobe/')}+'boots-front-foot-'+side+'.png'}))),loadImage,createSurface:createCanvas});
export const omissions={omitLeft:guard.omit('left'),omitRight:guard.omit('right'),omitFootL:guard.omit('foot-left'),omitFootR:guard.omit('foot-right'),omitBootL:guard.omit('boot-left'),omitBootR:guard.omit('boot-right')};
function make(mode){const manifest=structuredClone(DANGO_RASTER);if(mode==='legacy')for(const side of ['left','right'])delete manifest.tools['workout-front-support-v4-'+side];else for(const side of ['left','right'])if(!manifest.tools['workout-front-support-v4-'+side]?.sourceContactPose?.runtimeReady)throw Error('Workout must be integrated into the real production manifest before this QA run');manifests[mode]=manifest;traces[mode]=[];
const loader=(omissions[mode]||guard).loadImage;
const failedSide=mode==='failedLeft'?'left':mode==='failedRight'?'right':null;
const artist=createDangoRasterArtist({...productionOptions,manifest,createSurface:createCanvas,loadImage:request=>{
 if(failedSide && new URL(request).pathname.endsWith('/workout-front-support-v4/'+failedSide+'-8x.png')) { failureAttempts[mode]=(failureAttempts[mode]||0)+1; return Promise.reject(new Error('Intentional '+failedSide+' workout PNG failure for real-limb fallback parity')); }
 return loader(request);
}});
return{...artist,body(ctx,...args){const result=artist.body(ctx,...args);bodyCaches.set(ctx.canvas,{mode,args:args.slice(0,2)});return result;},resolveArtwork(options){let art=artist.resolveArtwork(options);traces[mode].push(art);return art;}};}
export const artists=Object.fromEntries(${literal(modes)}.map(m=>[m,make(m)]));await Promise.all(Object.values(artists).map(a=>a.ready({all:true})));guard.assertLoaded();
`);
const commonPaths={compositor:'surfaces/pet/compositor.mjs',scene:'surfaces/pet/scene.mjs',effects:'surfaces/pet/effects.mjs',frame:'surfaces/pet/frame-context.mjs',forms:'capabilities/companion/form-registry.mjs',art:'core/pet-art.mjs',face:'core/pet-face.mjs',sceneArt:'core/pet-scene-art.mjs',motion:'core/pet-motion.mjs',sprite:'core/pet-sprite.mjs',expression:'core/pet-expression.mjs',appearance:'core/pet-appearance.mjs',expressions:'content/expressions.mjs',behaviors:'content/behaviors.mjs',sessions:'content/session-activities.mjs',scenes:'content/scenes.mjs',wardrobe:'content/appearance.mjs',skins:'skins.mjs',interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
const common=Object.fromEntries(await Promise.all(Object.entries(commonPaths).map(async([k,p])=>[k,await imp('src/'+p)]))),sources={};
for(const mode of modes){const adapter=work+'/artist-'+mode+'.mjs',form=work+'/form-'+mode+'.mjs',bridge=work+'/bridge-'+mode+'.mjs',renderer=work+'/renderer-'+mode+'.mjs';fs.writeFileSync(adapter,`import{artists}from${literal(pathToFileURL(artistFile).href)};export default artists.${mode};`);let fp=root+'/src/capabilities/companion/presentation/form-art.mjs';fs.writeFileSync(form,redirect(fs.readFileSync(fp,'utf8'),fp,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));fs.writeFileSync(bridge,`export * from ${literal(url('src/capabilities/companion/index.mjs'))};import * as formArt from ${literal(pathToFileURL(form).href)};export{formArt};`);let rp=root+'/src/surfaces/pet/renderer.mjs';fs.writeFileSync(renderer,redirect(fs.readFileSync(rp,'utf8'),rp,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));sources[mode]={...common,formArt:await import(pathToFileURL(form).href),renderer:await import(pathToFileURL(renderer).href)};}
const fixture=await import(pathToFileURL(artistFile).href),{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');

const directorModule=await imp('src/core/pet-presentation.mjs');
export { root, base, out, backend, sources, fixture, createRenderHarness, directorModule };
