// Read-only evidence around the actual renderer. No substitute painter or aliases.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { COMPANION_ACTIVITY_STORIES } from '../../src/content/companion/activity-stories.mjs';
import { EXPRESSION_PHRASES } from '../../src/capabilities/companion/presentation/expression-phrases.mjs';
import { sampleActivityStory } from '../../src/capabilities/companion/presentation/activity-playback.mjs';
import { framePixels, traceDraw, sampleTimes } from './audit.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('canvas-package')) throw Error('Pass path to an already installed @napi-rs/canvas');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-frequency-audit'));
fs.mkdirSync(out, {recursive: true});
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = {createElement: () => backend.createCanvas(1, 1)}; globalThis.window = {devicePixelRatio: 2};
const source = await loadSource(pathToFileURL(root).href);
const fps = Number(arg('fps') || 24), diagnostics = [], cases = [], assets = new Set();
const selections = [
  ...['life.idle', 'work.focus', 'work.deep-focus', 'life.sleep'].map(id => ({kind: 'expression', id, duration: 12000})),
  ...['rest-nap', 'focus-type', 'focus-read'].map(id => ({kind: 'session', id, duration: source.sessions.SESSION_ACTIVITIES[id].durationMs})),
  ...['dance', 'type-keyboard'].map(id => ({kind: 'action', id, duration: source.behaviors.PET_ACTIONS[id].duration}))
];
const sha = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = [];
function collect(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), {withFileTypes: true})) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(relative);
    else if (/\.(m?js|json)$/.test(entry.name)) sourcePaths.push(relative);
  }
}
for (const directory of ['src/core', 'src/surfaces/pet', 'src/capabilities/companion/presentation', 'src/content/companion']) collect(directory);
sourcePaths.push('src/content/expressions.mjs', 'src/content/session-activities.mjs', 'src/content/behaviors.mjs', 'src/content/appearance.mjs', 'src/capabilities/companion/form-registry.mjs', 'assets/companion/dango/raster/dango.raster.mjs');
const sourceHashes = sourcePaths.sort().map(file => ({file, sha256: sha(fs.readFileSync(path.join(root, file)))}));
const sheet = backend.createCanvas(1500, 9 * 258 + 110), sheetCtx = sheet.getContext('2d');
sheetCtx.fillStyle = '#eef2ed'; sheetCtx.fillRect(0,0,sheet.width,sheet.height);
function label(text, x, y, size = 14, color = '#344941') { sheetCtx.fillStyle = color; sheetCtx.font = `${size}px sans-serif`; sheetCtx.fillText(text,x,y); }
label('DANGO / HIGH-FREQUENCY ACTUAL RENDERER AUDIT',20,30,23);
label('Normal runtime scale: 99 CSS px body design width / 219 CSS px stage; 2x device raster downsampled to CSS size',20,55,14);
label('Scarf row below each bare-body row. Session columns follow real story phases. All IDs are current production IDs.',20,77,14);
for (const [selectionIndex, selection] of selections.entries()) {
  const story = COMPANION_ACTIVITY_STORIES[selection.id], plan = sampleTimes(selection.duration, story, EXPRESSION_PHRASES[selection.id]?.[0], fps);
  const selected = selection.kind === 'session' ? source.sessions.SESSION_ACTIVITIES[selection.id]
    : selection.kind === 'action' ? source.behaviors.PET_ACTIONS[selection.id] : null;
  for (const view of ['front','three-quarter']) for (const outfit of [false,true]) {
    const harness = createRenderHarness(source, {skin:'pink',view,dpr:2,calm:false,blink:true,outfit:outfit?['milestone.scarf']:[]});
    harness.select(selection.kind, selection.id);
    const frames = [], key = `${selection.id}|${view}|${outfit?'scarf':'bare'}`;
    const hashes = new Set(), eyeMasks = new Set();
    let minOccupied = Infinity, maxEdge = 0, blankFrames = 0, edgeTouchFrames = 0;
    const bounds = {left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
    for (const at of plan.times) {
      let trace, result;
      if (plan.diagnostic.has(at)) { trace = traceDraw(harness,at,backend); result = trace.result; }
      else result = harness.draw(at);
      const pixels = framePixels(harness.body);
      hashes.add(pixels.hash); eyeMasks.add(result.state.currentRenderedEyeMask);
      minOccupied = Math.min(minOccupied,pixels.occupied); maxEdge = Math.max(maxEdge,pixels.edge);
      blankFrames += !pixels.occupied; edgeTouchFrames += !!pixels.edge;
      for (const side of ['left','top']) bounds[side]=Math.min(bounds[side],pixels.bounds[side]);
      for (const side of ['right','bottom']) bounds[side]=Math.max(bounds[side],pixels.bounds[side]);
      if (trace) {
        const sampled = sampleActivityStory(selected, (at / selection.duration) % 1);
        const report = {key,at,phase:sampled.phase, motion:sampled.action?.motion||'idle',prop:sampled.action?.prop||'none',
          propOpacity:sampled.action?.propOpacity??1, actualEyes:result.state.currentRenderedEyeMask,
          hash:pixels.hash, bounds:pixels.bounds, ...trace.counts, calls:trace.calls};
        diagnostics.push(report);
        for (const call of trace.calls) if(call.src) assets.add(call.src);
        if (trace.counts.faceClothOverlap || trace.counts.facePropOverlap || trace.counts.faceHandOverlap) {
          const name = `${selection.id}-${view}-${outfit?'scarf':'bare'}-${Math.round(at)}.png`;
          if (!fs.existsSync(path.join(out,name))) fs.writeFileSync(path.join(out,name),harness.body.toBuffer('image/png'));
        }
      }
      frames.push({at,hash:pixels.hash,occupied:pixels.occupied,edge:pixels.edge,actualEyes:result.state.currentRenderedEyeMask});
    }
    cases.push({key,kind:selection.kind,durationMs:selection.duration,view,outfit:outfit?['milestone.scarf']:[],fps,
      frames:frames.length,uniqueFrames:hashes.size,frozen:hashes.size<=1,minOccupied,maxEdge,blankFrames,edgeTouchFrames,bounds,
      eyeMasks:[...eyeMasks],storyBoundaries:plan.boundaries,diagnosticFrames:plan.diagnostic.size});
    fs.writeFileSync(path.join(out,`${key.replaceAll('|','-')}-frames.json`),JSON.stringify(frames));
    if(view==='front') {
      for(const [column,at] of plan.keyframes.entries()) {
        harness.draw(at);
        const x=18+column*246,y=110+selectionIndex*258+(outfit?115:0);
        sheetCtx.drawImage(harness.body,x,y-40,219,219);
        if(!outfit) {
          const sampled=sampleActivityStory(selected,at/selection.duration);
          label(`${selection.id} / ${(at/1000).toFixed(2)}s`,x+8,y+5,12);
          label(sampled.phase?.label || ['start','phrase','contact','release','recovery','tail'][column],x+8,y+20,11);
        }
      }
    }
    harness.dispose();
    console.log(JSON.stringify(cases.at(-1)));
  }
}
fs.writeFileSync(path.join(out,'normal-99css-keyframes.png'),sheet.toBuffer('image/png'));
const unavailable=['mirror-music','mirror-coding','mirror-ai','ai-chat'].map(id=>({id,
  inSessions:!!source.sessions.SESSION_ACTIVITIES[id],inActions:!!source.behaviors.PET_ACTIONS[id],
  result:'Not rendered or aliased; reserved semantic implementation absent from this checkout'}));
const extrema = key => diagnostics.reduce((best,row)=>row[key]>(best?.[key]??-1)?row:best,null);
const assetsHashed=[...assets].sort().map(url=>({file:path.relative(root,fileURLToPath(url)),sha256:sha(fs.readFileSync(fileURLToPath(url)))}));
const changedSources=sourceHashes.filter(item=>sha(fs.readFileSync(path.join(root,item.file)))!==item.sha256);
const report={renderer:'Actual createPetRenderer and production Dango raster artist; no replacement painter',
  scale:{cssPerArtUnit:1.5,bodyDesignWidthCssPx:99,stageCssPx:219,rasterPx:438,dpr:2},
  samples:cases.reduce((n,row)=>n+row.frames,0),diagnosticSamples:diagnostics.length,
  sampling:{continuousRunFps:fps,fullCycles:true,storyCyclesSampledAtLeast:16,
    boundariesMs:[-241,-220,-16.667,-1,0,1,16.667,220,240,241],
    note:'Finite offscreen samples; no claim that every continuous instant, native window, GPU, memory or compositor is verified'},
  outfitConstraint:{id:'milestone.scarf',renderKey:'scarf',maxItems:1},
  summary:{blankFrames:cases.reduce((n,r)=>n+r.blankFrames,0),edgeTouchFrames:cases.reduce((n,r)=>n+r.edgeTouchFrames,0),frozenCases:cases.filter(r=>r.frozen).map(r=>r.key),
    maxFaceClothOverlap:extrema('faceClothOverlap')?.faceClothOverlap,maxFacePropOverlap:extrema('facePropOverlap')?.facePropOverlap,
    maxFaceHandOverlap:extrema('faceHandOverlap')?.faceHandOverlap,maxClothPropOverlap:extrema('clothPropOverlap')?.clothPropOverlap,maxClothHandOverlap:extrema('clothHandOverlap')?.clothHandOverlap},
  overlapInterpretation:'Pixel mask intersection is geometric evidence, not automatic failure. Foreground tools or hands may intentionally overlap cloth; face overlap requires review. Counts are 2x device raster pixels at alpha >=16. Replay uses actual production drawImage transforms and opacity; selected cases do not use ground clipping.',
  cases,unavailable,sourceHashes,changedSources,assets:assetsHashed,
  artifacts:{keyframes:'normal-99css-keyframes.png',details:'diagnostics.json'},
  limitations:['Naked and single scarf only; other wardrobe combinations untested','Only pink material tested; no redesign or production modifications','Front and three-quarter full-cycle coverage; other views and left-facing pending supplementary sweep','Blink enabled with seeded scheduler; character timeline deterministic']};
fs.writeFileSync(path.join(out,'coverage.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2));
console.log(JSON.stringify({out,summary:report.summary,samples:report.samples,diagnosticSamples:report.diagnosticSamples,changedSources},null,2));
