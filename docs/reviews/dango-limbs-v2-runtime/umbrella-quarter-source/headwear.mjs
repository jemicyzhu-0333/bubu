import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from './fixture.mjs';
import { readPaths } from './cli.mjs';
const { root, out: artifactRoot } = readPaths();
const out = path.join(artifactRoot, 'headwear');
const phases=[1250,2500,3750,6250,8750], modes=['current','candidate','omitted'];
for(const sub of ['images','masks','frames','sheets'])fs.mkdirSync(path.join(out,sub),{recursive:true});
const transforms={};globalThis.captureUmbrellaTransform=(mode,value)=>transforms[mode]=value;
const f=await fixture(root,out,{modes}), F=f.F, records=[], errors=[];
const directory=f.sources.candidate.wardrobe.PET_APPEARANCE_ITEMS;
const heads=directory.filter(item=>item.formId==='dango'&&item.slot==='head');
const outfits=[...heads.map(item=>({id:item.id,skin:item.skin||'pink',items:[item.id],calm:false})),
 {id:'heavy',skin:'forest',items:['milestone.sunhat','milestone.halo','skin.forest-leaf','milestone.cape','milestone.scarf','milestone.satchel','milestone.boots'],calm:false},
 {id:'heavy-calm',skin:'forest',items:['milestone.sunhat','milestone.halo','skin.forest-leaf','milestone.cape','milestone.scarf','milestone.satchel','milestone.boots'],calm:true}];
