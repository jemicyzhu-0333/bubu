import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource,createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { createSessionActivityController } from '../../src/core/session-activity.mjs';
import { activityControllerContent } from '../../src/surfaces/pet/activity-mirror.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const out=path.resolve(arg('out',path.join(root,'dist/messenger-clips')));fs.mkdirSync(out,{recursive:true});
const backend=createRequire(import.meta.url)(arg('canvas-package',path.join(root,'node_modules/@napi-rs/canvas')));
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(pathToFileURL(root).href);const records=[];
const heavy=['usagi.moon-beret','usagi.star-collar','usagi.starlit-cape','usagi.envelope-pouch','usagi.constellation','usagi.moon-boots'];
for(const clip of ['usagi.paper-plane-clip','usagi.compass-clip'])for(const theme of ['light','dark']){
 const rows=[{id:'clip',outfit:[clip],views:['front','three-quarter','profile','back']},
  {id:'full-outfit',outfit:[...heavy,clip],views:['front','three-quarter','profile','back']},
  {id:'music-full',outfit:[...heavy,clip],views:['front','three-quarter'],music:true}];
 const canvas=backend.createCanvas(1760,rows.length*750),ctx=canvas.getContext('2d');ctx.fillStyle=theme==='dark'?'#202c38':'#f1f3ee';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle=theme==='dark'?'#eaf0f4':'#344552';ctx.font='14px sans-serif';
 for(const [row,spec] of rows.entries()){
  ctx.fillText(`${clip} / ${spec.id} / ${theme} / 99px upper, 198px lower body design width`,8,row*750+20);
  for(const [col,view] of spec.views.entries()){
   let now=0;const controller=createSessionActivityController({...activityControllerContent(source.sessions),clock:{now:()=>now}});
   const h=createRenderHarness(source,{skin:'usagi',dpr:2,blink:false,view,outfit:spec.outfit,...(spec.music?{sessionActivityController:controller}:{})});
   if(spec.music){controller.setMode('mirror-music',0);h.select('expression','life.idle');h.updateState({devPreview:null,activityMirror:'music',activityMirrorConcurrent:{v:1,music:true,coding:false,ai:false}});}
   else h.select('action','moonwalk');
   for(now=0;now<=3200;now+=1000/30)h.draw(now);
   ctx.drawImage(h.body,col*440+110,row*750+30,219,219);
   ctx.drawImage(h.body,col*440,row*750+260,438,438);
   ctx.fillText(view,col*440+10,row*750+735);h.dispose();records.push({clip,theme,scenario:spec.id,view});
  }
 }
 fs.writeFileSync(path.join(out,`${clip}-${theme}.png`),canvas.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({surface:'production Canvas / offscreen Skia',records,limits:['Music production view policy permits front and three-quarter; static wardrobe also checks profile/back.','No native GPU/window acceptance.']},null,2));console.log(out);
