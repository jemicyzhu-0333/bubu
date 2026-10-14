import { readPaths } from './cli.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{fixture}from'./fixture.mjs';
const {root,out}=readPaths();fs.mkdirSync(out,{recursive:true});
const transforms={};globalThis.captureUmbrellaTransform=(m,v)=>transforms[m]=v;const f=await fixture(root,out),F=f.F,records=[];F.guard.assertLoaded();
const pix=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data,ink=(p,i)=>Math.max(p[i],p[i+1],p[i+2])<100;
function metrics(h){const data=Object.fromEntries(['body_only','palm_only','rod_only','face_only','body_palm','back_only','front_only','candidate','back_omitted'].map(k=>[k,pix(h[k].body)])),w=h.candidate.body.width,sz=w*h.candidate.body.height;let rootOccluded=0,rootExposed=0,frontPixels=0,frontBodyOverlap=0,palmRodOverlap=0,palmFaceOverlap=0,filledOverlap=0,filledTouch=0,backContribution=0,palmPixels=0;const rows=new Set();
 for(let n=0;n<sz;n++){const i=n*4,B=data.body_only,P=data.palm_only,R=data.rod_only,A=data.face_only,BK=data.back_only,FT=data.front_only;if(P[i+3]>=128){palmPixels++;if(R[i+3]>=128)palmRodOverlap++;if(A[i+3]>=128)palmFaceOverlap++;}if(BK[i+3]>=128){if(B[i+3]>=128)rootOccluded++;else rootExposed++;}if(FT[i+3]>=128){frontPixels++;if(B[i+3]>=128){frontBodyOverlap++;if(!ink(FT,i)&&!ink(B,i)){filledOverlap++;rows.add((n/w)|0);}}if(!ink(FT,i)){const x=n%w,y=(n/w)|0;if([x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h.candidate.body.height-1?n+w:-1].some(j=>j>=0&&B[j*4+3]>=128&&!ink(B,j*4))){filledTouch++;rows.add(y);}}}if([0,1,2,3].some(c=>data.candidate[i+c]!==data.back_omitted[i+c]))backContribution++;}
 return{palmPixels,rootOccluded,rootExposed,frontPixels,frontBodyOverlap,palmRodOverlap,palmFaceOverlap,filledOverlap,filledTouch,filledInterfaceRows:rows.size,backContribution};}
