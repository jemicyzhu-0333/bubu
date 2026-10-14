import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DANGO_RASTER} from '../assets/companion/dango/raster/dango.raster.mjs';
import {PET_ACTIONS} from '../src/content/behaviors.mjs';
import {createDangoRasterArtist} from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import {createSourceContactPoseSelector} from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import {SWEEP_QUARTER_CONTACT_ID as ID,SWEEP_QUARTER_CONTACT_KEY as KEY,sweepQuarterSourceContactPoseEligible as eligible,applySweepQuarterSourceContactPose as apply} from '../src/capabilities/companion/presentation/dango-sweep-quarter-contact-pose.mjs';
const backend=createRequire(import.meta.url)('@napi-rs/canvas'),base=new URL('../assets/companion/dango/raster/action-contact/sweep-quarter-grip-v1/',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
const options=(p=.5,key='test')=>({action:PET_ACTIONS.sweep,motion:'sweep',view:'three-quarter',progress:p,elapsedMs:p*9000,actionInstanceKey:key,channel:'pet'});
const make=m=>createDangoRasterArtist({manifest:m,createSurface:backend.createCanvas,loadImage:u=>backend.loadImage(fileURLToPath(u))});
function legacyManifest(){const m=structuredClone(DANGO_RASTER);m.tools[KEY].sourceContactPose.runtimeReady=false;return m;}
const decode=async name=>{const im=await backend.loadImage(fileURLToPath(new URL(name,base))),c=backend.createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);return {w:im.width,h:im.height,data:x.getImageData(0,0,im.width,im.height).data};};
test('sweep genuine quarter source is frozen four-palette binary alpha exact NN8x',async()=>{
 const lo=await decode('right-logical.png'),hi=await decode('right-8x.png');assert.deepEqual([lo.w,lo.h,hi.w,hi.h],[80,72,640,576]);assert.equal(hash(fs.readFileSync(new URL('right-8x.png',base))),DANGO_RASTER.tools[KEY].sourceContactPose.sourceSha256);
 const recipe=JSON.parse(fs.readFileSync(new URL('sources/coverage-recipe.json',base))),palette=[[26,27,38],[240,80,104],[248,104,120],[248,128,128]],expected=new Uint8Array(80*72*4);assert.equal(recipe.pixels.length,75);assert.equal(recipe.scale,9/66);assert.equal(recipe.alphaThreshold,.35);assert.equal(recipe.inkThreshold,.2);
 for(const cell of recipe.pixels){assert(cell.alphaCoverage>=.35);assert.equal(cell.paletteIndex===0,cell.inkCoverage>=.2);expected.set([...palette[cell.paletteIndex],255],(cell.y*80+cell.x)*4);}assert.deepEqual(Array.from(lo.data),Array.from(expected));
 for(let y=0;y<72;y++)for(let x=0;x<80;x++){const i=(y*80+x)*4,c=Array.from(lo.data.slice(i,i+4));assert([0,255].includes(c[3]));if(!c[3])assert.deepEqual(c,[0,0,0,0]);else assert(palette.some(p=>p.every((v,k)=>v===c[k])));for(let yy=0;yy<8;yy++)for(let xx=0;xx<8;xx++){const j=((y*8+yy)*640+x*8+xx)*4;assert.deepEqual(Array.from(hi.data.slice(j,j+4)),c);}}
 const mask=JSON.parse(fs.readFileSync(new URL('sources/approved-mask-recipe.json',base)));assert.equal(hash(fs.readFileSync(new URL('../'+mask.sourceRepositoryPath,import.meta.url))),mask.masterSha256);
});
test('sweep fixed inward shaft grip stays translation-only over the full phase range',()=>{
 const old=make(legacyManifest());try{for(let i=0;i<=240;i++){const opt=options(i/240),raw=old.resolveArtwork(opt),before=JSON.stringify(raw);assert(eligible(DANGO_RASTER,raw,'three-quarter',opt));const a=apply(DANGO_RASTER,raw,opt),tool=a.contact.tools[0],hand=a.contact.hands[0];assert.equal(JSON.stringify(raw),before);assert.deepEqual(a.data,raw.data);assert.deepEqual(a.contact.tools,raw.contact.tools);assert.deepEqual(hand.pawMatrix,[1,0,0,1,tool.x-60,0]);assert.deepEqual(hand.gripPoint,[tool.x+9.375,40.75]);assert.equal(hand.pawOcclusion,'foreground');assert.equal(hand.connector,false);}}finally{old.dispose();}
});
test('sweep contract rejects altered metadata geometry views and transforms atomically',()=>{
 const old=make(legacyManifest()),opt=options(),raw=old.resolveArtwork(opt);try{for(const key of ['id','contractVersion','runtimeReady','action','view','side','layer','sourceSha256','bodySha256','bodyRect','contact','rodLocalGrip','fixedSourceOffset','toolBase','toolXRange','toolRect','shaftAxis','translationOnly','uniformSourceProjection','samplesPerArtUnit','alphaCoverageThreshold','inkCoverageThreshold']){const m=structuredClone(DANGO_RASTER);m.tools[KEY].sourceContactPose[key]='invalid';assert(!eligible(m,raw,'three-quarter',opt));assert.equal(apply(m,raw,opt),raw);}for(const view of ['front','profile','back'])assert(!eligible(DANGO_RASTER,raw,view,opt));for(const patch of [{state:'dragged'},{transform:{}},{matrix:[]},{progress:NaN},{action:{...PET_ACTIONS.sweep,propOpacity:2}}])assert(!eligible(DANGO_RASTER,raw,'three-quarter',{...opt,...patch}));const bad=structuredClone({...raw,limbPainter:null});bad.contact.tools[0].x+=10;assert(!eligible(DANGO_RASTER,bad,'three-quarter',opt));const fade={...raw,contact:{...raw.contact,hands:raw.contact.hands.map(h=>({...h,opacity:.6}))}};assert.equal(apply(DANGO_RASTER,fade,{...opt,action:{...PET_ACTIONS.sweep,propOpacity:.5}}).contact.hands[0].opacity,.3);}finally{old.dispose();}
});
test('sweep shared selector preserves whole-episode fallback and late-ready latch',()=>{
 const old=make(legacyManifest()),raw=old.resolveArtwork(options());try{for(const initial of ['loading','failed','missing']){let state=initial;const s=createSourceContactPoseSelector({manifest:DANGO_RASTER,source:{state:()=>state}});assert.equal(s.apply(raw,'three-quarter',options(0,'one')),raw);state='ready';assert.equal(s.apply(raw,'three-quarter',options(.5,'one')),raw);assert.equal(s.apply(raw,'three-quarter',options(0,'two')).sourceContactPose,ID);state='failed';assert.equal(s.apply(raw,'three-quarter',options(.2,'two')),raw);state='ready';assert.equal(s.apply(raw,'three-quarter',options(.3,'two')),raw);assert.equal(s.apply(raw,'three-quarter',options(0,'three')).sourceContactPose,ID);s.dispose();}}finally{old.dispose();}
});
test('unmodified production artist selects sweep while knit catch sip and generic views remain unchanged',async()=>{
 const a=make(DANGO_RASTER),old=make(legacyManifest());try{await Promise.all([a.ready({all:true}),old.ready({all:true})]);const art=a.resolveArtwork(options(.625)),before=old.resolveArtwork(options(.625));assert.equal(art.sourceContactPose,ID);assert.deepEqual(art.data,before.data);assert.deepEqual(art.contact.tools,before.contact.tools);for(const [id,view] of [['knit-scarf','front'],['catch-star','three-quarter'],['sip-tea','front'],['wave','front'],['sweep','front'],['hiccup','three-quarter']]){const opt={...options(.5,id),action:PET_ACTIONS[id],motion:PET_ACTIONS[id].motion,view};assert.deepEqual(a.resolveArtwork(opt),old.resolveArtwork(opt));}}finally{a.dispose();old.dispose();}
});
