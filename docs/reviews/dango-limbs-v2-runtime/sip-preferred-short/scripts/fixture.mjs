import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Test-only port substitution. Production renderer, form space, action playback,
// timeline, cup contact, and paint passes remain the repository's real modules.
export async function createLifecycleFixture(root, output, { allowEnabled = false } = {}) {
  const url = p => pathToFileURL(path.resolve(root, p)).href;
  const imp = p => import(url(p));
  const backend = createRequire(path.join(root, 'package.json'))('@napi-rs/canvas');
  const { installOffscreenImages } = await imp('tools/usagi-gallery/offscreen-images.mjs');
  installOffscreenImages(backend);
  globalThis.Path2D = backend.Path2D;
  globalThis.document = { hidden: false, createElement: () => backend.createCanvas(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
  const keys = Object.entries(DANGO_RASTER.tools).filter(([key, sprite]) =>
    key.startsWith('sip-front-short-v1') || sprite.sourceContactPose?.id === 'sip-front-short-v1').map(([key]) => key);
  if (keys.length !== 2) throw Error(`Waiting for exactly two sip-front-short-v1 tools; found ${keys.length}`);
  if (!allowEnabled && keys.some(key => DANGO_RASTER.tools[key].sourceContactPose?.runtimeReady !== false)) {
    throw Error('Expected disabled production short-source gates; use --allow-enabled only after authorized integration.');
  }
  const work = path.join(output, 'fixture'); fs.mkdirSync(work, { recursive: true });
  const literal = value => JSON.stringify(value);
  const artistFile = path.join(work, 'artists.mjs');
  fs.writeFileSync(artistFile, `
import {createDangoRasterArtist} from ${literal(url('src/capabilities/companion/presentation/dango-raster-art.mjs'))};
import {DANGO_RASTER} from ${literal(url('assets/companion/dango/raster/dango.raster.mjs'))};
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {createCanvas,loadImage}=createRequire(${literal(path.join(root, 'package.json'))})('@napi-rs/canvas');
const keys=${literal(keys)}, base=structuredClone(DANGO_RASTER), enabled=structuredClone(DANGO_RASTER);
for(const key of keys){base.tools[key].sourceContactPose.runtimeReady=false;enabled.tools[key].sourceContactPose.runtimeReady=true;}
const oldImages=Object.fromEntries(await Promise.all(['left','right'].map(async side=>[side,await loadImage(${literal(path.join(root,'assets/companion/dango/raster/action-contact/sip-front-v1'))}+'/'+side+'-logical.png')])));
export const traces={old:[],integrated:[]}, originals={};
function make(mode,manifest){
 const artist=createDangoRasterArtist({manifest,createSurface:createCanvas,loadImage:u=>loadImage(fileURLToPath(u))});
 originals[mode]=artist;
 return {...artist,resolveArtwork(options){
  let art=artist.resolveArtwork(options);
  if(mode==='old'&&options.action?.id==='sip-tea'&&art.view==='front'&&!(options.appearance?.items||[]).length&&options.state!=='dragged'){
   const cup=art.contact?.tools.find(t=>t.key==='cup');
   if(cup)art={...art,sourceContactPose:'forced-preferred-diagnostic',limbPainter:{paint(ctx,{hand,layer,covered}){
    if(layer!=='front'||covered)return false;
    ctx.save();ctx.imageSmoothingEnabled=false;ctx.globalAlpha*=hand.opacity??1;
    ctx.drawImage(oldImages[hand.side],cup.x-23,cup.y-43,66,72);ctx.restore();return true;
   }},contact:{...art.contact,hands:art.contact.hands.map(h=>({...h,limb:true}))}};
  }
  const cup=art.contact?.tools.find(t=>t.key==='cup');
  traces[mode].push({actionId:options.action?.id||null,progress:options.progress,elapsedMs:options.elapsedMs,
   instance:options.actionInstanceKey,view:art.view,channel:options.channel,calm:Boolean(options.calmVisual),
   phase:options.action?.sequencePhase||null,propOpacity:options.action?.propOpacity??1,
   recovery:options.action?.handoffRecovery??null,source:art.sourceContactPose||null,ready:art.ready,
   bodyKey:art.key,cup:cup?structuredClone(cup):null,body:art.data.body,
   hands:(art.contact?.hands||[]).map(h=>({side:h.side,opacity:h.opacity??1,pawSprite:h.pawSprite||null,
    pawMatrix:h.pawMatrix||null,sourceContact:h.sourceContact||null,points:h.points})),
   details:art.contact?.details||[],sourceHands:(art.contact?.hands||[]).filter(h=>h.sourceContact?.sourcePoseId==='sip-front-short-v1').length});
  return art;
 }};
}
export const artists={old:make('old',base),integrated:make('integrated',enabled)};
await Promise.all(Object.values(artists).map(a=>a.ready({all:true})));
`);
  const redirect = (text, file, overrides) => text.replace(/from '([^']+)'/g,
    (_, ref) => `from '${overrides[ref] || new URL(ref, pathToFileURL(file)).href}'`);
  const formPath = path.join(root, 'src/capabilities/companion/presentation/form-art.mjs');
  const renderPath = path.join(root, 'src/surfaces/pet/renderer.mjs');
  const paths = { compositor: 'surfaces/pet/compositor.mjs', scene: 'surfaces/pet/scene.mjs', effects: 'surfaces/pet/effects.mjs',
    frame: 'surfaces/pet/frame-context.mjs', forms: 'capabilities/companion/form-registry.mjs', art: 'core/pet-art.mjs',
    face: 'core/pet-face.mjs', sceneArt: 'core/pet-scene-art.mjs', motion: 'core/pet-motion.mjs', sprite: 'core/pet-sprite.mjs',
    expression: 'core/pet-expression.mjs', appearance: 'core/pet-appearance.mjs', expressions: 'content/expressions.mjs',
    behaviors: 'content/behaviors.mjs', sessions: 'content/session-activities.mjs', scenes: 'content/scenes.mjs',
    wardrobe: 'content/appearance.mjs', skins: 'skins.mjs', interactionPlayback:'surfaces/pet/interaction-playback.mjs' };
  const common = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k,p]) => [k,await imp('src/'+p)])));
  const sources = {};
  for (const mode of ['old','integrated']) {
    const adapter = path.join(work, `artist-${mode}.mjs`), form = path.join(work, `form-${mode}.mjs`);
    const bridge = path.join(work, `bridge-${mode}.mjs`), renderer = path.join(work, `renderer-${mode}.mjs`);
    fs.writeFileSync(adapter, `import {artists} from ${literal(pathToFileURL(artistFile).href)}; export default artists.${mode};\n`);
    fs.writeFileSync(form, redirect(fs.readFileSync(formPath,'utf8'),formPath,{'./dango-raster-production.mjs':pathToFileURL(adapter).href}));
    fs.writeFileSync(bridge, `export * from ${literal(url('src/capabilities/companion/index.mjs'))}; import * as formArt from ${literal(pathToFileURL(form).href)}; export {formArt};\n`);
    fs.writeFileSync(renderer, redirect(fs.readFileSync(renderPath,'utf8'),renderPath,{'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));
    const implementation = await import(pathToFileURL(renderer).href);
    const controls=[];
    // Replay the renderer's actual public clear command on host hide/policy reset.
    sources[mode]={...common,formArt:await import(pathToFileURL(form).href),controls,renderer:{...implementation,
      createPetRenderer(options){const real=implementation.createPetRenderer(options),control={resetNext:false};controls.push(control);
        return {executeFrame(frame,command,args){if(control.resetNext){real.executeFrame(frame,'clearDecorativeParticles');control.resetNext=false;}return real.executeFrame(frame,command,args);}};
      }}};
  }
  const fixture=await import(pathToFileURL(artistFile).href);
  const {createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
  return {backend,sources,fixture,keys,createRenderHarness,productionGateState:keys.map(k=>({key:k,runtimeReady:DANGO_RASTER.tools[k].sourceContactPose.runtimeReady})),
    dispose(){for(const artist of Object.values(fixture.artists))artist.dispose();}};
}