const masks={};
const dimensions=c=>[c.width,c.height];
const pix=c=>c.getContext('2d').getImageData(0,0,...dimensions(c)).data;
const hash=data=>createHash('sha256').update(data).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function currentState(context){const m=context.getTransform();return {matrix:['a','b','c','d','e','f'].map(k=>m[k]),alpha:context.globalAlpha,smoothing:context.imageSmoothingEnabled,composite:context.globalCompositeOperation};}
function apply(context,state){context.setTransform(...state.matrix);context.globalAlpha=state.alpha;context.imageSmoothingEnabled=state.smoothing;context.globalCompositeOperation=state.composite;}
function mirrorPaint(canvas,context,paint){const c=canvas.getContext('2d');c.save();apply(c,currentState(context));try{return paint(c);}finally{c.restore();}}
function clearMasks(mode,width,height){masks[mode]={head:f.backend.createCanvas(width,height),face:f.backend.createCanvas(width,height),prop:f.backend.createCanvas(width,height),frontWardrobe:f.backend.createCanvas(width,height),frontAction:f.backend.createCanvas(width,height)};}
for(const mode of modes){
 const real=F.originals[mode];
 F.artists[mode].appearance=(context,options)=>{
  const result=real.appearance(context,options);
  if(masks[mode]&&options.item?.slot==='head')mirrorPaint(masks[mode].head,context,c=>real.appearance(c,options));
  if(masks[mode]&&options.layer==='front')mirrorPaint(masks[mode].frontWardrobe,context,c=>real.appearance(c,options));
  return result;
 };
 F.artists[mode].action=(context,options)=>{
  const result=real.action(context,options);
  if(masks[mode]&&options.layer==='front')mirrorPaint(masks[mode].frontAction,context,c=>real.action(c,options));
  return result;
 };
 F.artists[mode].face=(context,...args)=>{
  const result=real.face(context,...args);
  if(masks[mode])mirrorPaint(masks[mode].face,context,c=>real.face(c,...args));
  return result;
 };
}
function stats(a,b,head,face,front,frontAction,oldFrontAction){let oldFrontActionFaceOverlap=0,faceChangesOutsideOldFrontAction=0,frontActionFaceOverlap=0,headPixels=0,headStageChanges=0,headFaceOverlap=0,frontFaceOverlap=0,facePixels=0,faceStageChanges=0,totalChanges=0;
 for(let i=0;i<a.length;i+=4){const changed=[0,1,2,3].some(k=>a[i+k]!==b[i+k]);if(changed)totalChanges++;if(head[i+3]){headPixels++;if(changed)headStageChanges++;if(face[i+3])headFaceOverlap++;}if(face[i+3]){facePixels++;if(changed)faceStageChanges++;if(front[i+3])frontFaceOverlap++;if(frontAction[i+3])frontActionFaceOverlap++;if(oldFrontAction[i+3])oldFrontActionFaceOverlap++;else if(changed)faceChangesOutsideOldFrontAction++;}}
 return {oldFrontActionFaceOverlap,faceChangesOutsideOldFrontAction,frontActionFaceOverlap,headPixels,headStageChanges,headFaceOverlap,frontFaceOverlap,facePixels,faceStageChanges,totalChanges};
}
function difference(a,b){let pixels=0,alphaPixels=0;for(let i=0;i<a.length;i+=4){if([0,1,2,3].some(k=>a[i+k]!==b[i+k]))pixels++;if(a[i+3]!==b[i+3])alphaPixels++;}return{pixels,alphaPixels};}
function checkDrawOrder(calls){const positions={};
 for(const[name,file]of Object.entries({propBack:'umbrella-back.png',palmBack:'right-back-8x.png',propFront:'umbrella-front.png',palmFront:'right-front-8x.png'})){
  const matches=calls.map((call,index)=>({call,index})).filter(({call})=>call.sources.some(src=>src.endsWith('/umbrella-quarter-handle-v1/'+file)));
  assert.equal(matches.length,1,name+' actual draw count');positions[name]=matches[0].index;
 }
 positions.body=calls.findIndex(call=>call.sources.some(src=>src.endsWith('/views/three-quarter-right/body.png')));
 assert(positions.propBack<positions.palmBack&&positions.palmBack<positions.body&&positions.body<positions.propFront&&positions.propFront<positions.palmFront,'actual stage four-source depth order');
 assert.deepEqual(calls[positions.propBack].matrix,calls[positions.propFront].matrix,'same actual prop matrix');
 assert.deepEqual(calls[positions.palmBack].matrix,calls[positions.palmFront].matrix,'same actual palm matrix');
 assert.deepEqual(calls[positions.propBack].draw,[0,0,50,66]);assert.deepEqual(calls[positions.propFront].draw,[0,0,50,66]);
 return positions;
}
function seal(){const files=['src/content/appearance.mjs','src/surfaces/pet/renderer.mjs','src/capabilities/companion/presentation/dango-umbrella-quarter-contact-pose.mjs','src/capabilities/companion/presentation/dango-source-contact-pose.mjs','src/capabilities/companion/presentation/dango-raster-art.mjs','src/capabilities/companion/presentation/dango-raster-appearance.mjs','assets/companion/dango/raster/dango.raster.mjs'];return Object.fromEntries(files.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));}
const beforeSeal=seal();
try {
 F.guard.assertLoaded();
 for(const outfit of outfits)for(const dpr of[1,2])for(const facing of[1,-1]){
  const h={};
  for(const mode of modes){const source=f.sources[mode];
   h[mode]=f.createRenderHarness(source,{skin:outfit.skin,outfit:outfit.items,dpr,facing,calm:outfit.calm,blink:false,view:'auto',expressionFor:state=>source.behaviors.PET_ACTIONS[state.currentEgg?.id]?.expression||'life.idle'});
   h[mode].select('expression','life.idle');
   h[mode].updateState({renderChannel:'pet',devPreview:null,currentEgg:{...source.interactionPlayback.createManualActionPlayback(source.behaviors,'umbrella-dance',{formId:'dango'}),presentationEventId:'umbrella-headwear-production'},actionStartedAt:0});
   F.trace.register(mode,h[mode].body);
   const context=h[mode].body.getContext('2d'),draw=context.drawImage.bind(context);
   context.drawImage=(image,...args)=>{const state=currentState(context),result=draw(image,...args),call=F.trace.read(mode).at(-1);
    if(masks[mode]&&call?.sources.some(src=>src.endsWith('/tools/umbrella.png')||/\/umbrella-quarter-handle-v1\/umbrella-(back|front)\.png$/.test(src))){const c=masks[mode].prop.getContext('2d');c.save();apply(c,state);c.drawImage(image,...args);c.restore();}
    return result;
   };
  }
  F.guard.observeFinalStage(h.candidate.body);F.omission.observeFinalStage(h.omitted.body);
  const timeline=[];let calmHash=null;
  for(const now of[0,...phases]){
   timeline.push(now);
   for(const mode of modes){clearMasks(mode,...dimensions(h[mode].body));F.trace.begin(mode);h[mode].draw(now);}
   if(now===0)continue;
   const label=`${outfit.id}-dpr${dpr}-${facing===1?'right':'left'}-${now}`,issues=[];
   try{
    const art=F.traces.candidate.art,old=F.traces.current.art,omitted=F.traces.omitted.art;
    assert.equal(art.sourceContactPose,'umbrella-quarter-handle-v1');assert.equal(art.view,'three-quarter');assert.equal(F.traces.candidate.options.view,'three-quarter');
    assert.equal(art.ready,true);assert.equal(art.wardrobe.ready,true);assert.deepEqual(art.suppressedAppearanceSlots,[]);
    assert.deepEqual(art.data,old.data);assert.deepEqual(art.matrices,old.matrices);assert.deepEqual(art.footwearTransforms,old.footwearTransforms);assert.deepEqual(art.wardrobe,old.wardrobe);
    assert.deepEqual(F.traces.candidate.options.appearance.items.map(i=>i.id).sort(),[...outfit.items].sort());
    const actualFrame=f.sources.candidate.controls.at(-1).lastFrame;
    for(const mode of modes){assert.deepEqual(f.sources[mode].controls.at(-1).lastFrame,actualFrame);assert.deepEqual(transforms[mode],transforms.candidate);}
    const frame={actual:actualFrame,seed:0x55a61,blinkSeed:0x913a7,dpr,timeline:[...timeline],background:'transparent'};
    const proof=F.guard.assertContribution({targetId:'front-palm',stage:h.candidate.body,omittedStage:h.omitted.body,artwork:art,omittedArtwork:omitted,renderInputs:{manifest:F.manifests.candidate,frame},omittedRenderInputs:{manifest:F.manifests.omitted,frame:{...frame,actual:f.sources.omitted.controls.at(-1).lastFrame}},label});
    const calls=F.trace.read('candidate'),oldCalls=F.trace.read('current'),actualDrawOrder=checkDrawOrder(calls);
    const expectedHeadSources=outfit.items.map(id=>directory.find(item=>item.id===id)).filter(item=>item.slot==='head').flatMap(item=>{const view=F.manifests.candidate.appearance[item.renderKey].views['three-quarter'];return[...(view.back||[]),...(view.front||[])].map(sprite=>sprite.src);});
    const headDrawCalls=[];
    for(const suffix of expectedHeadSources){const cs=calls.filter(call=>call.sources.some(src=>src.endsWith('/'+suffix))),os=oldCalls.filter(call=>call.sources.some(src=>src.endsWith('/'+suffix)));assert.equal(cs.length,1,'head layer '+suffix);assert.deepEqual(cs,os,'head layer draw preservation '+suffix);headDrawCalls.push(...cs);}
    const currentHead=pix(masks.current.head),candidateHead=pix(masks.candidate.head),candidateFace=pix(masks.candidate.face);
    assert.deepEqual(candidateHead,currentHead,'same-stage exact headwear mask preservation');
    assert.deepEqual(candidateFace,pix(masks.current.face),'same-stage exact face mask preservation');
    const s=stats(pix(h.candidate.body),pix(h.current.body),candidateHead,candidateFace,pix(masks.candidate.frontWardrobe),pix(masks.candidate.frontAction),pix(masks.current.frontAction));
    assert(s.headPixels>0);assert(s.facePixels>0);assert.equal(s.headStageChanges,0,'no changed final pixels inside real headwear mask');assert.equal(s.headFaceOverlap,0,'no headwear/face overlap');assert.equal(s.frontActionFaceOverlap,0,'no actual front action/face overlap');assert.equal(s.frontFaceOverlap,0,'no front wardrobe/face overlap');
    const propDifference=difference(pix(masks.candidate.prop),pix(masks.current.prop));assert.equal(propDifference.pixels,0,'actual final-stage split prop draws retain all original umbrella pixels');assert.equal(s.faceChangesOutsideOldFrontAction,0,'face deltas are confined to removed old front-action occlusion');
    const finalHash=hash(pix(h.candidate.body));if(outfit.calm){if(calmHash)assert.equal(finalHash,calmHash,'calm actual stage remains static');calmHash=finalHash;}
    const record={label,outfit,dpr,facing,now,phase:F.traces.candidate.options.progress,view:art.view,sourceContactPose:art.sourceContactPose,proof,stats:s,propMaskDifference:propDifference,actualDrawOrder,actualDrawCalls:calls,headDrawCalls,transform:transforms.candidate,stageSize:dimensions(h.candidate.body),stageSha256:finalHash,headMaskSha256:hash(candidateHead),faceMaskSha256:hash(candidateFace),frameFile:`frames/${label}.json`,imageFile:`images/${label}.png`};records.push(record);
    fs.writeFileSync(path.join(out,record.frameFile),JSON.stringify({frame,artwork:art,options:F.traces.candidate.options},null,2));
    fs.writeFileSync(path.join(out,record.imageFile),h.candidate.body.toBuffer('image/png'));
    if(now===3750)for(const kind of['head','face','prop','frontWardrobe','frontAction'])fs.writeFileSync(path.join(out,`masks/${label}-${kind}.png`),masks.candidate[kind].toBuffer('image/png'));
    if(now===3750){fs.writeFileSync(path.join(out,`masks/${label}-current.png`),h.current.body.toBuffer('image/png'));fs.writeFileSync(path.join(out,`masks/${label}-currentFrontAction.png`),masks.current.frontAction.toBuffer('image/png'));} 
   }catch(error){errors.push({label,error:error.message,stack:error.stack});fs.writeFileSync(path.join(out,`images/FAILED-${label}.png`),h.candidate.body.toBuffer('image/png'));console.error(label,error.message);}
  }
  for(const harness of Object.values(h))harness.dispose();
  console.log(JSON.stringify({outfit:outfit.id,dpr,facing,passed:records.length,failed:errors.length}));
 }
}finally{f.dispose();}
const afterSeal=seal();assert.deepEqual(afterSeal,beforeSeal,'production source changed during matrix');
const result={scope:'Actual production default manual umbrella-dance at auto three-quarter view. No pose-selection injection. Offscreen Skia final-stage evidence, not native Windows/macOS or GPU acceptance. current is a pre-integration fallback control with source runtimeReady flags disabled; candidate is unmodified production; omitted only removes actual front palm pixels.',headCatalog:heads.map(({id,label,skin,renderKey})=>({id,label,skin,renderKey})),phases,caseCount:records.length,expectedCases:outfits.length*2*2*phases.length,errors,maskMethod:'Read-only invocation of the real wardrobe/face painter with the identical actual Artwork, options, CTM, alpha, smoothing and compositing on an independent same-size stage; no frame/manifest mutation and no body-cache coordinate comparisons. Prop masks replay the actual drawImage calls at their final-stage CTMs. Whole-stage pixel equality within actual headwear mask proves retained visible head pixels, while draw counts and per-call equality prove each authored head layer remains present.',records,guard:F.guard.snapshot(),sourceSeal:afterSeal};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:records.length,expected:result.expectedCases,failed:errors.length,headItems:heads.length,report:path.join(out,'report.json')}));

