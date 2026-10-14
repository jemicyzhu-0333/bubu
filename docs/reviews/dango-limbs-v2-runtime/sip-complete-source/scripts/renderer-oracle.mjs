import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {readOptions,loadFixture} from './candidate-fixture.mjs';
const cli=readOptions(),root=cli.repo+'/',out=cli.out+'/';
const {createCandidateArtist,createLegacyArtist}=await loadFixture(cli.repo);
fs.mkdirSync(out+'frames',{recursive:true});
const {createCanvas,loadImage}=createRequire(root+'package.json')('@napi-rs/canvas');
const {PET_ACTIONS}=await import(root+'src/content/behaviors.mjs');const{PALETTES}=await import(root+'src/core/pet-art.mjs');
const options={loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas};
const candidate=createCandidateArtist(options),legacy=createLegacyArtist(options);await Promise.all([candidate.ready({all:true}),legacy.ready({all:true})]);
const action=PET_ACTIONS['sip-tea'],dprs=[1,1.25,1.5,2,4],phases=257,start=cli.start,end=cli.end;
if(end-start>31)throw Error('Bound this renderer worker to at most32 phases; use run-review.mjs for the complete serial audit.');
const surfaceScales=new WeakMap();
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const frameMeta=JSON.parse(fs.readFileSync(root+'assets/companion/dango/raster/action-contact/sip-front-v2/frames.json'));
const assetHashes=Object.fromEntries(frameMeta.frames.map(f=>[f.id,f.sha256]));
const rows=[],phaseRows=[],entryExit=[],summary={phases,dprs,rasterSamples:(end-start+1)*dprs.length,sourceInactive:0,bodyOrCupChanges:0,sourceMatrixFailures:0,faceOverlapPixels:0,rootExposedPixels:0,rootBelow240Pixels:0,maxRootResidualAlpha:0,maxContactPixelGap:0,maxCupTranslationStepArt:0,nonFinitePixels:0};
const buffers=new Map(dprs.map(d=>{const size=Math.ceil(146*1.5*d);return[d,Object.fromEntries(['root','body','oldbody','face','cup','left','right'].map(k=>{const c=createCanvas(size,size);surfaceScales.set(c,1.5*d);return[k,c];}))];}));
function setup(c,artist,p){const x=c.getContext('2d');x.resetTransform();x.clearRect(0,0,c.width,c.height);x.scale(surfaceScales.get(c),surfaceScales.get(c));artist.applyMotionTransform(x,action.motion,p,{action,bodySize:66,size:146,translate:(a,b)=>x.translate(a,b)});const o=artist.motionOffset(action.motion,p,false,{action});x.translate(40+o.x,40+o.y);return x;}
function drawPart(c,artist,art,p,part){const x=setup(c,artist,p),matrix=x.getTransform(),o={action,artwork:art,palette:PALETTES.pink,view:art.view,progress:p};
 if(part==='body'||part==='oldbody')artist.body(x,PALETTES.pink,art.view,art);
 else if(part==='face')artist.face(x,PALETTES.pink,{},false,art.view,null,art);
 else {const tools=part==='root'?art.contact.tools.filter(t=>t.sourceContactLayer==='sip-front-v2'):part==='cup'?art.contact.tools.filter(t=>t.key==='cup'):[];
 const hands=part==='left'||part==='right'?art.contact.hands.filter(h=>h.side===part):[];
 const isolated={...art,hiddenParts:[...new Set([...(art.hiddenParts||[]),'ear-left','ear-right','foot-left','foot-right'])],contact:{...art.contact,tools,hands,details:[]}};
 artist.action(x,{...o,artwork:isolated,layer:part==='root'?'back':'front'});}
 return{data:x.getImageData(0,0,c.width,c.height).data,matrix,w:c.width,h:c.height};}
function nearestGap(hand,cup,target,matrix,w,h){const tx=matrix.a*target[0]+matrix.c*target[1]+matrix.e,ty=matrix.b*target[0]+matrix.d*target[1]+matrix.f,s=Math.hypot(matrix.a,matrix.b),r=Math.ceil(3*s),hp=[],cp=[];
 for(let y=Math.max(0,Math.floor(ty-r));y<Math.min(h,Math.ceil(ty+r));y++)for(let x=Math.max(0,Math.floor(tx-r));x<Math.min(w,Math.ceil(tx+r));x++){const i=(y*w+x)*4+3;if(hand[i]>127)hp.push([x,y]);if(cup[i]>127)cp.push([x,y]);}
 let min=Infinity;for(const a of hp)for(const b of cp){const d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(d<min)min=d;if(min===0)break;}return{pixelCenterDistance:min,pixelGap:Number.isFinite(min)?Math.max(0,min-1):null,handPixels:hp.length,cupPixels:cp.length};}
