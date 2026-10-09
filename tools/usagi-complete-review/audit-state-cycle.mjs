import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createStateCycleDriver, CYCLE_DURATION_MS } from '../dango-state-cycle-preview/driver.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const backend=createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend);
globalThis.Path2D=backend.Path2D;
globalThis.document={createElement:()=>backend.createCanvas(1,1)};
globalThis.window={devicePixelRatio:2};
const {loadSource}=await import('../usagi-gallery/runtime-harness.mjs');
const {pixels}=await import('../usagi-gallery/pixels.mjs');
const source=await loadSource(pathToFileURL(process.cwd()).href);
const out=path.resolve('dist/usagi-complete-review/state-cycle');
fs.mkdirSync(out,{recursive:true});
const records=[];
for(const look of [{id:'bare',itemIds:[]},...USAGI_OUTFIT_SETS]){
 const painter=createStateCycleDriver(source,{skin:'usagi',view:'front',outfit:look.itemIds});
 const screen=backend.createCanvas(660,520),ctx=screen.getContext('2d');
 const sheet=backend.createCanvas(1980,1560),sc=sheet.getContext('2d');
 const encoder=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,`${look.id}.mp4`)],{stdio:['pipe','ignore','pipe']});
 let error='';encoder.stderr.on('data',b=>{error+=b;});const exited=once(encoder,'exit');
 const snapshots=new Map([0,90,157,337,451,600,703,720,780].map((f,i)=>[f,i]));
 const frames=[];
 for(let frame=0;frame<CYCLE_DURATION_MS/1000*30;frame++){
  const at=frame*1000/30,result=painter.draw(at),p=pixels(painter.body);
  frames.push({at,phase:result.phase.label,expression:result.state.currentExprId,eye:result.state.currentRenderedEyeMask,occupied:p.occupied,edge:p.edge,hash:p.hash});
  if(!p.occupied||p.edge)throw Error(`Invalid cycle frame ${look.id}/${at}`);
  ctx.fillStyle='#eeeae2';ctx.fillRect(0,0,660,520);ctx.fillStyle='#3b2923';ctx.font='18px sans-serif';
  ctx.fillText(`${look.id} / continuous idle-focus-sleep-wake`,18,25);ctx.font='13px sans-serif';ctx.fillText(`${result.phase.label} / ${(at/1000).toFixed(2)}s / normal30fps`,18,48);
  for(const [x,y,m]of[[-2,210,1],[204,65,2]])ctx.drawImage(painter.body,x,y,painter.stage.cssWidth*m,painter.stage.cssHeight*m);
  ctx.fillText('99 CSS body width',24,474);ctx.fillText('198 CSS body width (2x)',360,474);ctx.fillText('One production renderer lifecycle / offscreen Skia',18,507);
  if(snapshots.has(frame)){const i=snapshots.get(frame);sc.drawImage(screen,i%3*660,Math.floor(i/3)*520);}
  if(!encoder.stdin.write(screen.toBuffer('image/png')))await once(encoder.stdin,'drain');
 }
 encoder.stdin.end();const[code]=await exited;if(code)throw Error(error);
 fs.writeFileSync(path.join(out,`${look.id}.png`),sheet.toBuffer('image/png'));
 const entry={id:look.id,items:look.itemIds,frames:frames.length,fps:30,durationMs:CYCLE_DURATION_MS,transitions:painter.transitions,rows:frames,visualStatus:'pending'};
 fs.writeFileSync(path.join(out,`${look.id}.json`),JSON.stringify(entry,null,2));records.push({id:look.id,frames:frames.length,transitions:painter.transitions,visualStatus:'pending'});
 painter.dispose();console.log(look.id,'continuous cycle',frames.length);
}
fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({renderer:'Actual production renderer with one unbroken lifecycle; offscreen Skia, not native desktop acceptance',records},null,2));
