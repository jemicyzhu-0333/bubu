import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DANGO_RASTER as manifest } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { drawRasterFace as after } from '../../src/capabilities/companion/presentation/dango-raster-face.mjs';
import { createRasterPainter } from '../../src/capabilities/companion/presentation/raster/paint.mjs';
import { sampleDangoFace } from '../../src/capabilities/companion/presentation/dango-face.mjs';
import { EXPRESSIONS } from '../../src/content/expressions.mjs';
import { OPEN_EYE_GLYPHS, createEyeApertureSampler } from '../../src/capabilities/companion/presentation/dango-eye-projection.mjs';
const baseline=process.argv[2],out=path.resolve(process.argv[3]||'dist/eye-continuity');
if(!baseline)throw Error('Supply the verified dev.4/main7314 baseline directory');
const {drawRasterFace:before}=await import(path.join(path.resolve(baseline),'src/capabilities/companion/presentation/dango-raster-face.mjs'));
fs.mkdirSync(out,{recursive:true});const images=new Map();
for(const view of ['front','three-quarter','three-quarter-left','three-quarter-right']){
 const data=manifest.views[view];for(const s of [data.body,...Object.values(data.parts),...Object.values(data.face.eyes).flat(),...Object.values(data.face.mouth)])if(!images.has(s.src))images.set(s.src,await loadImage(fs.readFileSync(fileURLToPath(new URL(s.src,manifest.baseUrl)))));
}
const painter=createRasterPainter({source:{get:s=>images.get(s.src)},createSurface:createCanvas});const source={get:s=>images.get(s.src)};
const colors={1:'#fff',2:'#f7768e',3:'#db6c84',4:'#1a1b26'};
function render(paint,face,view='front',scale=1.5,eyeAperture){const data=manifest.views[view],c=createCanvas(146*scale,146*scale),ctx=c.getContext('2d');ctx.scale(scale,scale);ctx.translate(40,40);for(const n of ['ear-left','ear-right','foot-left','foot-right'])painter.paint(ctx,data.parts[n],colors);painter.paint(ctx,data.body,colors);paint(ctx,{view,data,face,eyeAperture,layeredReady:true},face,false,colors,{painter,source});return c;}
const expr=EXPRESSIONS.find(x=>x.id==='life.attentive'),times=[1007,1009,2447,2449];
const sheet=createCanvas(1200,930),ctx=sheet.getContext('2d');ctx.fillStyle='#f4f2ef';ctx.fillRect(0,0,1200,930);ctx.fillStyle='#20232a';ctx.font='bold 24px sans-serif';ctx.fillText('Open-eye continuity | before dev.4 / after fix',18,35);ctx.font='16px sans-serif';ctx.fillText('Production Canvas face painter, offscreen Skia. Fixed front/body, no blink, openness=1.',18,63);
for(const [row,paint]of [before,after].entries()){ctx.fillText(row?'AFTER: one canonical footprint; still the requested glyph':'BEFORE: different full-pupil sizes swap at phrase boundaries',18,row*410+94);
 for(const [i,t]of times.entries()){const face=sampleDangoFace(expr.face,{expressionId:expr.id,motion:'idle',expressionElapsedMs:t}),x=i*300,y=row*410+121;ctx.font='bold 17px sans-serif';ctx.fillText(`${t}ms | ${face.eyes}`,x+17,y);ctx.drawImage(render(paint,face),x+40,y+10);ctx.drawImage(render(paint,face,'front',4.5),48*4.5,57*4.5,52*4.5,25*4.5,x+32,y+215,234,112);ctx.font='15px sans-serif';ctx.fillText('Native scale above / 3x face crop below',x+15,y+352);}}
