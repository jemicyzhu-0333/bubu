import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
export async function fixture(root,out,{candidate=null,forceFront=false}={}){
 const url=p=>pathToFileURL(path.resolve(root,p)).href, imp=p=>import(url(p));
 const backend=createRequire(path.join(root,'package.json'))('@napi-rs/canvas');
 const {installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');installOffscreenImages(backend);
 globalThis.Path2D=backend.Path2D;globalThis.document={hidden:false,createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
 const work=path.join(out,'fixture');fs.mkdirSync(work,{recursive:true});
 const redirect=(text,file,overrides={})=>text.replace(/from '([^']+)'/g,(_,ref)=>`from '${overrides[ref]||new URL(ref,pathToFileURL(file)).href}'`);
 const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs'), limbs=await loadLimbSource();
 const {DANGO_RASTER}=await imp('assets/companion/dango/raster/dango.raster.mjs');
 const factories={legacy:(await imp('src/capabilities/companion/presentation/dango-raster-art.mjs')).createDangoRasterArtist};
 const artists={},traces={};
 for(const mode of Object.keys(factories)){
  const baseline=structuredClone(DANGO_RASTER);for(const side of['left','right'])baseline.tools['knit-front-round-v2-'+side].sourceContactPose.runtimeReady=false;
  const base=factories[mode]({manifest:baseline,limbs,loadImage:u=>backend.loadImage(fileURLToPath(u)),createSurface:backend.createCanvas});
  traces[mode]=[];artists[mode]={...base,resolveArtwork(options){let art=base.resolveArtwork(options);traces[mode].push({options,art});return art;}};
 }
 if(candidate){traces.candidate=[];artists.candidate=await candidate({backend,limbs,manifest:DANGO_RASTER,createArtist:factories.legacy,createLegacyArtist:factories.legacy,trace:(options,art)=>traces.candidate.push({options,art})});}
 await Promise.all(Object.values(artists).map(a=>a.ready({all:true})));
 const key=`knitFixture${Date.now()}`;globalThis[key]=artists;
 const paths={compositor:'surfaces/pet/compositor.mjs',scene:'surfaces/pet/scene.mjs',effects:'surfaces/pet/effects.mjs',frame:'surfaces/pet/frame-context.mjs',forms:'capabilities/companion/form-registry.mjs',art:'core/pet-art.mjs',face:'core/pet-face.mjs',sceneArt:'core/pet-scene-art.mjs',motion:'core/pet-motion.mjs',sprite:'core/pet-sprite.mjs',expression:'core/pet-expression.mjs',appearance:'core/pet-appearance.mjs',expressions:'content/expressions.mjs',behaviors:'content/behaviors.mjs',sessions:'content/session-activities.mjs',scenes:'content/scenes.mjs',wardrobe:'content/appearance.mjs',skins:'skins.mjs',interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
 const common=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([k,p])=>[k,await imp('src/'+p)]))),sources={};
 const formPath=path.join(root,'src/capabilities/companion/presentation/form-art.mjs'),renderPath=path.join(root,'src/surfaces/pet/renderer.mjs');
 for(const mode of Object.keys(artists)){
  const adapter=path.join(work,`artist-${mode}.mjs`),form=path.join(work,`form-${mode}.mjs`),bridge=path.join(work,`bridge-${mode}.mjs`),renderer=path.join(work,`renderer-${mode}.mjs`);
  fs.writeFileSync(adapter,`export default globalThis[${JSON.stringify(key)}].${mode};`);
  const formSource=fs.readFileSync(formPath,'utf8');
  if(!formSource.includes('context.drawImage(sprite, bounds.x, bounds.y, bounds.width, bounds.height);'))throw Error('Production final-body draw hook changed');
  fs.writeFileSync(form,redirect(formSource.replace('context.drawImage(sprite, bounds.x, bounds.y, bounds.width, bounds.height);','globalThis.__knitObserveBody?.(context, sprite, [bounds.x, bounds.y, bounds.width, bounds.height]); context.drawImage(sprite, bounds.x, bounds.y, bounds.width, bounds.height);'),formPath,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));
  fs.writeFileSync(bridge,`export * from ${JSON.stringify(url('src/capabilities/companion/index.mjs'))};import * as formArt from ${JSON.stringify(pathToFileURL(form).href)};export {formArt};`);
  fs.writeFileSync(renderer,redirect(fs.readFileSync(renderPath,'utf8'),renderPath,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));
  sources[mode]={...common,renderer:await import(pathToFileURL(renderer).href),formArt:await import(pathToFileURL(form).href)};
 }
 return {root,out,backend,limbs,artists,traces,sources,createRenderHarness:(await imp('tools/usagi-gallery/runtime-harness.mjs')).createRenderHarness,dispose(){for(const a of Object.values(artists))a.dispose();delete globalThis[key];}};
}
