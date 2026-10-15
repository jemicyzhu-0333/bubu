import fs from 'node:fs';
import assert from 'node:assert/strict';
import {argumentsForRun,createFixture} from './shared-runtime.mjs';
import {captures,drawCaptured,clearCaptures,checkCaptured} from './observe-draws.mjs';
const args=argumentsForRun();
const {root,out,imp,backend,common,sources,artists,manifests,traces,optionsByMode,guard,controls,READ_BOOK_CONTACT_KEYS}=await createFixture(args);
const{createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
const rows=[],canvases=[];
const plan=(id,start,manual=true)=>({...common.interactionPlayback.createManualActionPlayback(common.behaviors,id,{formId:'dango'}),manual,presentationEventId:id+'-'+start});
function make(){const h=createRenderHarness(sources.actual,{skin:'pink',outfit:false,dpr:1.25,blink:false,expressionFor:s=>common.behaviors.PET_ACTIONS[s.currentEgg?.id]?.expression||'life.idle'});h.select('expression','life.idle');h.updateState({renderChannel:'pet',currentEgg:null,actionStartedAt:0,devPreview:null,appearanceItemIds:[]});return h;}
async function draw(h,scenario,now,expected){
 const f=drawCaptured(h,'actual',now),art=traces.actual.at(-1),o=optionsByMode.actual;
 const count=id=>{const canvas=captures.actual[id];if(!canvas)return 0;const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=3;i<data.length;i+=4)if(data[i])n++;return n;};
 const pixels=captures.actual.body?checkCaptured('actual'):{nonFrontBodyCaptureNotApplicable:true,hands:Object.fromEntries(['left','right'].map(side=>[side,{palmPixels:count(side),roots:count(side+'Root')}]))};
 const row={scenario,now,inputAction:f.state.currentEgg?.id||null,renderedAction:o.action?.id||null,view:art.view,progress:o.progress,source:art.sourceContactPose||null,propOpacity:o.action?.propOpacity??null,handoffRecovery:o.action?.handoffRecovery??null,selectedPalms:art.contact?.hands?.map(h=>h.pawSprite||null)||[],rootTools:art.contact?.tools?.filter(t=>t.sourceHandRoot).map(t=>t.key)||[],pixels};
 if(expected==='source'){assert.equal(row.source,'read-book-front-halfgrid-v1');assert.equal(row.rootTools.length,2);for(const side of ['left','right']){assert.ok(pixels.hands[side].palmPixels);assert.ok(pixels.hands[side].roots);assert.equal(pixels.hands[side].uncovered,0);}}
 if(expected==='none'){assert.notEqual(row.source,'read-book-front-halfgrid-v1');assert.equal(row.rootTools.length,0);for(const side of ['left','right']){assert.equal(pixels.hands[side].palmPixels,0);assert.equal(pixels.hands[side].roots,0);}}
 if(expected==='quarter'){assert.equal(row.renderedAction,'read-book');assert.equal(row.view,'three-quarter');assert.equal(row.source,null);assert.equal(row.rootTools.length,0);assert.equal(row.propOpacity,null);assert.equal(row.handoffRecovery,null);}
 rows.push(row);const file=out+'/'+scenario+'-'+now+'.png';fs.writeFileSync(file,h.body.toBuffer('image/png'));canvases.push({scenario,now,file});traces.actual.length=0;await new Promise(resolve=>setImmediate(resolve));return row;
}
{
 const h=make();await draw(h,'manual-full',0,'none');h.updateState({currentEgg:plan('read-book',100),actionStartedAt:100});
 for(const now of [100,116,1475,5600,11099])await draw(h,'manual-full',now,'source');
 // The real controller's finishCurrentAction clears the egg at its deadline.
 h.updateState({currentEgg:null});for(const now of [11100,11116])await draw(h,'manual-full',now,'none');h.dispose();clearCaptures();
}
{
 const h=make();h.updateState({currentEgg:plan('read-book',0),actionStartedAt:0});for(const now of [0,5500])await draw(h,'interrupt-restart',now,'source');
 h.updateState({currentEgg:plan('wave',5600),actionStartedAt:5600});for(const now of [5600,5616])await draw(h,'interrupt-restart',now,'none');
 h.updateState({currentEgg:plan('read-book',5800),actionStartedAt:5800});for(const now of [5800,5816,7175])await draw(h,'interrupt-restart',now,'source');h.dispose();clearCaptures();
}
{
 const h=make();h.updateState({currentEgg:plan('read-book',0,false),actionStartedAt:0});for(const now of [0,1375,5500,10999])await draw(h,'ambient-cue',now,'source');h.updateState({currentEgg:null});await draw(h,'ambient-cue',11000,'none');h.dispose();clearCaptures();
}
{
 const h=make();h.updateState({currentEgg:plan('paper-return',0),actionStartedAt:0});for(const now of [0,4000])await draw(h,'paper-handoff',now,'none');
 h.updateState({currentEgg:plan('read-book',4500),actionStartedAt:4500});for(const now of [4500,4700])await draw(h,'paper-handoff',now,'none');
 for(const now of [4920,5000,10000,15499])await draw(h,'paper-handoff',now,'quarter');h.updateState({currentEgg:null});await draw(h,'paper-handoff',15500,'none');
 h.updateState({currentEgg:plan('read-book',15600),actionStartedAt:15600});await draw(h,'paper-handoff',15600,'source');h.dispose();clearCaptures();
}
const c=backend.createCanvas(1370,Math.ceil(canvases.length/5)*320),ctx=c.getContext('2d');ctx.fillStyle='#f5f1e9';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#222';ctx.font='12px sans-serif';
for(const [i,r]of canvases.entries()){const x=(i%5)*274,y=Math.floor(i/5)*320;ctx.fillText(r.scenario+' '+r.now+'ms',x+4,y+15);ctx.imageSmoothingEnabled=false;ctx.drawImage(await backend.loadImage(r.file),x,y+24);}
fs.writeFileSync(out+'/lifecycle-contact-sheet.png',c.toBuffer('image/png'));c.width=1;c.height=1;
fs.writeFileSync(out+'/report.json',JSON.stringify({scope:'Active production renderer/action-playback graph with real manual/cue action plans. Controller expiry is represented by its currentEgg:null projection at the documented deadline; no native controller/scheduler execution claim.',frames:rows.length,rows,findings:{manualEntryExpiryNoResidue:true,interruptionRestartNoResidue:true,cueEntryExpiryNoResidue:true,paperReturnToReadUsesExistingQuarterFallback:true,naturalPartialOpacityOrRecoveryObserved:false}},null,2));
for(const artist of Object.values(artists))artist.dispose();console.log('PASS actual lifecycle frames',rows.length,'manual/cue/interrupt/restart/real paper-return quarter handoff');
