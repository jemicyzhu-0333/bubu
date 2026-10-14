import {REPO,OUT} from './runtime-config.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createSweepFixture} from './fixture.mjs';
const root=REPO,out=path.resolve(OUT,'evidence');fs.mkdirSync(out,{recursive:true});
const transforms={};globalThis.captureSweepTransform=(mode,v)=>transforms[mode]=v;
const f=await createSweepFixture(root,out),F=f.fixture,modes=['current','candidate','omitted','body_only','palm_only','rod_only'];F.guard.assertLoaded();
const records=[],failures=[],frameRows=[];let serial=0;const samples=[...new Set([...Array.from({length:271},(_,i)=>i/30*1000),3375,5625])].sort((a,b)=>a-b);
function seam(body,palm,rod){const w=body.width,h=body.height,B=body.getContext('2d').getImageData(0,0,w,h).data,P=palm.getContext('2d').getImageData(0,0,w,h).data,R=rod.getContext('2d').getImageData(0,0,w,h).data;let overlap=0,touch=0,rodOverlap=0,pixels=0;const rows=new Set();for(let i=0;i<w*h;i++){if(P[i*4+3]<128)continue;pixels++;if(R[i*4+3]>=128)rodOverlap++;if(B[i*4+3]>=128)overlap++;const x=i%w,y=(i/w)|0;if(B[i*4+3]>=128||x>0&&B[(i-1)*4+3]>=128||x<w-1&&B[(i+1)*4+3]>=128||y>0&&B[(i-w)*4+3]>=128||y<h-1&&B[(i+w)*4+3]>=128){touch++;rows.add(y);}}
let longest=0,run=0,prev=-2;for(const y of [...rows].sort((a,b)=>a-b)){run=y===prev+1?run+1:1;longest=Math.max(longest,run);prev=y;}return {overlap,touch,touchRows:rows.size,longestTouchRows:longest,rodOverlap,pixels};}
try{for(const dpr of [1,1.25,1.5,2])for(const facing of [1,-1]){
 const id=`dpr${dpr}-facing${facing}`,base=++serial*20000,h={};for(const mode of modes){const s=f.sources[mode];h[mode]=f.createRenderHarness(s,{skin:'pink',outfit:false,dpr,blink:false,view:'auto',facing,expressionFor:st=>s.behaviors.PET_ACTIONS[st.currentEgg?.id]?.expression||'life.idle'});h[mode].select('expression','life.idle');h[mode].updateState({renderChannel:'pet',devPreview:null,currentEgg:{...s.interactionPlayback.createManualActionPlayback(s.behaviors,'sweep',{formId:'dango'}),presentationEventId:id},actionStartedAt:base});}
 F.guard.observeFinalStage(h.candidate.body);F.omission.observeFinalStage(h.omitted.body);let count=0,minTouch=Infinity,minRows=Infinity,minOverlap=Infinity,minRod=Infinity,minDiff=Infinity,maxDx=0,firstMissing=null;
 for(let i=0;i<samples.length;i++){const now=base+samples[i];for(const mode of modes)h[mode].draw(now);const a=F.traces.candidate.art,b=F.traces.current.art,c=F.traces.omitted.art;
 assert.deepEqual(a.data,b.data,`${id}:${i}: body/parts/face descriptors changed`);assert.deepEqual(a.contact?.tools,b.contact?.tools,`${id}:${i}: original tool moved`);
 if(a.sourceContactPose!=='sweep-quarter-grip-v1'){if(F.traces.candidate.options.action?.id==='sweep'){failures.push({id,i,reason:'source selection absent',view:a.view,contact:a.contact});firstMissing??=i;}continue;}
 const frame={actual:f.sources.candidate.controls.at(-1).lastFrame,seed:0x55a61,blinkSeed:0x913a7,background:'transparent',dpr,facing,outfit:[],skin:'pink',timeline:{base,i,nominalStepMs:1000/30,sampleOffset:samples[i],extraExactExtrema:[3375,5625]}};
 const controlFrame={...frame,actual:f.sources.omitted.controls.at(-1).lastFrame};
 for(const mode of ['body_only','palm_only','rod_only']){assert.deepEqual(f.sources[mode].controls.at(-1).lastFrame,frame.actual,`${id}:${i}: diagnostic frame mismatch`);assert.deepEqual(transforms[mode],transforms.candidate,`${id}:${i}: diagnostic stage transform mismatch`);}
 const proof=F.guard.assertContribution({targetId:'grip',stage:h.candidate.body,omittedStage:h.omitted.body,artwork:a,omittedArtwork:c,renderInputs:{manifest:F.manifests.candidate,frame},omittedRenderInputs:{manifest:F.manifests.omitted,frame:controlFrame},label:`${id}:${i}`});
 const s=seam(h.body_only.body,h.palm_only.body,h.rod_only.body),tool=a.contact.tools.find(t=>t.key==='broom'),hand=a.contact.hands[0];assert.deepEqual(hand.pawMatrix,[1,0,0,1,tool.x-58-2,0]);assert.deepEqual(hand.gripPoint,[tool.x+9.375,40.75]);maxDx=Math.max(maxDx,Math.abs(tool.x-58));
 const tm=transforms.candidate,mm=tm.matrix,gx=tm.offX+hand.gripPoint[0]*tm.bodyScale,gy=tm.offY+hand.gripPoint[1]*tm.bodyScale;
 const stageGrip=[Math.floor(mm[0]*gx+mm[2]*gy+mm[4]),Math.floor(mm[1]*gx+mm[3]*gy+mm[5])];
 const gripAlpha=['palm_only','rod_only'].map(mode=>h[mode].body.getContext('2d').getImageData(...stageGrip,1,1).data[3]);
 const axisGX=tm.offX+(tool.x+11.375)*tm.bodyScale, axisGY=gy;
 const stageOriginalAxis=[Math.floor(mm[0]*axisGX+mm[2]*axisGY+mm[4]),Math.floor(mm[1]*axisGX+mm[3]*axisGY+mm[5])];
 const originalAxisAlpha=['palm_only','rod_only'].map(mode=>h[mode].body.getContext('2d').getImageData(...stageOriginalAxis,1,1).data[3]);
 assert(originalAxisAlpha.every(alpha=>alpha>=128),`${id}:${i}: original rod axis not inside palm and rod`);
 assert(gripAlpha.every(alpha=>alpha>=128),`${id}:${i}: actual projected grip is not inside both palm and rod`);

 if(!s.touch||!s.rodOverlap){failures.push({id,i,p:a.progress,reason:!s.touch?'no body-palm adjacency without tool':'palm does not contact rod',...s});if(failures.length<=8)for(const mode of ['candidate','body_only','palm_only'])fs.writeFileSync(out+`/failure-${id}-${i}-${mode}.png`,h[mode].body.toBuffer('image/png'));}
 count++;minTouch=Math.min(minTouch,s.touch);minRows=Math.min(minRows,s.longestTouchRows);minOverlap=Math.min(minOverlap,s.overlap);minRod=Math.min(minRod,s.rodOverlap);minDiff=Math.min(minDiff,proof.changedPixels);frameRows.push({id,i,p:a.progress,...s,stageGrip,gripAlpha,stageOriginalAxis,originalAxisAlpha,changedPixels:proof.changedPixels});
 if(i%30===0)await new Promise(r=>setImmediate(r));}
 records.push({id,sourceFrames:count,totalFrames:samples.length,minTouch,minConsecutiveInterfaceRows:minRows,minOverlap,minRodOverlap:minRod,minSourceDifference:minDiff,maxOriginalBroomDelta:maxDx,firstMissing});for(const hh of Object.values(h))hh.dispose();console.log(JSON.stringify(records.at(-1)));}
}finally{f.dispose();}
const report={scope:'Actual unchanged production artist and registered shared selector; actual manual renderer full30fps9second cycle at4DPRs and both whole-character facings. Single-source-omitted final-stage guard per source frame. Separate actual same-stage body/palm/rod-only image controls; no cache-array indexing assumptions. Not native desktop/GPU acceptance.',records,totalFrames:records.reduce((n,r)=>n+r.totalFrames,0),sourceFrames:records.reduce((n,r)=>n+r.sourceFrames,0),failures,guard:F.guard.snapshot()};fs.writeFileSync(out+'/full-cycle.json',JSON.stringify(report,null,2));fs.writeFileSync(out+'/full-cycle-seams.json',JSON.stringify(frameRows));console.log(JSON.stringify({total:report.totalFrames,source:report.sourceFrames,failures:failures.length}));if(failures.length)process.exitCode=1;
