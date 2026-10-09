// Offscreen evidence only: one production renderer per isolated subprocess.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createRenderHarness, loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { createStateCycleDriver, CYCLE_DURATION_MS, CYCLE_PHASES } from '../dango-state-cycle-preview/driver.mjs';
import { traceFrame, sha256 } from '../dango-state-cycle-preview/metrics.mjs';
import { makeMetrics, summarize } from './metrics.mjs';
const arg = name => process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const canvasPackage=arg('canvas-package');if(!canvasPackage)throw Error('Existing Skia path required');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.resolve(arg('out')||path.join(root,'dist/dango-wardrobe-review'));fs.mkdirSync(out,{recursive:true});
const part=arg('part');
export const SOURCE_FILES=[
 'src/surfaces/pet/renderer.mjs','src/surfaces/pet/frame-context.mjs','src/surfaces/pet/sleep-transition.mjs',
 'src/capabilities/companion/presentation/dango-raster-art.mjs','src/capabilities/companion/presentation/dango-raster-appearance.mjs',
 'src/capabilities/companion/presentation/dango-raster-production.mjs','src/capabilities/companion/presentation/dango-raster-pose.mjs',
 'src/capabilities/companion/presentation/dango-raster-face.mjs','src/capabilities/companion/presentation/dango-face.mjs',
 'src/content/appearance.mjs','src/content/expressions.mjs','assets/companion/dango/raster/dango.raster.mjs',
 'tools/usagi-gallery/runtime-harness.mjs','tools/dango-state-cycle-preview/driver.mjs','tools/dango-wardrobe-preview/metrics.mjs'];
