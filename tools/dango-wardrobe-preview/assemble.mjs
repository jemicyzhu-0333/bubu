import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { sha256 } from '../dango-state-cycle-preview/metrics.mjs';
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const out=path.resolve(arg('out')||'dist/dango-wardrobe-review'),backend=createRequire(import.meta.url)(arg('canvas-package'));
const reports=[];
for(const key of ['sunhat','sprout'])for(const view of ['main','front','mirrored','back'])for(const mode of ['cycle','run'])reports.push(JSON.parse(fs.readFileSync(path.join(out,`evidence-${key}_${view}_${mode}.json`))));
if(reports.some(r=>JSON.stringify(r.sourceHashes)!==JSON.stringify(reports[0].sourceHashes)))throw Error('Production source differs between batches');
const video=path.join(out,'dango-existing-wardrobe.mp4');
function command(name,args){const p=spawnSync(name,args,{encoding:'utf8'});if(p.status)throw Error(p.stderr||`${name} failed`);return p.stdout;}
command('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y',...['sunhat_main_cycle','sprout_main_cycle','sunhat_main_run','sprout_main_run'].flatMap(f=>['-i',path.join(out,`${f}.mp4`)]),'-filter_complex','[0:v][1:v]hstack=inputs=2[cycle];[2:v][3:v]hstack=inputs=2[run];[cycle][run]concat=n=2:v=1:a=0[v]','-map','[v]','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',video]);
const bytes=fs.statSync(video).size;if(bytes>8*1024*1024)throw Error('Video exceeds8MiB');
const probe=JSON.parse(command('/usr/bin/ffprobe',['-v','quiet','-print_format','json','-show_format','-show_streams',video]));
command('/usr/bin/ffmpeg',['-v','error','-i',video,'-f','null','-']);
function sheet(width,height){const canvas=backend.createCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#eef2ed';ctx.fillRect(0,0,width,height);return{canvas,ctx};}
function label(ctx,text,x,y,size=14,color='#52645f'){ctx.fillStyle=color;ctx.font=`${size}px sans-serif`;ctx.fillText(text,x,y);}
async function cell(ctx,key,view,state,x,y,w=420,h=380){
 ctx.fillStyle=view==='mirrored'?'#23302c':'white';ctx.fillRect(x+6,y,w-12,h-8);
 const color=view==='mirrored'?'#e6efe8':'#263a3a';
 label(ctx,`${key.toUpperCase()} + SCARF / ${state.toUpperCase()}`,x+18,y+26,14,color);
 label(ctx,'99 CSS px body',x+18,y+49,12,color);label(ctx,'2x',x+279,y+49,12,color);
 const image=await backend.loadImage(path.join(out,`${key}_${view}_${state==='run'?'run-recovery':state}.png`));
 ctx.drawImage(image,x-30,y+140,219,219);ctx.drawImage(image,x+50,y+41,438,438);
}
const proof=sheet(1680,882);label(proof.ctx,'EXISTING WARDROBE / ACTUAL PRODUCTION KEYFRAMES',22,32,23,'#263a3a');
label(proof.ctx,'Original body and face / shared root / accepted run foot timing / fixed runtime scale',22,58);
for(const[row,key]of ['sunhat','sprout'].entries())for(const[col,state]of ['idle','focus','sleep','run'].entries())await cell(proof.ctx,key,'main',state,col*420,80+row*390);
label(proof.ctx,'99/198 px describe body design width, not full character height. No art changes or synthetic viewpoints.',22,869,12);
fs.writeFileSync(path.join(out,'wardrobe-keyframes.png'),proof.canvas.toBuffer('image/png'));
for(const key of ['sunhat','sprout']){
 const views=sheet(1680,1310);label(views.ctx,`${key.toUpperCase()} + SCARF / FRONT, 3/4, MIRROR, BACK`,22,32,23,'#263a3a');
 label(views.ctx,'Actual existing views. Mirror is runtime facing=-1, not a separate authored left view.',22,58);
 for(const[row,state]of ['idle','focus','sleep'].entries())for(const[col,view]of ['front','main','mirrored','back'].entries()){
  const y=100+row*396;await cell(views.ctx,key,view,state,col*420,y,420,386);
  label(views.ctx,{front:'FRONT',main:'THREE-QUARTER',mirrored:'MIRRORED THREE-QUARTER',back:'BACK / NO FACE'}[view],col*420+18,y-8,12);
 }
 label(views.ctx,'Back chase-laser resolves to semantic three-quarter; no back run is invented. Explicit authored three-quarter-left has no wardrobe.',22,1298,11);
 fs.writeFileSync(path.join(out,`${key}-views.png`),views.canvas.toBuffer('image/png'));
}
const runViews=sheet(1680,900);label(runViews.ctx,'CHASE-LASER / ACTUAL VIEW ROUTING',22,32,23,'#263a3a');
label(runViews.ctx,'Front: existing pose. 3/4 and mirror: accepted foot timing. Back request: semantic 3/4 fallback, legacy timing.',22,58);
for(const[row,key]of ['sunhat','sprout'].entries())for(const[col,view]of ['front','main','mirrored','back'].entries()){
 const y=106+row*390;await cell(runViews.ctx,key,view,'run',col*420,y,420,378);
 label(runViews.ctx,{front:'FRONT',main:'THREE-QUARTER',mirrored:'RUNTIME MIRROR',back:'BACK REQUEST -> THREE-QUARTER'}[view],col*420+18,y-8,12);
}
label(runViews.ctx,'Back state views are supported. This action has no authored back run. No synthetic left-authored or back-running pose.',22,886,12);
fs.writeFileSync(path.join(out,'wardrobe-run-views.png'),runViews.canvas.toBuffer('image/png'));
const summary={frames:reports.reduce((n,r)=>n+r.frames,0),diagnosticSamples:reports.reduce((n,r)=>n+r.summary.diagnosticSamples,0)};
for(const name of ['blankFrames','edgeFrames','incompleteGroups','layerOrderFailures'])summary[name]=reports.reduce((n,r)=>n+r.summary[name],0);
for(const name of ['maxRootMatrixDifference','maxFaceFrontOverlap','maxFaceHeadOverlap','maxHeadFootOverlap'])summary[name]=Math.max(...reports.map(r=>r.summary[name]));
summary.minVisibleHeadPixels=Math.min(...reports.map(r=>r.summary.minVisibleHeadPixels));
summary.minHeadFootVerticalGapCss=Math.min(...reports.map(r=>r.summary.minHeadFootVerticalGapCss));
const evidence={renderer:'Actual createPetRenderer via existing gallery harness; continuous state-cycle driver retained per state batch',
 captureBatches:reports.map(r=>r.part),scale:{bodyDesignWidthCssPx:99,enlargedBodyWidthPx:198,stageCssPx:219,rasterPx:438,dpr:2},
 video:{filename:path.basename(video),bytes,sha256:sha256(fs.readFileSync(video)),ffprobe:probe,decodePassed:true},
 sourceHashes:reports[0].sourceHashes,summary,cases:reports.map(({rows,...r})=>r),
 assets:[...new Map(reports.flatMap(r=>r.assets).map(a=>[a.file,a])).values()],
 limitations:['Offscreen painter evidence only; no native-window, browser-compositor, GPU, memory or full-wardrobe acceptance claim',
 'Two selected exact pairs only; no art redesign', 'State cycle selected existing expressions, not automatic wake scheduling',
 'State-cycle and chase-laser are separate retained-renderer segments at normal playback speed',
 'Front chase-laser uses its existing front pose; back requests resolve to semantic three-quarter. Accepted foot timing stays limited to reviewed three-quarter/profile requests',
 'Mirrored three-quarter uses runtime facing=-1; explicit three-quarter-left authored wardrobe is unsupported and never substituted']};
fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({out,videoBytes:bytes,summary},null,2));
