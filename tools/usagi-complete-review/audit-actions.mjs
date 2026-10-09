// Finite diagnostic inventory using exact production renderer, real offscreen Canvas.
// No native desktop, loading safety or aesthetic acceptance is inferred by this tool.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { pixels, summarize } from '../usagi-gallery/pixels.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';
import { COMPANION_ACTIVITY_STORIES } from '../../src/content/companion/activity-stories.mjs';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const packagePath = arg('canvas-package');
if (!packagePath) throw new Error('Pass --canvas-package=/absolute/path/to/existing/@napi-rs/canvas');
const backend = require(packagePath);
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement(tag) { if (tag !== 'canvas') throw Error(tag); return backend.createCanvas(1, 1); } };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
let source = await loadSource(pathToFileURL(root).href);
if (process.argv.includes('--rig-supplement')) {
  const specs = [['idle','none','life.idle'],['curious','none','life.peek'],['sleep','blanket','life.sleep'],['chew','snack','react.satisfied']];
  const actions = Object.fromEntries(specs.map(([motion,prop,expression]) => { const id=`rig-${motion}`; return [id,{id,label:`Diagnostic rig ${motion}`,motion,prop,expression,duration:3200}]; }));
  source = {...source, behaviors:{...source.behaviors,PET_ACTIONS:actions}};
}
const out = path.resolve(arg('out') || path.join(root, 'dist/usagi-complete-review/actions'));
fs.mkdirSync(out, { recursive: true });
const viewNames = ['front', 'three-quarter', 'profile', 'back'];
const kindFilter = arg('kind');
const outfit = USAGI_OUTFIT_SETS.find(item => item.id === arg('outfit'));
if (arg('outfit') && !outfit) throw Error('Unknown curated outfit');
if (process.argv.includes('--video')) {
  const records=[];
  const catalog=[...Object.values(source.behaviors.PET_ACTIONS).map(item=>({kind:'action',item})),...Object.values(source.sessions.SESSION_ACTIVITIES).map(item=>({kind:'session',item}))]
    .filter(j=>(!kindFilter||j.kind===kindFilter)&&(!arg('ids')||arg('ids').split(',').includes(j.item.id)));
  const sourceFiles=['src/capabilities/companion/presentation/usagi-contact.mjs','src/capabilities/companion/presentation/face-choreography.mjs','src/surfaces/pet/action-playback.mjs','src/surfaces/pet/renderer.mjs'];
  const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  const fps=30,width=660,height=500;
  for(const {kind,item} of catalog){
    const harness=createRenderHarness(source,{skin:'usagi',outfit:outfit?.itemIds||false,view:'auto',dpr:2});
    const selected=harness.select(kind,item.id),duration=selected.duration,frames=Math.ceil(duration/1000*fps);
    const file=`${kind}-${item.id}.mp4`,screen=backend.createCanvas(width,height),ctx=screen.getContext('2d');
    const encoder=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,file)],{stdio:['pipe','ignore','pipe']});
    let error='';encoder.stderr.on('data',data=>{error+=data;});const finished=once(encoder,'exit');
    for(let n=0;n<frames;n++){
      const at=n/fps*1000;harness.draw(at);ctx.fillStyle=arg('background')==='dark'?'#17232d':'#eef3f3';ctx.fillRect(0,0,width,height);
      ctx.fillStyle='#263e4a';ctx.font='15px sans-serif';ctx.fillText(`${kind}: ${item.id} | ${(at/1000).toFixed(2)}/${duration/1000}s`,10,20);
      ctx.drawImage(harness.body,0,129,219,219);ctx.drawImage(harness.body,220,28,438,438);
      ctx.font='12px sans-serif';ctx.fillText('Body design width 99 CSS px',10,373);ctx.fillText('Body design width 198 CSS px',230,480);
      const sampled=source.formArt.sampleAction?.(harness.form,item,at/duration)||{action:item};
      ctx.fillText(`${sampled.action.motion||'idle'} / ${sampled.action.prop||'none'}${sampled.phase?` / phase ${sampled.phase.index+1}`:''}`,10,397);
      ctx.font='9px sans-serif';ctx.fillText('Production Canvas / Offscreen Skia / 30fps / native desktop not verified',10,494);
      const rgba=ctx.getImageData(0,0,width,height).data;
      if(!encoder.stdin.write(Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)))await once(encoder.stdin,'drain');
    }
    encoder.stdin.end();const [code]=await finished;if(code)throw Error(error);
    records.push({kind,id:item.id,file,frames,fps,durationMs:duration,outfit:outfit?.id||'bare',view:'auto',bodyWidthsCSS:[99,198],byteLength:fs.statSync(path.join(out,file)).size});
    fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),renderer:'Offscreen Skia / exact production createPetRenderer',sourceHashes,records,limitations:['Encoded normal-speed video, not native desktop acceptance','No memory risk test','Playback aesthetic approval remains separate from encoding success']},null,2));
    console.log(`${records.length}/${catalog.length} ${kind} ${item.id}: ${frames} frames`);harness.dispose();screen.width=screen.height=1;
  }
  process.exit(0);
}
const jobs = [];
for (const item of Object.values(source.behaviors.PET_ACTIONS)) jobs.push({ kind: 'action', id: item.id, view: 'auto', group: 'action', times: [.02,.18,.35,.5,.68,.85].map(p=>p*item.duration) });
for (const item of source.expressions.EXPRESSIONS) for (const view of ['front','three-quarter','profile','back']) jobs.push({kind:'expression',id:item.id,view,group:`expression-${view}`,times:[0,200,550,1300,2400,3900]});
for (const [id, story] of Object.entries(COMPANION_ACTIVITY_STORIES)) {
  let start = 0; const duration = source.sessions.SESSION_ACTIVITIES[id].durationMs;
  story.stages.forEach((stage,index) => {
    const end = stage.until;
    jobs.push({kind:'session',id,view:'auto',group:`session-${id}`,phase:index,phaseLabel:stage.label,motion:stage.motion,prop:stage.prop,
      times:[.04,.2,.4,.6,.8,.96].map(p=>(start+(end-start)*p/Math.max(1,stage.cycles))*duration)});
    start=end;
  });
}
for (const id of ['umbrella-dance','moonwalk','sip-tea','look-around','telescope','mirror-meet','catch-star']) for (const view of viewNames) {
  const item = source.behaviors.PET_ACTIONS[id];
  if (!item) continue;
  jobs.push({kind:'action',id,view,group:`views-${id}`,times:[.02,.18,.35,.5,.68,.85].map(p=>p*item.duration)});
}
if (process.argv.includes('--rig-supplement')) for (const item of Object.values(source.behaviors.PET_ACTIONS)) for (const view of viewNames) jobs.push({kind:'action',id:item.id,view,group:`views-${item.id}`,times:[.02,.18,.35,.5,.68,.85].map(p=>p*item.duration)});
const selected=jobs.filter(j=>(!kindFilter||j.kind===kindFilter)&&(!outfit||j.kind!=='expression')&&(!arg('ids')||arg('ids').split(',').includes(j.id)));
if (arg('phases')) for (const job of selected) { const item = source.behaviors.PET_ACTIONS[job.id]; if (item) job.times = arg('phases').split(',').map(Number).map(p => p * item.duration); }
const manifest={generatedAt:new Date().toISOString(),backend:'Offscreen Skia via exact production createPetRenderer / real Path2D',bodyWidthCSS:99,stageCSS:219,dpr:2,outfit:outfit||null,
  limits:['No native Electron/GPU/desktop acceptance','Changed pixels are not semantic or aesthetic approval','No memory risk tests'],inventory:{actions:Object.keys(source.behaviors.PET_ACTIONS),expressions:source.expressions.EXPRESSIONS.map(i=>i.id),stories:COMPANION_ACTIVITY_STORIES},entries:[],errors:[]};