if(!part) {
 for(const key of ['sunhat','sprout'])for(const view of ['main','front','mirrored','back'])for(const mode of ['cycle','run']) {
  const selected=`${key}_${view}_${mode}`;
  const result=spawnSync(process.execPath,[process.argv[1],...process.argv.slice(2),`--part=${selected}`],{stdio:'inherit'});
  if(result.status!==0)throw Error(`Capture batch ${selected} failed: ${result.status??result.signal}`);
 }
 const result=spawnSync(process.execPath,[path.join(root,'tools/dango-wardrobe-preview/assemble.mjs'),`--out=${out}`,`--canvas-package=${canvasPackage}`],{stdio:'inherit'});
 if(result.status!==0)throw Error(`Assembly failed: ${result.status??result.signal}`);
 process.exit(0);
}
const [key,viewName,mode]=part.split('_');
if(!['sunhat','sprout'].includes(key)||!['main','front','mirrored','back'].includes(viewName)||!['cycle','run'].includes(mode))throw Error('Unknown batch');
const backend=createRequire(import.meta.url)(canvasPackage);installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;
globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(pathToFileURL(root).href);
const production=(await import('../../src/capabilities/companion/presentation/dango-raster-production.mjs')).default;
const sourceHashes=SOURCE_FILES.map(file=>({file,sha256:sha256(fs.readFileSync(path.join(root,file)))}));
const view=['main','mirrored'].includes(viewName)?'three-quarter':viewName,facing=viewName==='mirrored'?-1:1;
const outfit=['milestone.scarf',`milestone.${key}`],options={skin:'pink',view,facing,outfit,blink:true,dpr:2};
const driver=mode==='cycle'?createStateCycleDriver(source,options):createRenderHarness(source,options);
if(mode==='run')driver.select('action','chase-laser');
const appearance=source.appearance.projectAppearance({skin:'pink',level:25,view,itemIds:outfit});
const action=source.behaviors.PET_ACTIONS['chase-laser'];
const artwork=production.resolveArtwork({view,appearance,action:mode==='run'?action:null,motion:mode==='run'?'dash':'idle',state:'idle',progress:.2,elapsedMs:1900});
if(!artwork.ready||artwork.clip)throw Error('Production artwork unavailable or unexpected clip');
if(mode==='run'&&view==='three-quarter'&&artwork.runFootTiming!=='forward-recovery')throw Error('Approved run foot timing was not retained for exact pair');
const fps=30,durationMs=mode==='cycle'?CYCLE_DURATION_MS:9500,frames=durationMs/1000*fps;
const rows=[],assets=new Map(),metrics=makeMetrics(backend),width=560,height=540;
const screen=backend.createCanvas(width,height),ctx=screen.getContext('2d');
function label(text,x,y,size=14,color='#52645f') {ctx.fillStyle=color;ctx.font=`${size}px sans-serif`;ctx.fillText(text,x,y);}
function paint(at,phase) {
 ctx.fillStyle='#eef2ed';ctx.fillRect(0,0,width,height);label(`${key.toUpperCase()} + SCARF`,24,31,23,'#263a3a');
 label(mode==='cycle'?'CONTINUOUS IDLE / FOCUS / SLEEP / WAKE':'CHASE LASER / ACCEPTED 950 ms STRIDE',24,55,13);
 ctx.fillStyle='white';ctx.fillRect(12,76,536,402);
 label('99 CSS px body width',28,110,13);label('2x / 198 px',318,110,13);
 ctx.strokeStyle='#ccd7ce';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(28,438);ctx.lineTo(532,438);ctx.stroke();
 ctx.drawImage(driver.body,-4,236,219,219);ctx.drawImage(driver.body,132,80,438,438);
 label(`${phase} / ${(at/1000).toFixed(2)} s / normal speed`,28,462,14,'#263a3a');
 label('Actual production painter / same body, live face and root',24,502,12);
 label('Fixed scale / offscreen Skia / existing art only',24,522,12);
}
let encoder,exited,error='';
if(viewName==='main') {
 encoder=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,`${part}.mp4`)],{stdio:['pipe','ignore','pipe']});
 encoder.stderr.on('data',chunk=>{error+=chunk;});exited=once(encoder,'exit');
}
const snapshots=mode==='cycle'?new Map([[90,'idle'],[237,'focus'],[570,'sleep'],[756,'wake']]):new Map([[45,'run'],[141,'run-recovery']]);
for(let frame=0;frame<frames;frame++) {
 const at=frame/fps*1000,trace=traceFrame(driver,at),phase=mode==='cycle'?trace.result.phase.label:'Run';
 const boundary=mode==='cycle'&&CYCLE_PHASES.some(p=>Math.abs(at-p.start)<=240);
 const row=metrics.measure(trace,driver.body,at,key,frame%15===0||boundary||snapshots.has(frame));
 Object.assign(row,{phase,expression:trace.result.state.currentExprId,eyeMask:trace.result.state.currentRenderedEyeMask});rows.push(row);
 if(!row.occupied||row.edge||row.wardrobeLayers!==4||!row.layerOrderCorrect||row.maxRootMatrixDifference>.00001||row.faceFrontOverlap||row.faceHeadOverlap||row.headFootOverlap)throw Error(`Production group or bounds failed ${part} at ${at}`);
 for(const c of trace.calls)if(c.src&&!assets.has(c.src))assets.set(c.src,{file:path.relative(root,fileURLToPath(c.src)),sha256:sha256(fs.readFileSync(fileURLToPath(c.src)))});
 if(snapshots.has(frame))fs.writeFileSync(path.join(out,`${key}_${viewName}_${snapshots.get(frame)}.png`),driver.body.toBuffer('image/png'));
 if(encoder){paint(at,phase);if(!encoder.stdin.write(screen.toBuffer('image/png')))await once(encoder.stdin,'drain');}
}
if(encoder){encoder.stdin.end();const[code]=await exited;if(code)throw Error(error);}
const changedSources=sourceHashes.filter(r=>sha256(fs.readFileSync(path.join(root,r.file)))!==r.sha256);if(changedSources.length)throw Error('Source changed during capture');
const report={part,key,requestedView:view,facing,mode,outfit,appearanceItems:appearance.items.map(i=>({id:i.id,group:i.exclusiveGroup})),
 actualArtworkView:artwork.view,drawnView:artwork.drawnView,runFootTiming:artwork.runFootTiming,clip:artwork.clip,
 fps,durationMs,frames,sourceHashes,changedSources,assets:[...assets.values()],summary:summarize(rows),transitions:driver.transitions||[],rows};
fs.writeFileSync(path.join(out,`evidence-${part}.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify({part,summary:report.summary,actualView:artwork.view,runFootTiming:artwork.runFootTiming}));
driver.dispose();metrics.dispose();