function paintStage(c,artist,art,p,x,y,scale){const ctx=c.getContext('2d');ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);artist.applyMotionTransform(ctx,action.motion,p,{action,bodySize:66,size:146,translate:(a,b)=>ctx.translate(a,b)});const off=artist.motionOffset(action.motion,p,false,{action});ctx.translate(40+off.x,40+off.y);const o={action,artwork:art,palette:PALETTES.pink,view:art.view,progress:p};artist.action(ctx,{...o,layer:'back'});artist.body(ctx,PALETTES.pink,art.view,art);artist.face(ctx,PALETTES.pink,{},false,art.view,null,art);artist.action(ctx,{...o,layer:'front'});ctx.restore();}
const oldPlans={};for(const side of ['left','right'])oldPlans[side]=await loadImage(root+`assets/companion/dango/raster/action-contact/sip-front-v1/${side}-logical.png`);
function oldDiagnostic(art,delta){return{...art,limbPainter:{paint(ctx,{hand,layer,covered}){if(layer==='front'&&!covered){ctx.save();ctx.imageSmoothingEnabled=false;ctx.globalAlpha*=hand.opacity??1;ctx.drawImage(oldPlans[hand.side],...delta);ctx.restore();}return true;}},contact:{...art.contact,hands:art.contact.hands.map(h=>({...h,limb:true}))}};}
let previousCup=null;
for(let i=start;i<=end;i++){
 const p=i/256,opts={action,motion:action.motion,view:'front',progress:p,elapsedMs:p*action.duration,channel:'pet',actionInstanceKey:'full-source-oracle-1'};
 const art=candidate.resolveArtwork(opts),old=legacy.resolveArtwork(opts),cup=art.contact.tools.find(t=>t.key==='cup'),oldCup=old.contact.tools.find(t=>t.key==='cup'),delta=[cup.x-23,cup.y-43];
 if(art.sourceContactPose!=='sip-front-v2'){summary.sourceInactive++;throw Error(`Candidate source inactive phase ${p}; cup ${JSON.stringify(cup)}`);}
 const bodyAndCup=JSON.stringify(cup)===JSON.stringify(oldCup)&&JSON.stringify(art.matrices)===JSON.stringify(old.matrices);
 if(!bodyAndCup)summary.bodyOrCupChanges++;
 const matrices=art.contact.hands.every(h=>h.pawMatrix.every((v,k)=>Math.abs(v-[1,0,0,1,...delta][k])<1e-12))&&art.contact.tools.filter(t=>t.sourceContactLayer==='sip-front-v2').every(t=>t.x===delta[0]&&t.y===delta[1]);if(!matrices)summary.sourceMatrixFailures++;
 const step=previousCup?Math.hypot(cup.x-previousCup.x,cup.y-previousCup.y):0;summary.maxCupTranslationStepArt=Math.max(summary.maxCupTranslationStepArt,step);previousCup=cup;
 phaseRows.push({p,cup,sourceContactPose:art.sourceContactPose,cupDelta:delta,sourceMatricesFixed:matrices,bodyAndCupUnchanged:bodyAndCup,sourceAssetHashes:assetHashes});
 for(const dpr of dprs){const b=buffers.get(dpr),parts={};for(const k of Object.keys(b))parts[k]=drawPart(b[k],k==='oldbody'?legacy:candidate,k==='oldbody'?old:art,p,k);
  let exposed=0,below240=0,residualMax=0,faceOverlap=0,bodyDifferences=0;const count=parts.root.data.length;
  for(let q=3;q<count;q+=4){const r=parts.root.data[q],body=parts.body.data[q],fore=Math.max(parts.left.data[q],parts.right.data[q]);if(r>0&&body===0)exposed++;if(r>0&&body<240)below240++;residualMax=Math.max(residualMax,r*(255-body)/255);if(fore>0&&parts.face.data[q]>0)faceOverlap++;
   if(parts.body.data[q]!==parts.oldbody.data[q]||parts.body.data[q-1]!==parts.oldbody.data[q-1]||parts.body.data[q-2]!==parts.oldbody.data[q-2]||parts.body.data[q-3]!==parts.oldbody.data[q-3])bodyDifferences++;
  }
  const contacts={};for(const side of ['left','right']){const t=art.contact.hands.find(h=>h.side===side).sourceContact.target;contacts[side]=nearestGap(parts[side].data,parts.cup.data,t,parts.cup.matrix,parts.cup.w,parts.cup.h);summary.maxContactPixelGap=Math.max(summary.maxContactPixelGap,contacts[side].pixelGap??Infinity);}
  summary.faceOverlapPixels+=faceOverlap;summary.rootExposedPixels+=exposed;summary.rootBelow240Pixels+=below240;summary.maxRootResidualAlpha=Math.max(summary.maxRootResidualAlpha,residualMax);if(bodyDifferences)summary.bodyOrCupChanges++;
  rows.push({p,dpr,sourceContactPose:art.sourceContactPose,rootExposedPixels:exposed,rootBodyAlphaBelow240Pixels:below240,maxRootResidualAlpha:residualMax,faceOverlapPixels:faceOverlap,bodyPixelDifferences:bodyDifferences,contacts});
 }
 const diag=oldDiagnostic(old,delta),c=createCanvas(1320,790),ctx=c.getContext('2d');ctx.fillStyle='#eeeae4';ctx.fillRect(0,0,1320,790);
 const arts=[old,diag,art],artists=[legacy,legacy,candidate],labels=['Legacy unchanged','Old v2b: forced diagnostic only','New sip source: test injection'];
 for(let col=0;col<3;col++){const x=col*440;ctx.fillStyle='#222';ctx.font='16px sans-serif';ctx.fillText(labels[col],x+12,24);ctx.font='13px sans-serif';ctx.fillText('Native body design width 99 CSS px',x+12,45);paintStage(c,artists[col],arts[col],p,x+110,55,1.5);ctx.fillStyle='#20232a';ctx.fillRect(x,305,440,485);paintStage(c,artists[col],arts[col],p,x+1,305,3);ctx.fillStyle='#ddd';ctx.fillText('2x body design width 198 CSS px',x+12,750);ctx.fillText(`front sip  p=${p.toFixed(4)}  ${i}/256  Offscreen, disabled gate`,x+12,772);}
 fs.writeFileSync(out+`frames/${String(i).padStart(3,'0')}.png`,c.toBuffer('image/png'));
 if([0,64,128,192,256].includes(i))fs.writeFileSync(out+`three-column-p${p}.png`,c.toBuffer('image/png'));
 c.width=1;c.height=1;if(global.gc&&i%8===0)global.gc();if(i%16===0)console.log(JSON.stringify({done:i+1,total:phases,summary}));
}
for(const [label,a,p,key,view]of [['idle-before',null,0,'transition-idle','front'],['sip-enter',action,0,'transition-sip','front'],['sip-mid',action,.5,'transition-sip','front'],['sip-end',action,1,'transition-sip','front'],['idle-after',null,0,'transition-after','front'],['sip-new',action,0,'transition-next','front'],['wave-cancel',PET_ACTIONS.wave,.1,'transition-wave','front'],['sip-reenter',action,0,'transition-next-2','front'],['wrong-view',action,.3,'transition-next-2','three-quarter'],['front-after-ineligible',action,.5,'transition-next-2','front'],['front-new-instance',action,0,'transition-next-3','front']]){
 const art=candidate.resolveArtwork({action:a,motion:a?.motion||'idle',view,progress:p,elapsedMs:p*(a?.duration||1),channel:'pet',actionInstanceKey:key});
 entryExit.push({label,sourceContactPose:art.sourceContactPose||null,rootCount:art.contact?.tools.filter(t=>t.sourceContactLayer==='sip-front-v2').length||0,sourceFrontCount:art.contact?.hands.filter(h=>h.sourceContact?.sourcePoseId==='sip-front-v2').length||0});
}
const report={batch:{start,end},status:'Full standard-artist source-injection audit; visual acceptance separate',runtimeReady:false,hostAcceptance:null,backend:'Actual requested repository production selector and standard raster artist; only four source gates enabled in an in-memory test clone; offscreen Skia, not browser/native host',sourceProjection:'Only frozen 66x72 / exact8x source PNGs consumed, never raw re-quantization by phase or DPR',assetHashes,summary,entryExit,rawSourceException:'Initial p0 left had 6/14259 original opaque root samples outside body before fixed projection. Preserved source; not erased or promoted to full raw coverage.',phaseRows,rows};
fs.writeFileSync(out+`batch-${start}-${end}-report.json`,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(out+`batch-${start}-${end}-summary.json`,JSON.stringify({...report,phaseRows:phaseRows.length,rows:rows.length},null,2)+'\n');console.log(JSON.stringify({summary,entryExit}));candidate.dispose();legacy.dispose();