const pages=new Map();
for (const job of selected) {
  const key=`${job.id}${job.phase===undefined?'':`-phase${job.phase+1}`}-${job.view}`;
  const options={skin:'usagi',outfit:outfit?.itemIds||false,view:job.view,dpr:2,blink:false};
  const harness=createRenderHarness(source,options);
  try {
    const entry=harness.select(job.kind,job.id);
    const file=`${job.group}/${key}.png`,expandedFile=`${job.group}/${key}-2x.png`;
    fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});
    const normal=backend.createCanvas(1320,254), expanded=backend.createCanvas(2640,474);
    const nc=normal.getContext('2d'), ec=expanded.getContext('2d');
    for(const [ctx,c] of [[nc,normal],[ec,expanded]]){ctx.fillStyle=arg('background')==='dark'?'#17232d':'#eef3f3';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#263e4a';ctx.font='14px sans-serif';ctx.fillText(`${job.id} ${job.view}${job.phase===undefined?'':` phase ${job.phase+1}`} ${job.phaseLabel||''} | body ${c===normal?99:198} CSS px`,10,18);}
    const samples=[];
    for(const [index,at] of job.times.entries()){
      harness.draw(at);
      const sample=pixels(harness.body);
      samples.push({atMs:at,hash:sample.hash,occupied:sample.occupied,edge:sample.edge,bounds:sample.bounds});
      nc.drawImage(harness.body,index*220,25,219,219);
      ec.drawImage(harness.body,index*440,25,438,438);
      for(const [ctx,w] of [[nc,220],[ec,440]]){ctx.fillStyle='#647885';ctx.font='11px sans-serif';ctx.fillText(`${Math.round(at)}ms`,index*w+5,w+29);}
    }
    fs.writeFileSync(path.join(out,file),normal.toBuffer('image/png'));
    fs.writeFileSync(path.join(out,expandedFile),expanded.toBuffer('image/png'));
    const viewOptions={action:['action','session'].includes(job.kind)?entry.item:null,state:entry.item.state||'idle'};
    const resolvedView=source.formArt.resolveView?.(harness.form,job.view,viewOptions)||(job.view==='auto'?source.appearance.derivePetView(viewOptions):job.view);
    manifest.entries.push({...job,resolvedView,file,expandedFile,summary:summarize(samples),samples,visualReview:'pending'});
    const groupRows=pages.get(job.group)||[];groupRows.push({file,key});pages.set(job.group,groupRows);
    normal.width=normal.height=expanded.width=expanded.height=1;
    console.log(`${manifest.entries.length}/${selected.length} ${key}`);
  } catch(error){manifest.errors.push({job,error:error.stack});console.error(error.stack);} finally{harness.dispose();}
}
for(const [group,rows] of pages){
  for(let page=0;page<Math.ceil(rows.length/5);page++){
    const pageRows=rows.slice(page*5,page*5+5),sheet=backend.createCanvas(1320,pageRows.length*254),ctx=sheet.getContext('2d');
    for(const [index,row] of pageRows.entries()){const img=await backend.loadImage(path.join(out,row.file));ctx.drawImage(img,0,index*254);}
    const file=`${group}-page${page+1}.png`;fs.writeFileSync(path.join(out,file),sheet.toBuffer('image/png'));
    manifest.contactSheets??=[];manifest.contactSheets.push({group,file,entries:pageRows.map(row=>row.key)});sheet.width=sheet.height=1;
  }
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Completed ${manifest.entries.length} finite sequences, ${manifest.errors.length} errors.`);
if(manifest.errors.length)process.exitCode=1;
