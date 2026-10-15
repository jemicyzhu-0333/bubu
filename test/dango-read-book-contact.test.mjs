import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {DANGO_RASTER} from '../assets/companion/dango/raster/dango.raster.mjs';
import {sampleRasterPose} from '../src/capabilities/companion/presentation/dango-raster-pose.mjs';
import {READ_BOOK_SPRITES} from '../src/capabilities/companion/presentation/read-book-contact-sprites.mjs';
import {readBookContactSpriteKeys,readBookSourceContactPoseEligible,applyReadBookSourceContactPose} from '../src/capabilities/companion/presentation/dango-read-book-contact-pose.mjs';
import {sampleReadBookTargets} from '../src/capabilities/companion/presentation/read-book-targets.mjs';

import {createSourceContactPoseSelector} from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
const manifest=structuredClone(DANGO_RASTER);Object.assign(manifest.tools,structuredClone(READ_BOOK_SPRITES));
const base={action:{id:'read-book',motion:'read',prop:'book'},motion:'read',progress:.5,view:'front',appearance:{items:[]}};
const sprites=Object.fromEntries(Object.entries(manifest.tools).map(([id,s])=>[id,{width:s.rect[2],height:s.rect[3],anchors:s.anchors}]));
const pose=p=>sampleRasterPose(manifest.views.front,{...base,progress:p,toolSprites:sprites});
for(let i=0;i<=1100;i++){const p=i/1100,original=pose(p),o={...base,progress:p};assert.ok(readBookSourceContactPoseEligible(manifest,original,'front',o));const target=sampleReadBookTargets(original.contact,p);if(target.pageVisible){assert.equal(target.approach,1);assert.deepEqual(target.right,target.pageTarget);}const before=JSON.stringify(original),after=applyReadBookSourceContactPose(manifest,original,o);assert.equal(JSON.stringify(original),before);assert.equal(after.contact.details,original.contact.details);assert.deepEqual(after.contact.tools.filter(t=>!t.sourceHandRoot),original.contact.tools);assert.equal(after.contact.tools.filter(t=>t.sourceHandRoot).length,2);}
for(const key of readBookContactSpriteKeys()){const bad=structuredClone(manifest);delete bad.tools[key];assert.equal(readBookSourceContactPoseEligible(bad,pose(.5),'front',base),false);for(const field of Object.keys(manifest.tools[key].sourceContactPose)){const bad=structuredClone(manifest);delete bad.tools[key].sourceContactPose[field];assert.equal(readBookSourceContactPoseEligible(bad,pose(.5),'front',base),false);}}
for(const patch of [{action:{id:'read-book',motion:'read',prop:'cup'}},{state:'dragged'},{transform:[]},{action:{...base.action,propOpacity:2}},{progress:NaN}])assert.equal(readBookSourceContactPoseEligible(manifest,pose(.5),'front',{...base,...patch}),false);
assert.equal(readBookSourceContactPoseEligible(manifest,pose(.5),'three-quarter',base),false);
let states=new Map(readBookContactSpriteKeys().map(k=>[manifest.tools[k].src,'loading']));const source={state:s=>states.get(s.src)||'ready'};const selector=createSourceContactPoseSelector({manifest,source});
const apply=(id,p=.5)=>selector.apply(pose(p),'front',{...base,progress:p,channel:'pet',actionInstanceKey:id,elapsedMs:p*11000});
assert.equal(apply('cold').sourceContactPose,undefined);for(const key of states.keys())states.set(key,'ready');assert.equal(apply('cold',.6).sourceContactPose,undefined);assert.equal(apply('hot').sourceContactPose,'read-book-front-halfgrid-v1');
const root=manifest.tools[readBookContactSpriteKeys()[1]].src;states.set(root,'failed');assert.equal(apply('hot',.7).sourceContactPose,undefined);states.set(root,'ready');assert.equal(apply('hot',.8).sourceContactPose,undefined);assert.equal(apply('restart').sourceContactPose,'read-book-front-halfgrid-v1');
selector.apply(pose(.5),'front',{...base,action:null,channel:'pet',actionInstanceKey:'idle'});assert.equal(apply('again').sourceContactPose,'read-book-front-halfgrid-v1');selector.dispose();
console.log('PASS: 1101 target/immutability samples; every required source field fail-closes; all four resources atomic across cold, failure, interruption and restart. Active production selector.');

