import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
export async function createHiccupFixture(root, out) {
 const url=p=>pathToFileURL(path.resolve(root,p)).href, imp=p=>import(url(p));
 const backend=createRequire(root+'/package.json')('@napi-rs/canvas');
 const {installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');installOffscreenImages(backend);
 globalThis.Path2D=backend.Path2D;globalThis.document={hidden:false,createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
 const work=path.join(out,'fixture');fs.mkdirSync(work,{recursive:true});
 const redirect=(text,file,overrides={})=>text.replace(/from '([^']+)'/g,(_,ref)=>`from '${overrides[ref]||new URL(ref,pathToFileURL(file)).href}'`);
 const allArtists=path.join(work,'artists.mjs');
 fs.writeFileSync(allArtists,`
 import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
 import {createDangoRasterArtist} from '${url('src/capabilities/companion/presentation/dango-raster-art.mjs')}';
 import {DANGO_RASTER} from '${url('assets/companion/dango/raster/dango.raster.mjs')}';
 import {loadLimbSource} from '${url('tools/dango-limbs-qa.mjs')}';
 const {createCanvas,loadImage}=createRequire(${JSON.stringify(root+'/package.json')})('@napi-rs/canvas');
 const limb=await loadLimbSource();
 const baseline=structuredClone(DANGO_RASTER);
 for(const key of ['hiccup-quarter-near-v1','hiccup-quarter-far-v1']){
  if(!baseline.tools[key]?.sourceContactPose)throw new Error('Integrated hiccup quarter source is missing: '+key);
  baseline.tools[key].sourceContactPose.runtimeReady=false;
 }
 const image=u=>loadImage(fileURLToPath(u));
 export const originals={},traces={current:[],forced:[],candidate:[],far_omitted:[]},artists={};
 for(const mode of ['current','forced','candidate','far_omitted']){
  const a=createDangoRasterArtist({manifest:['candidate','far_omitted'].includes(mode)?DANGO_RASTER:baseline,createSurface:createCanvas,loadImage:image,limbs:limb});originals[mode]=a;
  artists[mode]={...a,resolveArtwork(o){let art=a.resolveArtwork({...o,channel:'pet'});
   if(mode==='forced'&&o.action?.id==='hiccup'&&art.view==='three-quarter')art={...art,contact:{...art.contact,hands:art.contact.hands.map(h=>({...h,limb:false}))}};
   if(mode==='far_omitted'&&art.sourceContactPose==='hiccup-quarter-pair-v1')art={...art,contact:{...art.contact,hands:art.contact.hands.filter(h=>h.side!=='right')}};
   traces[mode].push({action:o.action?.id||null,progress:o.progress,view:art.view,source:art.sourceContactPose||null,ready:art.ready,body:art.data.body,contact:art.contact,instance:o.actionInstanceKey,calm:o.calmVisual});
   return art;
  }};
 }
 await Promise.all(Object.values(artists).map(a=>a.ready({all:true})));
 export function cleanup(){for(const a of Object.values(originals))a.dispose();}
 `);
 const paths={compositor:'surfaces/pet/compositor.mjs',scene:'surfaces/pet/scene.mjs',effects:'surfaces/pet/effects.mjs',frame:'surfaces/pet/frame-context.mjs',forms:'capabilities/companion/form-registry.mjs',art:'core/pet-art.mjs',face:'core/pet-face.mjs',sceneArt:'core/pet-scene-art.mjs',motion:'core/pet-motion.mjs',sprite:'core/pet-sprite.mjs',expression:'core/pet-expression.mjs',appearance:'core/pet-appearance.mjs',expressions:'content/expressions.mjs',behaviors:'content/behaviors.mjs',sessions:'content/session-activities.mjs',scenes:'content/scenes.mjs',wardrobe:'content/appearance.mjs',skins:'skins.mjs',interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
 const common=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([k,p])=>[k,await imp('src/'+p)])));
 const sources={};
 const formPath=path.join(root,'src/capabilities/companion/presentation/form-art.mjs'),rendererPath=path.join(root,'src/surfaces/pet/renderer.mjs');
 for(const mode of ['current','forced','candidate','far_omitted']){
  const adapter=path.join(work,mode+'-adapter.mjs'),form=path.join(work,mode+'-form.mjs'),bridge=path.join(work,mode+'-bridge.mjs'),renderer=path.join(work,mode+'-renderer.mjs');
  fs.writeFileSync(adapter,`import {artists} from '${pathToFileURL(allArtists).href}';export default artists.${mode};`);
  fs.writeFileSync(form,redirect(fs.readFileSync(formPath,'utf8'),formPath,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));
  fs.writeFileSync(bridge,`export * from '${url('src/capabilities/companion/index.mjs')}';import * as formArt from '${pathToFileURL(form).href}';export {formArt};`);
  fs.writeFileSync(renderer,redirect(fs.readFileSync(rendererPath,'utf8'),rendererPath,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));
  const implementation=await import(pathToFileURL(renderer).href),controls=[];
  sources[mode]={...common,controls,formArt:await import(pathToFileURL(form).href),renderer:{...implementation,createPetRenderer(options){const real=implementation.createPetRenderer(options),control={resetNext:false};controls.push(control);return {executeFrame(frame,command,args){if(control.resetNext){real.executeFrame(frame,'clearDecorativeParticles');control.resetNext=false;}return real.executeFrame(frame,command,args);}};}}};
 }
 const fixture=await import(pathToFileURL(allArtists).href),{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
 return {backend,sources,fixture,createRenderHarness,dispose:fixture.cleanup};
}
