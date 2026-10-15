import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setupCapture,observeArtist} from './observe-draws.mjs';
import {setArtists} from './artist-registry.mjs';

export function argumentsForRun() {
  const read=name=>{const direct=process.argv.find(a=>a.startsWith('--'+name+'='));if(direct)return direct.slice(name.length+3);const i=process.argv.indexOf('--'+name);return i<0?null:process.argv[i+1];};
  const repo=read('repo'),output=read('out');
  if(!repo||!output)throw Error('Pass --repo PATH and --out EXTERNAL_DIRECTORY');
  const root=path.resolve(repo),out=path.resolve(output);
  if(out===root||out.startsWith(root+path.sep))throw Error('--out must be outside the repository');
  const dpr=Number(read('dpr')||1);assert.ok([1,1.25,1.5,2].includes(dpr),'Unsupported DPR');
  return {root,out,dpr,smoke:process.argv.includes('--smoke')};
}

export async function createFixture({root,out}) {
fs.mkdirSync(out,{recursive:true});
const url=p=>pathToFileURL(path.resolve(root,p)).href,imp=p=>import(url(p));
const {READ_BOOK_SPRITES}=await imp('src/capabilities/companion/presentation/read-book-contact-sprites.mjs');
const {READ_BOOK_CONTACT_KEYS}=await imp('src/capabilities/companion/presentation/dango-read-book-contact-pose.mjs');
const backend=createRequire(root+'/package.json')('@napi-rs/canvas');
const {installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');
installOffscreenImages(backend);setupCapture(backend.createCanvas,READ_BOOK_SPRITES);
globalThis.Path2D=backend.Path2D;
globalThis.document={hidden:false,createElement:()=>backend.createCanvas(1,1)};
globalThis.window={devicePixelRatio:2};
const{createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');const{DANGO_RASTER}=await imp('assets/companion/dango/raster/dango.raster.mjs');const{createSourceDrawGuard,normalizeLocalImageRequest}=await import('./source-draw-guard.mjs');
const guard=createSourceDrawGuard({targets:Object.entries(READ_BOOK_SPRITES).map(([spriteKey,s])=>({id:spriteKey,spriteKey,request:new URL(s.src,DANGO_RASTER.baseUrl),filePath:root+'/assets/companion/dango/raster/'+s.src})),createSurface:backend.createCanvas,loadImage:u=>backend.loadImage(normalizeLocalImageRequest(u))});
const optionsByMode={};
const controls={left:guard.omit(READ_BOOK_CONTACT_KEYS.left.front),right:guard.omit(READ_BOOK_CONTACT_KEYS.right.front)},manifests={},traces={},artists={};
for(const mode of ['actual','left','right','legacy']){
 const manifest=structuredClone(DANGO_RASTER);if(mode==='legacy')for(const key of Object.keys(READ_BOOK_SPRITES))delete manifest.tools[key];manifests[mode]=manifest;traces[mode]=[];
 const artist=observeArtist(createDangoRasterArtist({manifest,createSurface:backend.createCanvas,loadImage:mode==='actual'?guard.loadImage:controls[mode]?.loadImage|| (u=>backend.loadImage(normalizeLocalImageRequest(u)))}));
 artists[mode]={...artist,resolveArtwork(o){const art=artist.resolveArtwork(o);traces[mode].push(art);optionsByMode[mode]=o;return art;}};
 await artists[mode].ready({all:true});
}
guard.assertLoaded();
setArtists(artists);
const registryUrl=new URL('./artist-registry.mjs',import.meta.url);
const redirect=(text,file,overrides)=>text.replace(/from '([^']+)'/g,(_,ref)=>`from '${overrides[ref]||new URL(ref,pathToFileURL(file)).href}'`);
const commonPaths={compositor:'surfaces/pet/compositor.mjs',scene:'surfaces/pet/scene.mjs',effects:'surfaces/pet/effects.mjs',frame:'surfaces/pet/frame-context.mjs',forms:'capabilities/companion/form-registry.mjs',art:'core/pet-art.mjs',face:'core/pet-face.mjs',sceneArt:'core/pet-scene-art.mjs',motion:'core/pet-motion.mjs',sprite:'core/pet-sprite.mjs',expression:'core/pet-expression.mjs',appearance:'core/pet-appearance.mjs',expressions:'content/expressions.mjs',behaviors:'content/behaviors.mjs',sessions:'content/session-activities.mjs',scenes:'content/scenes.mjs',wardrobe:'content/appearance.mjs',skins:'skins.mjs',interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
const common=Object.fromEntries(await Promise.all(Object.entries(commonPaths).map(async([k,p])=>[k,await imp('src/'+p)]))),sources={};
for(const mode of Object.keys(artists)){
 const dir=path.join(out,'fixture')+'/',adapter=dir+'adapter-'+mode+'.mjs',form=dir+'form-'+mode+'.mjs',bridge=dir+'bridge-'+mode+'.mjs',renderer=dir+'renderer-'+mode+'.mjs';
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(adapter,`import{getArtist}from'${registryUrl.href}';export default getArtist('${mode}');`);
 const fp=root+'/src/capabilities/companion/presentation/form-art.mjs';fs.writeFileSync(form,redirect(fs.readFileSync(fp,'utf8'),fp,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));
 fs.writeFileSync(bridge,`export * from '${url('src/capabilities/companion/index.mjs')}';import * as formArt from '${pathToFileURL(form).href}';export{formArt};`);
 const rp=root+'/src/surfaces/pet/renderer.mjs';fs.writeFileSync(renderer,redirect(fs.readFileSync(rp,'utf8'),rp,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));
 sources[mode]={...common,formArt:await import(pathToFileURL(form).href),renderer:await import(pathToFileURL(renderer).href)};
}

return {root,out,imp,backend,common,sources,artists,manifests,traces,optionsByMode,guard,controls,READ_BOOK_CONTACT_KEYS};
}
