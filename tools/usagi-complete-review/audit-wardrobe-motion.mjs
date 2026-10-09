import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { USAGI_INTERACTION_PAIRS } from './review-matrix.mjs';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const { pixels } = await import('../usagi-gallery/pixels.mjs');
const source=await loadSource(pathToFileURL(process.cwd()).href);
const {USAGI_OUTFIT_SETS}=await import('../../src/content/companion/usagi-wardrobe.mjs');
const items=source.wardrobe.PET_APPEARANCE_ITEMS.filter(x=>x.formId==='usagi');
const looks=items.map(x=>({id:x.id,itemIds:[x.id],action:x.exclusiveGroup==='usagi.footwear'?'moonwalk':x.exclusiveGroup==='usagi.sidebag'?'umbrella-dance':['usagi.headwear','usagi.earwear','usagi.aura'].includes(x.exclusiveGroup)?'happy-hop':'wave'}));
looks.push(...USAGI_OUTFIT_SETS.map(x=>({...x,action:x.id==='rain-walk'?'umbrella-dance':x.id==='moon-post'?'moonwalk':'plant-water'})));
const out=path.resolve(arg('out')||'dist/usagi-complete-review/wardrobe-motion');fs.mkdirSync(out,{recursive:true});
const records=[];const fps=30;
for(const look of process.argv.includes('--only-pairs') ? USAGI_INTERACTION_PAIRS : looks){
 const view=look.action==='wave'?'front':'three-quarter';
 const painter=createRenderHarness(source,{skin:'usagi',view,dpr:2,blink:true,outfit:look.itemIds});
 const selected=painter.select('action',look.action),count=Math.ceil(selected.duration/1000*fps);
 const screen=backend.createCanvas(660,520),ctx=screen.getContext('2d');
 const sheet=backend.createCanvas(1980,1040),sc=sheet.getContext('2d');
 const encoder=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,`${look.id}.mp4`)],{stdio:['pipe','ignore','pipe']});
 let error='';encoder.stderr.on('data',b=>{error+=b;});const exited=once(encoder,'exit');
 const phases=new Map(Array.from({length:6},(_,i)=>[Math.round((count-1)*i/5),i]));let edge=0,blank=0;const hashes=new Set();
 for(let i=0;i<count;i++){
  const at=i/fps*1000;painter.draw(at);const p=pixels(painter.body);edge+=Boolean(p.edge);blank+=!p.occupied;hashes.add(p.hash);
  ctx.fillStyle=i<count/2?'#eeeae2':'#282934';ctx.fillRect(0,0,660,520);ctx.fillStyle=i<count/2?'#3b2923':'#f2ebe3';ctx.font='18px sans-serif';ctx.fillText(`${look.id} / ${look.action}`,18,25);ctx.font='13px sans-serif';ctx.fillText(`${view} / ${(at/1000).toFixed(2)}s / normal 30 fps`,18,48);
  for(const [x,y,m] of [[-2,210,1],[204,65,2]])ctx.drawImage(painter.body,x,y,painter.stage.cssWidth*m,painter.stage.cssHeight*m);
  ctx.fillText('99 CSS body width',24,474);ctx.fillText('198 CSS body width (2x)',360,474);ctx.fillText('Production painter / offscreen Skia / no native desktop acceptance',18,507);
  if(phases.has(i)){const k=phases.get(i);sc.drawImage(screen,(k%3)*660,Math.floor(k/3)*520);}
  if(!encoder.stdin.write(screen.toBuffer('image/png')))await once(encoder.stdin,'drain');
 }
 encoder.stdin.end();const [code]=await exited;if(code)throw Error(error);
 fs.writeFileSync(path.join(out,`${look.id}.png`),sheet.toBuffer('image/png'));painter.dispose();
 records.push({id:look.id,items:look.itemIds,action:look.action,view,fps,durationMs:selected.duration,frames:count,blankFrames:blank,edgeFrames:edge,uniqueFrames:hashes.size,video:`${look.id}.mp4`,contactSheet:`${look.id}.png`,visualStatus:'pending individual visual review'});
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({scope:process.argv.includes('--only-pairs') ? '14 named two-slot interaction pairs in attachment-relevant actions. Not exhaustive power-set coverage.' : 'Every accessory individually in an attachment-relevant action; curated full outfit stress cases. Not exhaustive power-set coverage.',records},null,2));console.log(look.id,blank,edge);
}