const recipe=JSON.parse(fs.readFileSync(new URL('../assets/companion/dango/raster/action-contact/read-book-front-halfgrid-v1/sources/recipe.json',import.meta.url)));
const {loadImage,createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas');
for(const [side,spec]of Object.entries(recipe.parts)){
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../'+spec.repositorySourcePath,import.meta.url))).digest('hex'),spec.sourceSha256);
 const sum=new Uint8Array(144*144*4),seen=new Uint8Array(144*144);
 for(const [role,out]of Object.entries(spec.outputs)){
  const base=new URL('../assets/companion/dango/raster/action-contact/read-book-front-halfgrid-v1/',import.meta.url);
  const pixels=[];for(const [name,hash]of [[out.logicalFilename,out.logicalSha256],[out.filename,out.sha256]]){const url=new URL(name,base),bytes=fs.readFileSync(url);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash);const im=await loadImage(bytes),c=createCanvas(im.width,im.height);c.getContext('2d').drawImage(im,0,0);pixels.push({w:im.width,h:im.height,data:c.getContext('2d').getImageData(0,0,im.width,im.height).data});}
  const [logical,runtime]=pixels;assert.equal(runtime.w,logical.w*8);assert.equal(runtime.h,logical.h*8);
  for(let y=0;y<runtime.h;y++)for(let x=0;x<runtime.w;x++)for(let k=0;k<4;k++)assert.equal(runtime.data[(y*runtime.w+x)*4+k],logical.data[(Math.floor(y/8)*logical.w+Math.floor(x/8))*4+k]);
  for(let y=0;y<logical.h;y++)for(let x=0;x<logical.w;x++){const i=(y*logical.w+x)*4,alpha=logical.data[i+3];assert.ok(alpha===0||alpha===255);if(!alpha)continue;assert.ok(recipe.palette.some(color=>color.every((v,k)=>v===logical.data[i+k])));const pos=(y+out.logicalBounds[1])*144+x+out.logicalBounds[0];assert.equal(seen[pos],0);seen[pos]=1;sum.set(logical.data.subarray(i,i+4),pos*4);}
  assert.equal(manifest.tools[`read-book-front-halfgrid-v1-${side}-${role}`].sourceContactPose.sourceSha256,out.sha256);
 }
 const fullBytes=fs.readFileSync(new URL('../assets/companion/dango/raster/action-contact/read-book-front-halfgrid-v1/'+spec.completeLogical.filename,import.meta.url));assert.equal(crypto.createHash('sha256').update(fullBytes).digest('hex'),spec.completeLogical.sha256);const im=await loadImage(fullBytes),canvas=createCanvas(im.width,im.height);canvas.getContext('2d').drawImage(im,0,0);assert.deepEqual([...sum],[...canvas.getContext('2d').getImageData(0,0,im.width,im.height).data]);
 assert.equal(seen.reduce((a,b)=>a+b,0),side==='left'?193:192);
}
console.log('PASS: four runtime/logical source hashes, four-color binary alpha, exact NN8x and disjoint partition coverage.');

