import fs from 'node:fs';
import assert from 'node:assert/strict';
import {argumentsForRun,createFixture} from './shared-runtime.mjs';
import {captures,drawCaptured,clearCaptures,checkCaptured} from './observe-draws.mjs';
const args=argumentsForRun();
const {root,out,imp,backend,common,sources,artists,manifests,traces,optionsByMode,guard,controls,READ_BOOK_CONTACT_KEYS}=await createFixture(args);
const{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs'),rows=[],guards=[],stages={};
for(const skin of ['pink','forest','ocean','sakura'])for(const dpr of [1,2]){
 const harnesses={};
 for(const mode of Object.keys(artists)){
  const h=createRenderHarness(sources[mode],{skin,outfit:false,dpr,blink:false,expressionFor:s=>common.behaviors.PET_ACTIONS[s.currentEgg?.id]?.expression||'life.idle'});h.select('expression','life.idle');
  const egg={...common.interactionPlayback.createManualActionPlayback(common.behaviors,'read-book',{formId:'dango'}),presentationEventId:'read-book-two-pose'};
  h.updateState({renderChannel:'pet',currentEgg:egg,actionStartedAt:0,devPreview:null,appearanceItemIds:[]});harnesses[mode]=h;
 }
 guard.observeFinalStage(harnesses.actual.body);for(const side of ['left','right'])controls[side].observeFinalStage(harnesses[side].body);
 for(const now of [0,1375,5500]){
  const frames={};for(const [mode,h]of Object.entries(harnesses)){const f=drawCaptured(h,mode,now);frames[mode]=JSON.parse(JSON.stringify({at:now,state:f.state,stage:f.stage,current:f.current,options:{skin,outfit:false,dpr,blink:false}}));}
  if(!now)continue;
  const actual=traces.actual.at(-1),legacy=traces.legacy.at(-1);assert.equal(actual.sourceContactPose,'read-book-front-halfgrid-v1');assert.deepEqual(actual.data.body,legacy.data.body);assert.deepEqual(actual.contact.details,legacy.contact.details);assert.deepEqual(actual.contact.tools.filter(t=>!t.sourceHandRoot),legacy.contact.tools);
  const pixel=checkCaptured('actual');for(const side of ['left','right']){assert.ok(actual.contact.tools.some(t=>t.key===READ_BOOK_CONTACT_KEYS[side].root&&t.layer==='back'));assert.ok(pixel.hands[side].roots>0);assert.equal(pixel.hands[side].uncovered,0);assert.ok(pixel.hands[side].bookOverlap>0);assert.ok(pixel.order.indexOf(side+'Root')<pixel.order.indexOf('body'));assert.ok(pixel.order.indexOf('book')<pixel.order.indexOf(side));}
  if(now===5500){assert.ok(pixel.hands.right.pageContactPass);assert.ok(pixel.order.indexOf('page')<pixel.order.indexOf('right'));}
  rows.push({skin,dpr,now,source:actual.sourceContactPose,bodyBookPageUnchanged:true,...pixel});
  for(const side of ['left','right'])guards.push({skin,dpr,now,...guard.assertContribution({targetId:READ_BOOK_CONTACT_KEYS[side].front,stage:harnesses.actual.body,omittedStage:harnesses[side].body,artwork:actual,omittedArtwork:traces[side].at(-1),renderInputs:{manifest:manifests.actual,frame:frames.actual},omittedRenderInputs:{manifest:manifests[side],frame:frames[side]},label:skin+' dpr'+dpr+' at '+now})});
  const filename=out+'/'+skin+'-dpr'+dpr+'-'+now+'.png';fs.writeFileSync(filename,harnesses.actual.body.toBuffer('image/png'));stages[[skin,dpr,now]]=filename;
  if(skin==='pink')for(const id of ['right','page','book'])if(captures.actual[id])fs.writeFileSync(out+'/layer-'+id+'-dpr'+dpr+'-'+now+'.png',captures.actual[id].toBuffer('image/png'));
  await new Promise(resolve=>setImmediate(resolve));
 }
 for(const h of Object.values(harnesses))h.dispose();clearCaptures();for(const mode of Object.keys(traces))traces[mode].length=0;await new Promise(resolve=>setImmediate(resolve));
}
for(const skin of ['pink','forest','ocean','sakura']){
 const canvas=backend.createCanvas(1340,940),ctx=canvas.getContext('2d');
 for(const [col,now]of [1375,5500].entries())for(const [y,bg,fg]of [[0,'#f5f1e9','#222'],[470,'#242630','#eee']]){
  ctx.fillStyle=bg;ctx.fillRect(col*670,y,670,470);ctx.fillStyle=fg;ctx.font='15px sans-serif';ctx.fillText(skin+' / '+now+' ms / actual production, DPR1 + DPR2 at 1:1',col*670+8,y+18);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(await backend.loadImage(stages[[skin,1,now]]),col*670+5,y+105);ctx.drawImage(await backend.loadImage(stages[[skin,2,now]]),col*670+227,y+26);
 }
 fs.writeFileSync(out+'/'+skin+'-two-phase-light-dark.png',canvas.toBuffer('image/png'));canvas.width=1;canvas.height=1;
}
const result={scope:'Active production artist and source selector imported directly. Observational action/body draw wrapper captures post-tint painter images by exact draw rect; same-pose source omission port. No copied selector/artist or draw-path override.',rows,guards,loads:guard.snapshot(),rssMiB:Math.round(process.memoryUsage().rss/1048576)};fs.writeFileSync(out+'/report.json',JSON.stringify(result,null,2));
for(const artist of Object.values(artists))artist.dispose();
console.log(JSON.stringify({groups:rows.length,sourceComparisons:guards.length,sourceCounts:[Math.min(...guards.map(r=>r.changedPixels)),Math.max(...guards.map(r=>r.changedPixels))],allFourResourcesLoaded:true,rootsCovered:true,bodyBookPageUnchanged:true,rssMiB:result.rssMiB}));