const metricRange = select => records.length
  ? [Math.min(...records.map(select)), Math.max(...records.map(select))] : null;
const summary = {
  status: errors.length ? 'failed' : 'passed', cases: records.length,
  expectedCases: result.expectedCases, headCatalog: result.headCatalog,
  coverage: { headSlots: 200, sevenItemHeavyOutfit: 20, sevenItemHeavyCalm: 20,
    dpr: [1, 2], facing: [1, -1], timestampsMs: phases,
    actualDefaultView: 'three-quarter', previewForced: false },
  results: {
    sourceSelected: records.every(row => row.sourceContactPose === 'umbrella-quarter-handle-v1'),
    frontPalmSourceGuardChangedPixels: metricRange(row => row.proof.changedPixels),
    headwearFinalStageChangedPixels: metricRange(row => row.stats.headStageChanges),
    headwearFaceOverlap: metricRange(row => row.stats.headFaceOverlap),
    frontWardrobeFaceOverlap: metricRange(row => row.stats.frontFaceOverlap),
    newFrontActionFaceOverlap: metricRange(row => row.stats.frontActionFaceOverlap),
    oldFrontActionFaceOverlap: metricRange(row => row.stats.oldFrontActionFaceOverlap),
    faceChangesOutsideOldFrontAction: metricRange(row => row.stats.faceChangesOutsideOldFrontAction),
    propReconstructionChangedPixels: metricRange(row => row.propMaskDifference.pixels),
    fourSourceDepthOrder: 'propBack < palmBack < body < propFront < palmFront',
    propLayersIdenticalActualMatrices: errors.length === 0,
    palmLayersIdenticalActualMatrices: errors.length === 0,
    calmFinalStageStableAcrossFiveTimestamps: errors.length === 0
  },
  sourceSeal: afterSeal, errors,
  scope: result.scope,
  notes: ['Face painter masks remain identical. All old-versus-new face pixel differences are confined to the removed old front-action overlap.',
    'All masks are on the real stage dimensions and transforms. No body-cache coordinate comparisons are used.',
    'This offscreen matrix is not native Windows/macOS, GPU, full lifecycle, or all wardrobe combinations acceptance.']
};
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));

if(errors.length)process.exitCode=1;