try{for(const dpr of[1,2]){const h={};for(const mode of f.modes){const s=f.sources[mode];h[mode]=f.createRenderHarness(s,{skin:'pink',outfit:false,dpr,blink:false,view:'auto',expressionFor:st=>s.behaviors.PET_ACTIONS[st.currentEgg?.id]?.expression||'life.idle'});h[mode].select('expression','life.idle');h[mode].updateState({renderChannel:'pet',devPreview:null,currentEgg:{...s.interactionPlayback.createManualActionPlayback(s.behaviors,'umbrella-dance',{formId:'dango'}),presentationEventId:'umbrella-prototype'},actionStartedAt:0});}
 for(const mode of f.modes)F.trace.register(mode,h[mode].body);
 F.guard.observeFinalStage(h.candidate.body);F.omission.observeFinalStage(h.omitted.body);
 for(const now of[0,1250,3750]){for(const mode of f.modes){F.trace.begin(mode);h[mode].draw(now);}if(!now)continue;const art=F.traces.candidate.art,old=F.traces.current.art,omitted=F.traces.omitted.art;assert.equal(art.sourceContactPose,'umbrella-quarter-handle-v1');assert.equal(art.view,'three-quarter');assert.deepEqual(art.data,old.data);assert.deepEqual(art.matrices,old.matrices);assert.deepEqual(art.footwearTransforms,old.footwearTransforms);
 const frame={actual:f.sources.candidate.controls.at(-1).lastFrame,seed:0x55a61,blinkSeed:0x913a7,dpr,timeline:[0,...(now===3750?[1250,3750]:[1250])],background:'transparent'};
 for(const mode of f.modes.filter(m=>m!=='current')){assert.deepEqual(f.sources[mode].controls.at(-1).lastFrame,frame.actual);assert.deepEqual(transforms[mode],transforms.candidate);}
 const proof=F.guard.assertContribution({targetId:'front-palm',stage:h.candidate.body,omittedStage:h.omitted.body,artwork:art,omittedArtwork:omitted,renderInputs:{manifest:F.manifests.candidate,frame},omittedRenderInputs:{manifest:F.manifests.omitted,frame:{...frame,actual:f.sources.omitted.controls.at(-1).lastFrame}},label:`dpr${dpr}-${now}`});
 const tm=transforms.candidate,m=tm.matrix,toStage=([x,y])=>{x=tm.offX+x*tm.bodyScale;y=tm.offY+y*tm.bodyScale;return[Math.floor(m[0]*x+m[2]*y+m[4]),Math.floor(m[1]*x+m[3]*y+m[5])];};const point=toStage([68.375,43.75]);const gripAlpha=['palm_only','rod_only'].map(k=>h[k].body.getContext('2d').getImageData(...point,1,1).data[3]);
 const edge=toStage([63.5,47.5]),uninkedBoundaryCoverage={stage:edge,bodyAlpha:h.body_only.body.getContext('2d').getImageData(...edge,1,1).data[3],palmAlpha:h.palm_only.body.getContext('2d').getImageData(...edge,1,1).data[3]};
 const calls=F.trace.read('candidate'); const positions={}; for(const [name,file]of Object.entries({propBack:'umbrella-back.png',palmBack:'right-back-8x.png',propFront:'umbrella-front.png',palmFront:'right-front-8x.png'})){const matches=calls.map((c,i)=>({c,i})).filter(({c})=>c.sources.some(s=>s.endsWith('/umbrella-quarter-handle-v1/'+file)));assert.equal(matches.length,1,name+' actual draw count');positions[name]=matches[0].i;} positions.body=calls.findIndex(c=>c.sources.some(s=>s.endsWith('/views/three-quarter-right/body.png')));assert(positions.propBack<positions.palmBack&&positions.palmBack<positions.body&&positions.body<positions.propFront&&positions.propFront<positions.palmFront);assert.deepEqual(calls[positions.propBack].matrix,calls[positions.propFront].matrix);assert.deepEqual(calls[positions.palmBack].matrix,calls[positions.palmFront].matrix);assert.deepEqual(calls[positions.propBack].draw,[0,0,50,66]);assert.deepEqual(calls[positions.propFront].draw,[0,0,50,66]);const stats=metrics(h);records.push({actualDrawOrder:positions,actualDrawCalls:calls,dpr,now,view:art.view,grip:[68.375,43.75],stageGrip:point,gripAlpha,proof,stats,uninkedBoundaryCoverage,transform:tm,artwork:art,actualFrame:frame.actual});for(const mode of f.modes)fs.writeFileSync(out+`/${mode}-${now}-dpr${dpr}.png`,h[mode].body.toBuffer('image/png'));
 console.log(JSON.stringify({dpr,now,proof,stats,gripAlpha,uninkedBoundaryCoverage}));}
 for(const x of Object.values(h))x.dispose();}
}finally{f.dispose();}
fs.writeFileSync(out+'/report.json',JSON.stringify({scope:'Two phase actual manual createPetRenderer with unmodified production source helper/selector/artist after parent integration, no candidate-selection injection. Offscreen Skia. DPR1 and DPR2 are independently rendered, same immutable frame and actual stage transforms in all diagnostics. Not production/native/lifecycle/full-cycle acceptance.',records,guard:F.guard.snapshot()},null,2));
// Native and 2x panels use independently rendered stages at their original sizes.
for (const now of [1250, 3750]) {
  const panel = f.backend.createCanvas(1360, 980), ctx = panel.getContext('2d');
  for (const [j, background] of ['#f5f1e9', '#252735'].entries()) {
    const y = j * 490; ctx.fillStyle = background; ctx.fillRect(0, y, 1360, 490);
    for (const [i, mode] of ['current', 'candidate'].entries()) {
      const x = i * 680; ctx.font = '15px sans-serif'; ctx.fillStyle = j ? '#eeeeee' : '#333333';
      ctx.fillText(`${mode} | t=${now} ms | independent DPR1 native / DPR2`, x + 8, y + 20);
      for (const [dpr, dx, dy] of [[1, 8, 140], [2, 235, 38]]) {
        const im = await f.backend.loadImage(path.join(out, `${mode}-${now}-dpr${dpr}.png`));
        ctx.imageSmoothingEnabled = false; ctx.drawImage(im, x + dx, y + dy);
      }
    }
  }
  fs.writeFileSync(path.join(out, `comparison-${now}-native-2x-light-dark.png`), panel.toBuffer('image/png'));
}
