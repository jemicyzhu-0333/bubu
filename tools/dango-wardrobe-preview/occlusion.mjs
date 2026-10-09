import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createRenderHarness,loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { traceFrame } from '../dango-state-cycle-preview/metrics.mjs';
import { replay,wardrobeCall,headCall,frontCall } from './metrics.mjs';
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const backend=createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(pathToFileURL(process.cwd()).href),out=arg('out')||'dist/dango-wardrobe-review';
const sheet=backend.createCanvas(1440,970),ctx=sheet.getContext('2d'),masks=Array.from({length:6},()=>backend.createCanvas(438,438));
ctx.fillStyle='#eef2ed';ctx.fillRect(0,0,1440,970);
function label(text,x,y,size=14){ctx.fillStyle='#263a3a';ctx.font=`${size}px sans-serif`;ctx.fillText(text,x,y);}
label('ACTUAL PAINTER / GARMENT LAYER AND OCCLUSION PROOF',22,32,23);
label('Existing back layers remain behind the body. The scarf front is after the live face. No flattened costume sprite.',22,58);
const rows=[];
for(const[keyIndex,key]of ['sunhat','sprout'].entries())for(const view of ['front','three-quarter','back'])for(const running of [false,true]){
 const harness=createRenderHarness(source,{skin:'pink',view,outfit:['milestone.scarf',`milestone.${key}`],blink:false});harness.select(running?'action':'expression',running?'chase-laser':'life.idle');
 let trace;for(let frame=0;frame<=60;frame++)trace=traceFrame(harness,frame/30*1000);
 const root=trace.calls.find(c=>!c.src),groups=[trace.calls.filter(c=>/hidden-root\.png$/.test(c.src||'')),trace.calls.filter(c=>/hidden-return\.png$/.test(c.src||'')),[root],trace.calls.filter(headCall)];
 const data=groups.map((g,i)=>{replay(masks[i].getContext('2d'),g);return masks[i].getContext('2d').getImageData(0,0,438,438).data;});
 replay(masks[4].getContext('2d'),trace.calls);replay(masks[5].getContext('2d'),trace.calls.filter(c=>!/hidden-return\.png$/.test(c.src||'')));
 const whole=masks[4].getContext('2d').getImageData(0,0,438,438).data,withoutReturn=masks[5].getContext('2d').getImageData(0,0,438,438).data;
 const row={key,requestedView:view,running,finalScarfReturnContributionPixels:0,hiddenHeadRootPixels:0,hiddenHeadRootOccluded:0,scarfReturnPixels:0,scarfReturnOccluded:0,visibleHeadPixels:0};
 for(let i=3;i<data[0].length;i+=4){const body=data[2][i]>=240;
  row.finalScarfReturnContributionPixels+=[0,1,2,3].some(c=>Math.abs(whole[i-3+c]-withoutReturn[i-3+c])>8);
  if(data[0][i]>=16){row.hiddenHeadRootPixels++;row.hiddenHeadRootOccluded+=body;}
  if(data[1][i]>=16){row.scarfReturnPixels++;row.scarfReturnOccluded+=body;}
  row.visibleHeadPixels+=data[3][i]>=16&&!body;
 }
 row.hiddenHeadRootOcclusionFraction=row.hiddenHeadRootOccluded/row.hiddenHeadRootPixels;
 row.scarfReturnOcclusionFraction=row.scarfReturnOccluded/row.scarfReturnPixels;rows.push(row);
 if(view==='three-quarter'&&!running){
  const selected=[trace.calls.filter(c=>wardrobeCall(c)&&!frontCall(c)),trace.calls.filter(c=>!wardrobeCall(c)),trace.calls.filter(frontCall),trace.calls];
  for(const[col,calls]of selected.entries()){
   const x=col*360,y=86+keyIndex*430;ctx.fillStyle='white';ctx.fillRect(x+6,y,348,420);
   label(`${key.toUpperCase()} + SCARF`,x+18,y+25,15);
   label(['Garment back','Body + live face','Garment front','Ordered composition'][col],x+18,y+50,14);
   replay(masks[0].getContext('2d'),calls);ctx.drawImage(masks[0],x-41,y+30,438,438);
  }
 }
 harness.dispose();
}
label('2x / 198 px body design width. Hidden-root ratios compare wardrobe alpha>=16 against torso alpha>=240.',22,958,12);
fs.writeFileSync(`${out}/wardrobe-layer-proof.png`,sheet.toBuffer('image/png'));
fs.writeFileSync(`${out}/occlusion-evidence.json`,JSON.stringify({samples:rows.length,maxFinalScarfReturnContributionPixels:Math.max(...rows.map(r=>r.finalScarfReturnContributionPixels)),minHiddenHeadRootOcclusion:Math.min(...rows.map(r=>r.hiddenHeadRootOcclusionFraction)),minScarfReturnOcclusion:Math.min(...rows.map(r=>r.scarfReturnOcclusionFraction)),minVisibleHeadPixels:Math.min(...rows.map(r=>r.visibleHeadPixels)),rows},null,2));
console.log(JSON.stringify(rows,null,2));