ctx.fillText('Not a user-PC screenshot. No body/asset/eye-anchor changes; no double-pupil cross-fade.',18,914);fs.writeFileSync(path.join(out,'before-after.png'),sheet.toBuffer('image/png'));
const atlas=createCanvas(1200,4*270),a=atlas.getContext('2d');a.fillStyle='#f4f2ef';a.fillRect(0,0,atlas.width,atlas.height);
for(const [v,view]of ['front','three-quarter'].entries())for(const [i,eyes]of OPEN_EYE_GLYPHS.entries()){const x=(i%4)*300,y=(v*2+Math.floor(i/4))*270;a.fillStyle='#20232a';a.font='17px sans-serif';a.fillText(`${view}: ${eyes}`,x+12,y+23);a.drawImage(render(after,{eyes,mouth:'neutral',openness:1},view),x+40,y+32);}
fs.writeFileSync(path.join(out,'all-open-glyphs.png'),atlas.toBuffer('image/png'));
fs.mkdirSync(path.join(out,'frames'),{recursive:true});const sampler=createEyeApertureSampler();
for(let i=0;i<108;i++){const t=i*1000/30,face=sampleDangoFace(expr.face,{expressionId:expr.id,motion:'idle',expressionElapsedMs:t});const c=createCanvas(960,440),k=c.getContext('2d');k.fillStyle='#f4f2ef';k.fillRect(0,0,960,440);k.fillStyle='#20232a';k.font='19px sans-serif';k.fillText(`life.attentive ${Math.round(t)}ms | ${face.eyes} | fixed body/view`,18,30);for(const [n,paint]of [before,after].entries()){k.fillText(n?'AFTER':'BEFORE dev.4',n*480+18,65);k.drawImage(render(paint,face),n*480+130,73);k.drawImage(render(paint,face,'front',4.5,sampler.sample(face,{elapsedMs:t})),48*4.5,57*4.5,52*4.5,25*4.5,n*480+123,280,234,112);}fs.writeFileSync(path.join(out,'frames',String(i).padStart(3,'0')+'.png'),c.toBuffer('image/png'));}
console.log(out);
// Keep the geometry identical on both sides to isolate the later quiet-phrase
// change from the open-eye footprint correction above.
const {sampleDangoFace:oldSample}=await import(path.join(path.resolve(baseline),'src/capabilities/companion/presentation/dango-face.mjs'));
const quiet=createCanvas(1000,6*240+85),q=quiet.getContext('2d');q.fillStyle='#f4f2ef';q.fillRect(0,0,quiet.width,quiet.height);q.fillStyle='#20232a';q.font='20px sans-serif';q.fillText('Quiet phrases only | same corrected eye geometry on both sides',16,29);q.font='15px sans-serif';q.fillText('No action, no blink. Existing elapsed clock. Semantic ID and eye glyph stay unchanged.',16,57);
for(const [group,id]of ['life.idle','work.focus','work.rest'].entries()){
 const e=EXPRESSIONS.find(x=>x.id===id),period={'life.idle':5200,'work.focus':5100,'work.rest':5400}[id];
 for(const [side,sample]of [oldSample,sampleDangoFace].entries())for(let cycle=0;cycle<3;cycle++){
  const time=(cycle+.5)*period,face=sample(e.face,{expressionId:id,motion:'idle',expressionElapsedMs:time}),x=cycle*330,y=85+(group*2+side)*240;
  q.fillStyle='#20232a';q.font='16px sans-serif';q.fillText(`${side?'AFTER':'BEFORE'} ${id} ${Math.round(time)}ms`,x+14,y);
  q.drawImage(render(after,face),x+50,y+12);q.font='14px sans-serif';q.fillText(`mouth=${face.mouth}; gaze=(${face.eyeOffsetX.toFixed(2)},${face.eyeOffsetY.toFixed(2)})`,x+8,y+225);
 }
}
fs.writeFileSync(path.join(out,'quiet-phrases-only.png'),quiet.toBuffer('image/png'));
const {createHash}=await import('node:crypto');
const root=fileURLToPath(new URL('../../',import.meta.url));
const sources=['src/capabilities/companion/presentation/dango-eye-projection.mjs','src/content/companion/dango-eye-footprints.mjs','src/capabilities/companion/presentation/dango-raster-face.mjs','src/capabilities/companion/presentation/dango-raster-art.mjs','src/capabilities/companion/presentation/dango-face.mjs','src/capabilities/companion/presentation/dango-quiet-face.mjs','src/capabilities/companion/presentation/dango-raster-pose.mjs','src/surfaces/pet/renderer.mjs','tools/dango-eye-continuity/capture.mjs'];
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(out,'evidence-manifest.json'),JSON.stringify({baseline:'7314c274474c3f9af12c3617b3f00cbe3101f42c (dev.4 eye source equivalent)',evidence:'offscreen Skia production face painter; synthetic states, not native Windows',sources:Object.fromEntries(sources.map(p=>[p,hash(path.join(root,p))])),images:Object.fromEntries(['before-after.png','all-open-glyphs.png','quiet-phrases-only.png'].map(p=>[p,hash(path.join(out,p))]))},null,2));
const {eyeInkRect}=await import('../../src/capabilities/companion/presentation/dango-eye-projection.mjs');
const boundsReport=[];
for(const view of ['front','three-quarter','three-quarter-left','three-quarter-right'])for(const eyes of OPEN_EYE_GLYPHS)for(const scale of [1.5,3,4.5]){
 const data=manifest.views[view],face={eyes,mouth:'neutral',openness:1};
 const c=createCanvas(Math.ceil(80*scale),Math.ceil(80*scale)),context=c.getContext('2d');context.scale(scale,scale);
 after(context,{view,data,face,layeredReady:true},face,false,colors,{painter,source});
 for(const [eye,reference]of data.face.eyes.neutral.entries()){
  const [x,y,w,h]=eyeInkRect(reference),left=Math.floor(x*scale)-2,top=Math.floor(y*scale)-2;
  const cw=Math.ceil(w*scale)+5,ch=Math.ceil(h*scale)+5,pixels=context.getImageData(left,top,cw,ch).data;
  let l=cw,t=ch,r=-1,b=-1;
  for(let py=0;py<ch;py++)for(let px=0;px<cw;px++){
   const i=(py*cw+px)*4;
   if(pixels[i+3]>127&&Math.max(pixels[i],pixels[i+1],pixels[i+2])<100){l=Math.min(l,px);t=Math.min(t,py);r=Math.max(r,px);b=Math.max(b,py);}
  }
  boundsReport.push({view,eyes,scale,eye,expected:{x:x*scale,y:y*scale,width:w*scale,height:h*scale},actual:{x:left+l,y:top+t,width:r+1-l,height:b+1-t},error:{width:r+1-l-w*scale,height:b+1-t-h*scale}});
 }
}
const maxError=Math.max(...boundsReport.flatMap(r=>[Math.abs(r.error.width),Math.abs(r.error.height)]));
fs.writeFileSync(path.join(out,'pixel-bounds.json'),JSON.stringify({samples:boundsReport.length,maxErrorPixels:maxError,tolerancePixels:1.5,passed:maxError<=1.5,records:boundsReport},null,2));
if(maxError>1.5)throw Error(`Visible pupil error ${maxError}px exceeds raster tolerance`);
