import fs from 'node:fs';import{fixture,argumentsFor,finish}from './fixture.mjs';
const config=argumentsFor('runtime'),base=config.out;
const f=await fixture(config),failures=[],rows=[],samples=[],frameRows=[];const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);const check=(v,s)=>{if(!v)failures.push(s);};
let total=0,maxJump=0,unique=new Set();
for(const dpr of[1,1.25,1.5,2,3])for(const facing of[1,-1])for(const calm of[false,true])for(const outfit of[false,['milestone.sunhat','milestone.scarf','milestone.boots','milestone.cape']]){
 f.nextCase();const pair={};for(const mode of['legacy','candidate']){pair[mode]=f.createRenderHarness(f.sources[mode],{skin:'pink',outfit,dpr,view:'front',facing,calm,blink:false});pair[mode].select('action','wave');}
 let previous=null,n=0;const poses=new Set();
 for(let i=0;i<=140;i++){
  const at=i*50;for(const h of Object.values(pair))h.draw(at);const a=f.traces.legacy,b=f.traces.candidate,h=b.art.contact?.hands?.[0],label=`${dpr}/${facing}/${calm}/${!!outfit}/${i}`;
  check(b.art.sourceContactPose==='wave-front-v1',label+' source');check(b.art.ready&&b.art.actionReady,label+' ready');check(eq(a.art.data.body,b.art.data.body),label+' body');check(eq(a.art.footwearTransforms,b.art.footwearTransforms),label+' footwear');check(eq(a.art.contact.tools,b.art.contact.tools),label+' props');check(eq(h?.points?.[0],[58.5,45.5]),label+' root');check(eq(h?.pawMatrix,[1,0,0,1,0,0]),label+' stretch');check(!h?.limb&&!h?.connector&&!h?.attachedArm,label+' duplicate fore');
  const index=h?.sourceContact?.keypose;poses.add(index);unique.add(index);if(previous&&index!==previous.index){const jump=Math.hypot(h.gripPoint[0]-previous.target[0],h.gripPoint[1]-previous.target[1]);maxJump=Math.max(maxJump,jump);check(Math.abs(index-previous.index)<=1,label+' skip keypose');check(jump<1,label+' wrist jump');}previous={index,target:h.gripPoint};
  if(config.images&&dpr===2&&facing===1&&!calm&&[0,12,35,58,82,105,128,140].includes(i)){
   const file=`renderer-${outfit?'heavy':'bare'}-${at}.png`;fs.writeFileSync(base+'/'+file,pair.candidate.body.toBuffer('image/png'));if(!outfit)samples.push({file,at,p:b.options.progress});}
  if(config.frames)frameRows.push({dpr,facing,calm,outfit:!!outfit,at,progress:b.options.progress,keypose:index,target:h.gripPoint,opacity:h.opacity,source:b.art.sourceContactPose,ready:b.art.ready,bodyUnchanged:eq(a.art.data.body,b.art.data.body),footwearUnchanged:eq(a.art.footwearTransforms,b.art.footwearTransforms)});n++;total++;if(i%40===0)await new Promise(r=>setImmediate(r));
 }
 check(calm?poses.size===1:poses.size===11,`${dpr}/${facing}/${calm}/${!!outfit} pose coverage`);rows.push({dpr,facing,calm,outfit:outfit||'bare',frames:n,keyposes:[...poses]});for(const h of Object.values(pair))h.dispose();
}
if(config.images){const can=f.backend.createCanvas(3*670,3*940),ctx=can.getContext('2d');
for(const [n,item]of samples.entries()){const im=await f.backend.loadImage(base+'/'+item.file),x=n%3*670,y=Math.floor(n/3)*940;for(const[off,bg,fg]of[[0,'#f5f1e9','#222'],[470,'#252735','#eee']]){ctx.fillStyle=bg;ctx.fillRect(x,y+off,670,470);ctx.imageSmoothingEnabled=false;ctx.drawImage(im,x+5,y+off+105,219,219);ctx.drawImage(im,x+227,y+off+26,438,438);ctx.fillStyle=fg;ctx.font='14px sans-serif';ctx.fillText(`wave p=${item.p.toFixed(3)} / 99 and 198 CSS px body design width`,x+8,y+off+18);}}
fs.writeFileSync(base+'/representatives-native-2x-light-dark.png',can.toBuffer('image/png'));}
const report={evidence:'Actual createPetRenderer and unchanged production raster artist, integrated manifest and selector. Candidate has no source or metadata injection. Same pet channel recycled between explicit new QA episodes. Offscreen Skia only, not native window/GPU acceptance.',total,rows,uniqueKeyposes:[...unique].sort((a,b)=>a-b),maxAdjacentWristJump:maxJump,failures,cache:f.artists.candidate.cacheStats()};if(config.frames)fs.writeFileSync(base+'/runtime-frames.json',JSON.stringify(frameRows,null,2)+'\n');finish(base,'runtime-report',report);f.dispose();
