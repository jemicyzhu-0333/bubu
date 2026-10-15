import fs from 'node:fs';
import assert from 'node:assert/strict';
import {argumentsForRun,createFixture} from './shared-runtime.mjs';
import {captures,drawCaptured,clearCaptures,checkCaptured} from './observe-draws.mjs';
const args=argumentsForRun();
const {root,out,imp,backend,common,sources,artists,manifests,traces,optionsByMode,guard,controls,READ_BOOK_CONTACT_KEYS}=await createFixture(args);
const{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
const dpr=args.dpr;
const skin='pink',rows=[],guards=[],resources=[],failures=[];let worst=null;
const harnesses={};
for(const mode of Object.keys(artists)){
 const h=createRenderHarness(sources[mode],{skin,outfit:false,dpr,blink:false,expressionFor:s=>common.behaviors.PET_ACTIONS[s.currentEgg?.id]?.expression||'life.idle'});h.select('expression','life.idle');
 const egg={...common.interactionPlayback.createManualActionPlayback(common.behaviors,'read-book',{formId:'dango'}),presentationEventId:'read-book-full-production'};
 h.updateState({renderChannel:'pet',currentEgg:egg,actionStartedAt:0,devPreview:null,appearanceItemIds:[]});harnesses[mode]=h;
}
guard.observeFinalStage(harnesses.actual.body);for(const side of ['left','right'])controls[side].observeFinalStage(harnesses[side].body);
const times=args.smoke?[0,1375,5500]:[...new Set([...Array.from({length:1100},(_,i)=>i*10),1375])].sort((a,b)=>a-b);
for(const now of times){
 const frames={};for(const [mode,h]of Object.entries(harnesses)){const f=drawCaptured(h,mode,now);frames[mode]=JSON.parse(JSON.stringify({at:now,state:f.state,stage:f.stage,current:f.current,options:{skin,outfit:false,dpr,blink:false}}));}
 const actual=traces.actual.at(-1),legacy=traces.legacy.at(-1);assert.equal(actual.sourceContactPose,'read-book-front-halfgrid-v1');assert.deepEqual(actual.data.body,legacy.data.body);assert.deepEqual(actual.contact.details,legacy.contact.details);assert.deepEqual(actual.contact.tools.filter(t=>!t.sourceHandRoot),legacy.contact.tools);
 const pixel=checkCaptured('actual'),pageVisible=actual.contact.details[0].amount>.01;
 for(const side of ['left','right']){
  if(!actual.contact.tools.some(t=>t.key===READ_BOOK_CONTACT_KEYS[side].root&&t.layer==='back'))failures.push({now,side,type:'missing-root-selection'});
  if(!pixel.hands[side].roots||pixel.hands[side].uncovered)failures.push({now,side,type:'root-coverage',details:pixel.hands[side]});
  if(!pixel.hands[side].bookOverlap)failures.push({now,side,type:'book-contact'});
  if(!(pixel.order.indexOf(side+'Root')<pixel.order.indexOf('body')&&pixel.order.indexOf('book')<pixel.order.indexOf(side)))failures.push({now,side,type:'layer-order'});
 }
 if(pageVisible&&!pixel.hands.right.pageContactPass)failures.push({now,type:'page-contact',details:pixel.hands.right});
 if(pageVisible&&pixel.order.indexOf('page')>pixel.order.indexOf('right'))failures.push({now,type:'page-layer'});
 rows.push({now,progress:now/11000,pageVisible,bodyBookPageUnchanged:true,...pixel});
 for(const side of ['left','right'])guards.push({now,...guard.assertContribution({targetId:READ_BOOK_CONTACT_KEYS[side].front,stage:harnesses.actual.body,omittedStage:harnesses[side].body,artwork:actual,omittedArtwork:traces[side].at(-1),renderInputs:{manifest:manifests.actual,frame:frames.actual},omittedRenderInputs:{manifest:manifests[side],frame:frames[side]},label:'actual production dpr'+dpr+' at '+now})});
 if(pageVisible){const hand=pixel.hands.right,score=hand.pageOverlap?1000+hand.pageOverlap:hand.edge255;if(!worst||score<worst.score){worst={now,score,hand};for(const id of ['right','page','book'])if(captures.actual[id])fs.writeFileSync(out+'/worst-'+id+'-dpr'+dpr+'.png',captures.actual[id].toBuffer('image/png'));fs.writeFileSync(out+'/worst-stage-dpr'+dpr+'.png',harnesses.actual.body.toBuffer('image/png'));}}
 if(dpr===1.25&&[3130,3140].includes(now)){for(const id of ['right','page','book'])fs.writeFileSync(out+'/aa-'+id+'-'+now+'.png',captures.actual[id].toBuffer('image/png'));fs.writeFileSync(out+'/aa-stage-'+now+'.png',harnesses.actual.body.toBuffer('image/png'));}
 for(const mode of Object.keys(traces))traces[mode].length=0;
 await new Promise(resolve=>setImmediate(resolve));
 if(rows.length%100===0){resources.push({frames:rows.length,...process.memoryUsage()});console.log('progress',rows.length,'rssMiB',Math.round(process.memoryUsage().rss/1048576));}
}
const visible=rows.filter(r=>r.pageVisible),summary={scope:'Direct active production artist/selector, observational draw hooks and single-source omission only',dpr,smoke:args.smoke,frames:rows.length,pageVisibleFrames:visible.length,pageOverlapFrames:visible.filter(r=>r.hands.right.pageOverlap>0).length,pageEdgeOnlyFrames:visible.filter(r=>r.hands.right.pageOverlap===0&&r.hands.right.edge255>0).length,failures:failures.length,sourceComparisons:guards.length,minSourceChangedPixels:Math.min(...guards.map(r=>r.changedPixels)),maxSourceChangedPixels:Math.max(...guards.map(r=>r.changedPixels)),maxSampledRssMiB:(resources.length?Math.max(...resources.map(r=>r.rss)):process.memoryUsage().rss)/1048576,policy:'Overlap alphas >=128; otherwise full orthogonal shared edge alphas 255. No diagonal-only contact.'};
fs.writeFileSync(out+'/matrix-dpr'+dpr+'.json',JSON.stringify({summary,worst,failures,rows,guards,resources,loads:guard.snapshot()},null,2));console.log(JSON.stringify(summary));
for(const h of Object.values(harnesses))h.dispose();clearCaptures();for(const artist of Object.values(artists))artist.dispose();
if(failures.length){console.error(JSON.stringify(failures.slice(0,10),null,2));process.exitCode=1;}
