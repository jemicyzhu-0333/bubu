import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
export async function createSweepFixture(root, out, options={}) {
 const url=p=>pathToFileURL(path.resolve(root,p)).href, imp=p=>import(url(p));
 const backend=createRequire(root+'/package.json')('@napi-rs/canvas');
 const {installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');installOffscreenImages(backend);
 globalThis.Path2D=backend.Path2D;globalThis.document={hidden:false,createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
 const work=path.join(out,'fixture');fs.mkdirSync(work,{recursive:true});
 const redirect=(text,file,overrides={})=>text.replace(/from '([^']+)'/g,(_,ref)=>`from '${overrides[ref]||new URL(ref,pathToFileURL(file)).href}'`);
 const base=path.dirname(new URL(import.meta.url).pathname);
 const selectorPath=path.join(root,'src/capabilities/companion/presentation/dango-source-contact-pose.mjs');
 const selectorFile=selectorPath,artistFile=path.join(root,'src/capabilities/companion/presentation/dango-raster-art.mjs');
 const allArtists=path.join(work,'artists.mjs');
 fs.writeFileSync(allArtists,`
 import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
 import {createDangoRasterArtist} from '${pathToFileURL(artistFile).href}';
 import {DANGO_RASTER} from '${url('assets/companion/dango/raster/dango.raster.mjs')}';
 import {loadLimbSource} from '${url('tools/dango-limbs-qa.mjs')}';
 import {createSourceDrawGuard} from '${pathToFileURL(base+'/source-draw-guard.mjs').href}';
 const {createCanvas,loadImage}=createRequire(${JSON.stringify(root+'/package.json')})('@napi-rs/canvas');
 const limb=await loadLimbSource();
 const manifest=structuredClone(DANGO_RASTER);
 const key='sweep-quarter-grip-v1-right',src=manifest.tools[key].src;
 export const guard=createSourceDrawGuard({targets:[{id:'grip',spriteKey:key,request:new URL(src,manifest.baseUrl),filePath:${JSON.stringify(root+'/assets/companion/dango/raster/action-contact/sweep-quarter-grip-v1/right-8x.png')}}],loadImage,createSurface:createCanvas});
 export const omission=guard.omit('grip'),manifests={},originals={},traces={},artists={};
 const waiting=[];export const controls={fault:${JSON.stringify(options.fault||null)},releaseTarget(){controls.fault=null;for(const resume of waiting.splice(0))resume();}};
 for(const mode of ['current','candidate','omitted','body_only','palm_only','rod_only']){
  const m=structuredClone(manifest);m.tools[key].sourceContactPose.runtimeReady=mode!=='current';manifests[mode]=m;
  const loader=mode==='omitted'?omission.loadImage:guard.loadImage;
  const a=createDangoRasterArtist({manifest:m,createSurface:createCanvas,loadImage:async u=>{
   if(controls.fault==='fail'&&String(u).includes(src))throw Error('injected sweep image failure');
   if(controls.fault==='late'&&String(u).includes(src))await new Promise(resolve=>waiting.push(resolve));
   const image=await loader(u);
   if(!['body_only','palm_only','rod_only'].includes(mode))return image;
   const keep=mode==='body_only'?String(u).includes('/views/three-quarter-right/body.png'):mode==='palm_only'?String(u).includes(src):String(u).includes('/tools/broom.png');
   return keep?image:createCanvas(image.width,image.height);
  },limbs:limb});originals[mode]=a;
  artists[mode]={...a,resolveArtwork(o){const art=a.resolveArtwork(o);traces[mode]={art,options:o};return art;}};
 }
 export const readyAll=Promise.all(Object.values(artists).map(a=>a.ready({all:true})));
 if(controls.fault==='late'){await Promise.all(Object.values(artists).map(a=>a.ready()));while(Object.values(artists).some(a=>a.cacheStats().source.loading>1))await new Promise(r=>setTimeout(r,5));}else await readyAll;
 export function cleanup(){for(const a of Object.values(originals))a.dispose();}
 `);
 const paths={compositor:'surfaces/pet/compositor.mjs',scene:'surfaces/pet/scene.mjs',effects:'surfaces/pet/effects.mjs',frame:'surfaces/pet/frame-context.mjs',forms:'capabilities/companion/form-registry.mjs',art:'core/pet-art.mjs',face:'core/pet-face.mjs',sceneArt:'core/pet-scene-art.mjs',motion:'core/pet-motion.mjs',sprite:'core/pet-sprite.mjs',expression:'core/pet-expression.mjs',appearance:'core/pet-appearance.mjs',expressions:'content/expressions.mjs',behaviors:'content/behaviors.mjs',sessions:'content/session-activities.mjs',scenes:'content/scenes.mjs',wardrobe:'content/appearance.mjs',skins:'skins.mjs',interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
 const common=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([k,p])=>[k,await imp('src/'+p)])));
 const sources={};
 const formPath=path.join(root,'src/capabilities/companion/presentation/form-art.mjs'),rendererPath=path.join(root,'src/surfaces/pet/renderer.mjs');
 for(const mode of ['current','candidate','omitted','body_only','palm_only','rod_only']){
  const adapter=path.join(work,mode+'-adapter.mjs'),form=path.join(work,mode+'-form.mjs'),bridge=path.join(work,mode+'-bridge.mjs'),renderer=path.join(work,mode+'-renderer.mjs');
  fs.writeFileSync(adapter,`import {artists} from '${pathToFileURL(allArtists).href}';export default artists.${mode};`);
  fs.writeFileSync(form,redirect(fs.readFileSync(formPath,'utf8'),formPath,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));
  fs.writeFileSync(bridge,`export * from '${url('src/capabilities/companion/index.mjs')}';import * as formArt from '${pathToFileURL(form).href}';export {formArt};`);
  fs.writeFileSync(renderer,redirect(fs.readFileSync(rendererPath,'utf8').replace('  formArt.drawActionLayer(pctx, {', `  globalThis.captureSweepTransform?.(${JSON.stringify(mode)}, {matrix: [...['a','b','c','d','e','f'].map(k=>pctx.getTransform()[k])], offX, offY, bodyScale:geo.bodySize/form.bodySize, now:runtimeState.animNow});\n  formArt.drawActionLayer(pctx, {`),rendererPath,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));
  const implementation=await import(pathToFileURL(renderer).href),controls=[];
  sources[mode]={...common,controls,formArt:await import(pathToFileURL(form).href),renderer:{...implementation,createPetRenderer(options){const real=implementation.createPetRenderer(options),control={resetNext:false};controls.push(control);return {executeFrame(frame,command,args){if(!command)control.lastFrame=JSON.parse(JSON.stringify(frame));if(control.resetNext){real.executeFrame(frame,'clearDecorativeParticles');control.resetNext=false;}return real.executeFrame(frame,command,args);}};}}};
 }
 const fixture=await import(pathToFileURL(allArtists).href),{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
 return {backend,sources,fixture,createRenderHarness,selector:await import(pathToFileURL(selectorFile).href),createArtist:(await import(pathToFileURL(artistFile).href)).createDangoRasterArtist,dispose:fixture.cleanup};
}
