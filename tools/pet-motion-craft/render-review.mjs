// Finite real production Canvas captures. Offscreen Skia is not native QA.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const arg = (name, fallback) => process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3) || fallback;
const root = path.resolve(arg('app-root',path.join(path.dirname(fileURLToPath(import.meta.url)),'../..')));
const out = path.resolve(arg('out',path.join(root,'dist/motion-craft')));fs.mkdirSync(out,{recursive:true});
const backend = createRequire(import.meta.url)(arg('canvas-package',path.join(root,'node_modules/@napi-rs/canvas')));
const {installOffscreenImages} = await import(pathToFileURL(path.join(root,'tools/usagi-gallery/offscreen-images.mjs')));
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;
globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const {loadSource,createRenderHarness}=await import(pathToFileURL(path.join(root,'tools/usagi-gallery/runtime-harness.mjs')));
const source=await loadSource(pathToFileURL(root).href), id=arg('action','paper-return');
const skins=arg('skins','pink,usagi').split(','), outfit=arg('outfit','').split(',').filter(Boolean);
const views=arg('views','auto').split(','), phases=arg('phases','0,.14,.28,.42,.56,.7,.78,.9,.98').split(',').map(Number);
const background=arg('background','light')==='dark'?'#202c38':'#f1f3ee';
const options=skin=>({skin,dpr:Number(arg('dpr','2')),blink:false,outfit,calm:process.argv.includes('--calm'),facing:Number(arg('facing','1'))});
const rows=[];
for(const skin of skins)for(const view of views){
 const harness=createRenderHarness(source,{...options(skin),view});const selection=harness.select('action',id);
 const canvas=backend.createCanvas(phases.length*220,270),ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle=background==='#202c38'?'#edf2f5':'#344552';ctx.font='14px sans-serif';ctx.fillText(`${skin} / ${id} / ${view} / body width 99px (upper) and 198px (lower)`,8,19);
 const expanded=backend.createCanvas(phases.length*440,490),ec=expanded.getContext('2d');
 ec.fillStyle=background;ec.fillRect(0,0,expanded.width,expanded.height);ec.fillStyle=ctx.fillStyle;ec.font='14px sans-serif';ec.fillText(`${skin} / ${id} / ${view} / body width 198 CSS px`,8,19);
 let now=0;
 for(const [i,p] of phases.entries()){
  const at=p*selection.duration;for(;now<at;now+=1000/30)harness.draw(now);harness.draw(at);
  ctx.drawImage(harness.body,i*220,23,219,219);
  ec.drawImage(harness.body,i*440,25,438,438);
  ctx.font='11px sans-serif';ctx.fillText(`${(at/1000).toFixed(2)}s`,i*220+7,264);
  ec.font='11px sans-serif';ec.fillText(`${(at/1000).toFixed(2)}s`,i*440+7,483);
 }
 const name=`${skin}-${id}-${view}-${arg('background','light')}${process.argv.includes('--calm')?'-calm':''}`;
 fs.writeFileSync(path.join(out,`${name}.png`),canvas.toBuffer('image/png'));
 fs.writeFileSync(path.join(out,`${name}-2x.png`),expanded.toBuffer('image/png'));rows.push({name,skin,view,durationMs:selection.duration});harness.dispose();
}
if(process.argv.includes('--video')){
 const width=880,height=690,fps=30,canvas=backend.createCanvas(width,height),ctx=canvas.getContext('2d');
 const h=skins.map(skin=>createRenderHarness(source,{...options(skin),view:views[0]}));
 const duration=h[0].select('action',id).duration;h.slice(1).forEach(p=>p.select('action',id));
 const file=path.join(out,`${id}-${arg('background','light')}.mp4`);
 const proc=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',file],{stdio:['pipe','ignore','pipe']});
 const done=once(proc,'exit');let stderr='';proc.stderr.on('data',d=>stderr+=d);let ended=false;
 for(let n=0;n<Math.ceil((duration+1000)/1000*fps);n++){
  const at=n/fps*1000;if(at>=duration&&!ended){h.forEach(p=>p.select('expression','life.idle'));ended=true;}
  ctx.fillStyle=background;ctx.fillRect(0,0,width,height);ctx.fillStyle=background==='#202c38'?'#edf2f5':'#344552';ctx.font='14px sans-serif';
  ctx.fillText(`${id} / ${(at/1000).toFixed(2)}s / production Canvas / 30fps`,10,22);
  for(const [i,p] of h.entries()){
   p.draw(at);const x=i*440;ctx.drawImage(p.body,x+110,30,219,219);ctx.drawImage(p.body,x,210,438,438);
   ctx.fillText(`${skins[i]} body width 99 / 198 CSS px`,x+10,678);
  }
  const rgba=ctx.getImageData(0,0,width,height).data;if(!proc.stdin.write(Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)))await once(proc.stdin,'drain');
 }
 proc.stdin.end();const [code]=await done;if(code)throw Error(stderr);h.forEach(p=>p.dispose());console.log(file);
}
fs.writeFileSync(path.join(out,'render-manifest.json'),JSON.stringify({surface:'offscreen Skia Canvas using production createPetRenderer',rows,outfit,phases,limitations:['Not native desktop/GPU validation','Visual review required independently of successful encoding']},null,2));
console.log(out);