// The active production factory must honor the same four-resource episode gate.
const {createDangoRasterArtist}=await import('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const {fileURLToPath}=await import('node:url');
const options=(id,p=.5,patch={})=>({...base,progress:p,elapsedMs:p*11000,channel:'pet',actionInstanceKey:id,...patch});
const decodedCache=new Map();
const loader=url=>{const path=fileURLToPath(url);if(!decodedCache.has(path))decodedCache.set(path,loadImage(path));return decodedCache.get(path);};
const make=(m=DANGO_RASTER,load=loader)=>createDangoRasterArtist({manifest:m,createSurface:createCanvas,loadImage:load});
const actual=make(),disabledManifest=structuredClone(DANGO_RASTER);
for(const key of readBookContactSpriteKeys())disabledManifest.tools[key].sourceContactPose.runtimeReady=false;
const disabled=make(disabledManifest);
try {
 assert.equal(actual.resolveArtwork(options('cold',0)).sourceContactPose,undefined);
 await Promise.all([actual.ready({all:true}),disabled.ready({all:true})]);
 assert.equal(actual.resolveArtwork(options('cold',.4)).sourceContactPose,undefined,'late resource readiness cannot pop into the same cold episode');
 const ready=actual.resolveArtwork(options('hot'));
 assert.equal(ready.sourceContactPose,'read-book-front-halfgrid-v1');
 assert.equal(ready.actionReady,true);
 assert.equal(ready.contact.tools.filter(t=>t.sourceHandRoot).length,2);
 const baseline=disabled.resolveArtwork(options('baseline'));
 assert.deepEqual(ready.data,baseline.data);
 assert.deepEqual(ready.contact.details,baseline.contact.details);
 assert.deepEqual(ready.contact.tools.filter(t=>!t.sourceHandRoot),baseline.contact.tools);
 assert.equal(actual.resolveArtwork(options('hot',.3,{state:'dragged'})).sourceContactPose,undefined);
 assert.equal(actual.resolveArtwork(options('hot',.1)).sourceContactPose,undefined,'rollback within the explicit disabled episode cannot reopen it');
 assert.equal(actual.resolveArtwork(options('restart',0)).sourceContactPose,'read-book-front-halfgrid-v1');
 actual.resolveArtwork(options('idle',0,{action:null,motion:'idle'}));
 assert.equal(actual.resolveArtwork(options('after-interruption',0)).sourceContactPose,'read-book-front-halfgrid-v1');
 const calm=actual.resolveArtwork(options('calm',.1,{calmVisual:true}));
 assert.equal(calm.sourceContactPose,'read-book-front-halfgrid-v1');
 assert.deepEqual(calm.contact.hands.map(h=>h.gripPoint),ready.contact.hands.map(h=>h.gripPoint));
 assert.equal(actual.resolveArtwork(options('outfit',.5,{appearance:{items:[{id:'milestone.scarf',renderKey:'scarf',formId:'dango'}]}})).sourceContactPose,'read-book-front-halfgrid-v1');
 for(const opacity of [.5,0])assert.equal(actual.resolveArtwork(options('unsupported-opacity-'+opacity,.5,{action:{...base.action,propOpacity:opacity}})).sourceContactPose,undefined);
 assert.equal(actual.resolveArtwork(options('unsupported-recovery',.5,{action:{...base.action,handoffRecovery:0}})).sourceContactPose,undefined);
} finally {actual.dispose();disabled.dispose();}
for(const failedKey of readBookContactSpriteKeys()){
 const failedSrc=DANGO_RASTER.tools[failedKey].src;
 const failed=make(DANGO_RASTER,url=>String(url).includes('/'+failedSrc+'?')?Promise.reject(new Error('injected source failure')):loader(url));
 try{await failed.ready({all:true});const art=failed.resolveArtwork(options('failed-'+failedKey));assert.equal(art.sourceContactPose,undefined);assert.ok(art.contact.hands.every(h=>!readBookContactSpriteKeys().includes(h.pawSprite)));assert.ok(art.contact.tools.every(t=>!t.sourceHandRoot));assert.equal(failed.cacheStats().source.failed,1);}finally{failed.dispose();}
 await new Promise(resolve=>setImmediate(resolve));
}
console.log('PASS: active artist cold/late-ready, four independent resource failures, atomic fallback, drag, explicit rollback, restart/interruption, calm, clothing continuity and unsupported recovery/partial-opacity failure-close.');
