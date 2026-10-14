'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');const {spawn}=require('node:child_process'),{once}=require('node:events');
const repo=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const from=p=>require(path.join(repo,p));const backend=from('node_modules/@napi-rs/canvas');
(async()=>{
 const {installOffscreenImages}=await import(pathToFileURL(path.join(repo,'tools/usagi-gallery/offscreen-images.mjs')));
 installOffscreenImages(backend);global.Path2D=backend.Path2D;
 global.document={createElement:()=>backend.createCanvas(1,1)};
 const artist=from('src/capabilities/companion/presentation/dango-raster-production.mjs').default;
 await artist.ready({all:true});
 const content=from('src/content'),{createPetCatalog}=from('src/capabilities/companion/pet-catalog');
 const catalog=createPetCatalog({content,skins:from('src/skins.mjs').SKINS});
 const entry=catalog.actions.find(x=>x.id==='ordinary-walk-in-place');assert.ok(entry,'gate must be explicitly enabled in isolated validation copy');
 assert.ok(!content.PET_ACTIONS[entry.id]);assert.ok(!content.EASTER_EGGS.some(x=>x.id===entry.id));
 const payload={...content,PET_CATALOG:catalog,manifest:from('src/core/content-pack').adaptLegacyPetContent(content)};
 const {createPetRuntimeFixture}=from('test-support/pet-runtime-fixture');
 const create=createPetRuntimeFixture({contentPayload:payload,styleProperties:true,liveReducedMotion:true});
 const results=[];
 for(const dpr of[1,1.25,1.5,2]){
  const canvases={},trace=[];let currentTrace=[];
  const h=create({devicePixelRatio:dpr,initialState:{devMode:true,appearanceItemIds:[]},prepareEnvironment({document,window}){
   const oldCreate=document.createElement.bind(document);
   document.createElement=tag=>tag==='canvas'?backend.createCanvas(1,1):oldCreate(tag);
   for(const id of['#petCanvas','#sceneCanvas','#overlayCanvas']){
    const el=document.querySelector(id),c=backend.createCanvas(id==='#petCanvas'?219:480,id==='#petCanvas'?219:360),ctx=c.getContext('2d');canvases[id]=c;
    for(const key of['width','height'])Object.defineProperty(el,key,{get:()=>c[key],set:x=>{c[key]=Math.max(1,x)}});
    el.getContext=()=>ctx;
    if(id==='#petCanvas'){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>{const m=ctx.getTransform();currentTrace.push({source:image.localSource||'',width:image.width,height:image.height,matrix:[m.a,m.b,m.c,m.d,m.e,m.f],args});return draw(image,...args)};}
   }
   global.document=document;global.window=window;
  }});
  await new Promise(r=>setImmediate(()=>setImmediate(()=>setImmediate(r))));
  h.bridge.handlers.sync({devMode:true,appearanceItemIds:[],stimulationMode:'high',motionMode:'full'});
  const hit=h.document.getElementById('petHit');
  hit.dispatch('pointerdown',{isPrimary:true,button:0,ctrlKey:false,pointerId:1,screenX:100,screenY:100});
  await new Promise(r=>setImmediate(()=>setImmediate(r)));h.clockState.now+=100;
  hit.dispatch('pointermove',{pointerId:1,screenX:60,screenY:100});
  hit.dispatch('pointercancel',{pointerId:1});assert.equal(h.runtime.sample().facing,-1);
  h.frameBy(25);fs.writeFileSync(path.join(out,`dpr-${dpr}-left-before.png`),canvases['#petCanvas'].toBuffer('image/png'));
  h.bridge.handlers.devtools({open:true});
  const button=h.document.getElementById('devToolsList').children.flatMap(s=>s.children).flatMap(g=>g.children).find(b=>b.dataset.devId===entry.id);assert.ok(button);button.dispatch('click');
  const previous=new Map(),frames=[],runtimeFacings=new Set();let plantedPairs=0,lifted=0,maxBounds=0;
  const panel=backend.createCanvas(438,260),pc=panel.getContext('2d');
  const ff=dpr===1?spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size','438x260','-framerate','40','-i','-','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,'workbench-step-in-place.mp4')],{stdio:['pipe','ignore','pipe']}):null;
  const ffDone=ff?once(ff,'close'):null;let ffErr='';ff?.stderr.on('data',b=>ffErr+=b);
  async function video(label){if(!ff)return;pc.clearRect(0,0,438,260);for(let j=0;j<2;j++){const x=j*219;pc.fillStyle=j?'#202331':'#f4f4ee';pc.fillRect(x,0,219,260);pc.fillStyle=j?'#ededdf':'#252630';pc.font='10px sans-serif';pc.fillText(label,x+6,13);pc.fillText('Actual runtime + workbench event fixture',x+6,26);pc.fillStyle='#879082';pc.fillRect(x,190,219,1);for(let k=0;k<219;k+=15)pc.fillRect(x+k,190,1,4);pc.drawImage(canvases['#petCanvas'],x,34,219,219);}pc.fillStyle='#65817d';pc.font='9px sans-serif';pc.fillText('99 CSS px body width. Skia only; no native/browser acceptance.',6,257);if(!ff.stdin.write(Buffer.from(pc.getImageData(0,0,438,260).data)))await once(ff.stdin,'drain');}
  const hash=()=>createHash('sha256').update(canvases['#petCanvas'].getContext('2d').getImageData(0,0,canvases['#petCanvas'].width,canvases['#petCanvas'].height).data).digest('hex');
  for(let i=0;i<660;i++){
   currentTrace=[];h.frameBy(25);const state=h.runtime.sample(),foot=currentTrace.filter(c=>/views\/three-quarter-right\/foot-(left|right)\.png/.test(c.source));
   assert.equal(state.facing,-1,'presentation cannot write drag-facing');runtimeFacings.add(state.facing);
   if(foot.length){assert.equal(foot.length,2);assert.ok(foot.every(f=>f.matrix[0]>0),'native workbench source is never reflected');for(const call of foot){const side=call.source.includes('foot-left')?'left':'right';const old=previous.get(side),y=call.matrix[5];if(old&&Math.abs(y-old.y)<1e-7&&Math.abs(y-60*dpr)<1e-7){assert.equal(call.matrix[4],old.x);plantedPairs++;}if(y<60*dpr-.01)lifted++;previous.set(side,{x:call.matrix[4],y});}}
   if([0,45,85,115,155,195,245,287,288,400,575].includes(i)){const file=`dpr-${dpr}-frame-${i}.png`;fs.writeFileSync(path.join(out,file),canvases['#petCanvas'].toBuffer('image/png'));frames.push({i,now:state.animNow,progress:state.actionProgress,runtimeFacing:state.facing,file,foot});}
   await video(`Step-in-place | ${(state.animNow/1000).toFixed(2)}s`);
   if(i%10===0)await new Promise(r=>setImmediate(r));
  }
  assert.ok(lifted>50,'real feet must lift');assert.ok(plantedPairs>100,'planted world comparisons');
  const lifecycle={leftDrag:{runtimeFacing:-1,nativePreviewUnreflected:true}};
  h.bridge.handlers.sync({paused:true});h.frameBy(25);const pausedProgress=h.runtime.sample().actionProgress,pausedHash=hash();for(let j=0;j<80;j++){h.frameBy(25);await video('Session pause | all artwork held');}
  lifecycle.pause={progressStable:h.runtime.sample().actionProgress===pausedProgress,pixelsStable:hash()===pausedHash};
  assert.ok(lifecycle.pause.progressStable);assert.ok(lifecycle.pause.pixelsStable,'pause should freeze complete artwork');
  h.bridge.handlers.sync({paused:false});h.frameBy(25);assert.equal(h.runtime.sample().actionProgress,pausedProgress);h.frameBy(25,4);assert.ok(h.runtime.sample().actionProgress>pausedProgress);
  h.bridge.handlers.sync({motionMode:'reduced'});h.frameBy(200);const reducedHash=hash();for(let j=0;j<8;j++){h.frameBy(200);for(let k=0;k<8;k++)await video('Reduced motion | original standing feet');}
  lifecycle.reduced={progress:h.runtime.sample().actionProgress,pixelsStable:hash()===reducedHash};assert.equal(lifecycle.reduced.progress,0);assert.ok(lifecycle.reduced.pixelsStable);
  h.bridge.handlers.sync({motionMode:'full'});h.frameBy(25);assert.equal(h.runtime.sample().actionProgress,0);for(let j=0;j<110;j++){h.frameBy(25);await video('Resume | bounded entry and stepping');}
  const beforeClose=currentTrace.filter(c=>/views\/three-quarter-right\/foot-(left|right)\.png/.test(c.source)).slice(-2);
  results.push({dpr,plantedPairs,lifted,runtimeFacings:[...runtimeFacings],frames,lifecycle,cache:h.runtime.sample().bodySpriteCacheSize});
  h.document.getElementById('devTools').querySelector('[data-dev-action="close"]').dispatch('click');
  for(let j=0;j<20;j++){currentTrace=[];h.frameBy(25);await video(`Close and settle | ${(j*25)}ms`);if(j===0){fs.writeFileSync(path.join(out,`dpr-${dpr}-close-first.png`),canvases['#petCanvas'].toBuffer('image/png'));const feet=currentTrace.filter(c=>/views\/three-quarter-right\/foot-(left|right)\.png/.test(c.source));lifecycle.close={sameView:feet.length===2,firstFootMatrices:feet.map(f=>f.matrix),previousFootMatrices:beforeClose.map(f=>f.matrix)};assert.deepEqual(feet.map(f=>f.matrix),beforeClose.map(f=>f.matrix));}}
  if(ff){ff.stdin.end();const[code]=await ffDone;assert.equal(code,0,ffErr);}
  const stood=currentTrace.filter(c=>/views\/three-quarter-right\/foot-(left|right)\.png/.test(c.source));assert.equal(stood.length,2);assert.ok(stood.every(f=>Math.abs(f.matrix[4]-60*dpr)<1e-6&&Math.abs(f.matrix[5]-60*dpr)<1e-6));
  lifecycle.close.finalStand=true;assert.equal(h.runtime.sample().facing,-1);lifecycle.close.runtimeFacing=-1;
  fs.writeFileSync(path.join(out,`dpr-${dpr}-closed.png`),canvases['#petCanvas'].toBuffer('image/png'));
  h.bridge.handlers.devtools({open:true});h.document.getElementById('devToolsList').children.flatMap(s=>s.children).flatMap(g=>g.children).find(b=>b.dataset.devId===entry.id).dispatch('click');h.frameBy(25);assert.equal(h.runtime.sample().actionProgress,0);h.frameBy(25,15);assert.ok(h.runtime.sample().actionProgress>0);lifecycle.reopen=true;
  const findButton=(category,id)=>h.document.getElementById('devToolsList').children.flatMap(s=>s.children).flatMap(g=>g.children).find(b=>b.dataset.devCategory===category&&b.dataset.devId===id);
  currentTrace=[];findButton('view','front').dispatch('click');h.frameBy(25);
  assert.ok(currentTrace.some(c=>c.source.includes('/views/front/')));assert.ok(!currentTrace.some(c=>c.source.includes('/views/three-quarter-right/foot-left.png')));lifecycle.viewSwitch=true;assert.equal(h.runtime.sample().facing,-1);assert.ok(currentTrace.some(c=>!c.source&&c.matrix[0]<0),'unrelated view restores body reflection');lifecycle.viewSwitchRestoresFacing=true;
  findButton('action',entry.id).dispatch('click');h.frameBy(25);assert.equal(h.runtime.sample().actionProgress,0);
  h.frameBy(25,80);
  hit.dispatch('pointerdown',{isPrimary:true,button:0,ctrlKey:false,pointerId:2,screenX:100,screenY:100});
  await new Promise(r=>setImmediate(()=>setImmediate(r)));h.clockState.now+=100;
  hit.dispatch('pointermove',{pointerId:2,screenX:60,screenY:100});currentTrace=[];h.frameBy(25);
  const dragged=currentTrace.filter(c=>/views\/three-quarter-right\/foot-(left|right)\.png/.test(c.source));assert.equal(dragged.length,2);assert.deepEqual(dragged[0].matrix,dragged[1].matrix);lifecycle.interrupt=true;assert.ok(dragged.every(f=>f.matrix[0]<0));assert.equal(h.runtime.sample().facing,-1);lifecycle.interruptRestoresFacing=true;fs.writeFileSync(path.join(out,`dpr-${dpr}-left-interrupted.png`),canvases['#petCanvas'].toBuffer('image/png'));hit.dispatch('pointercancel',{pointerId:2});h.frameBy(25);
  h.bridge.handlers.sync({level:99,appearanceItemIds:['milestone.scarf']});
  h.bridge.handlers.devtools({open:true});findButton('action',entry.id).dispatch('click');h.frameBy(25,80);
  h.document.getElementById('devTools').querySelector('[data-dev-action="close"]').dispatch('click');
  currentTrace=[];h.frameBy(25);
  assert.ok(currentTrace.some(c=>!c.source&&c.matrix[0]<0),'actual restored wardrobe cancels facing hint immediately');
  assert.ok(currentTrace.some(c=>c.source.includes('scarf')),'real scarf artwork is restored');
  assert.equal(h.runtime.sample().facing,-1);lifecycle.dressedClose={firstFrameOriginalFacing:true,restoredScarf:true,runtimeFacing:-1};
  for(let j=0;j<20;j++){currentTrace=[];h.frameBy(25);assert.ok(currentTrace.some(c=>!c.source&&c.matrix[0]<0));}
  fs.writeFileSync(path.join(out,`dpr-${dpr}-dressed-close.png`),canvases['#petCanvas'].toBuffer('image/png'));
  h.document.hidden=true;h.document.dispatch('visibilitychange');const hiddenNow=h.runtime.sample().animNow;h.frameBy(1000,3);assert.equal(h.runtime.sample().animNow,hiddenNow);
  h.document.hidden=false;h.document.dispatch('visibilitychange');h.frameBy(25);assert.equal(h.runtime.sample().animNow,hiddenNow);lifecycle.hideResume=true;
  const stoppedHash=hash();h.runtime.stop();h.frameBy(25,10);assert.equal(hash(),stoppedHash);lifecycle.disposal=true;
 }
 fs.writeFileSync(path.join(out,'runtime-audit.json'),JSON.stringify({renderer:'actual createPetRuntime/controller/renderer/form-art with real Skia Canvas; DOM and rAF ports supplied by test fixture',nativeAccepted:false,browserAccepted:false,results},null,2));
 console.log(JSON.stringify(results.map(({dpr,plantedPairs,lifted,cache})=>({dpr,plantedPairs,lifted,cache})),null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
