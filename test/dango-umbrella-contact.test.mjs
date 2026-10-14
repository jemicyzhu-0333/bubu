import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {DANGO_RASTER} from '../assets/companion/dango/raster/dango.raster.mjs';
import {createDangoRasterArtist} from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import {createSourceContactPoseSelector} from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import {umbrellaContactSpriteKeys,umbrellaSourceContactPoseEligible} from '../src/capabilities/companion/presentation/dango-umbrella-contact-pose.mjs';
import {PET_ACTIONS} from '../src/content/behaviors.mjs';
const keys=umbrellaContactSpriteKeys(), action=PET_ACTIONS['umbrella-dance'];
const options={action,motion:action.motion,view:'front',progress:.5,elapsedMs:3000,channel:'pet',actionInstanceKey:'umbrella-1'};
const pose=()=>({contact:{tools:[{key:'umbrella',x:37,y:-11,layer:'back'}],details:[],hands:[{side:'right',layer:'front',gripPoint:[61.875,35.75],points:[[58.5,45.5],[60,40],[61.875,35.75]],opacity:.8}]}});
const selector=(state=()=> 'ready')=>createSourceContactPoseSelector({manifest:DANGO_RASTER,source:{state}});
const decode=async src=>{const im=await loadImage(fileURLToPath(new URL(src,DANGO_RASTER.baseUrl)));
  const c=createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);return {w:im.width,h:im.height,data:x.getImageData(0,0,im.width,im.height).data};};
const legacy=()=>{const m=structuredClone(DANGO_RASTER);for(const k of keys)m.tools[k].sourceContactPose.runtimeReady=false;return m;};
const make=async(manifest,fail)=>{const a=createDangoRasterArtist({manifest,createSurface:createCanvas,loadImage:u=>{if(fail&&u.includes(fail))throw Error('injected source failure');return loadImage(fileURLToPath(u));}});await a.ready({all:true});return a;};
test('umbrella source files are hash-bound; original prop partitions are byte-complementary; palm is exact nearest8x',async()=>{
 for(const key of keys){const s=DANGO_RASTER.tools[key];
  assert.equal(s.sourceContactPose.runtimeReady,true);
  assert.equal(createHash('sha256').update(readFileSync(new URL(s.src,DANGO_RASTER.baseUrl))).digest('hex'),s.sourceContactPose.sourceSha256);}
 const [original,back,front]=await Promise.all([DANGO_RASTER.tools.umbrella.src,...keys.slice(0,2).map(k=>DANGO_RASTER.tools[k].src)].map(decode));
 assert.deepEqual([back.w,back.h,front.w,front.h],[original.w,original.h,original.w,original.h]);
 for(let i=0;i<original.data.length;i+=4){assert.ok(!(back.data[i+3]&&front.data[i+3]),`overlap ${i}`);
  const s=front.data[i+3]?front:back;
  assert.deepEqual(Array.from(s.data.slice(i,i+4)),Array.from(original.data.slice(i,i+4)),`partition ${i}`);}
 const [lo,hi]=await Promise.all(['right-logical.png','right-8x.png'].map(f=>decode('action-contact/umbrella-front-v1/'+f)));
 assert.deepEqual([hi.w,hi.h],[lo.w*8,lo.h*8]);
 for(let y=0;y<hi.h;y++)for(let x=0;x<hi.w;x++){const a=(y*hi.w+x)*4,b=(Math.floor(y/8)*lo.w+Math.floor(x/8))*4;for(let k=0;k<4;k++)assert.equal(hi.data[a+k],lo.data[b+k]);}
});
test('narrow source splits only original prop depth and shares its opacity without moving pixels',()=>{
 const p=pose(),unchanged=structuredClone(p),s=selector();
 for(const opacity of [1,.7,.1,0]){const a={...action,propOpacity:opacity,handoffRecovery:1-opacity},r=s.apply(p,'front',{...options,action:a});
  assert.equal(r.sourceContactPose,'umbrella-front-v1');
  assert.equal(r.contact.tools.length,2);
  assert.deepEqual(r.contact.tools.map(t=>[t.x,t.y]),[[37,-11],[37,-11]]);
  assert.deepEqual(r.contact.tools.map(t=>t.layer),['back','front']);
  assert.equal(r.contact.hands[0].opacity,.8*opacity);
  assert.equal(r.contact.hands[0].limb,false);
  assert.deepEqual(r.contact.hands[0].pawMatrix,[1,0,0,1,0,0]);}
 assert.deepEqual(p,unchanged);
});
test('unsupported pose, malformed metadata and each missing layer fail closed atomically',()=>{
 for(const edit of [p=>p.contact.tools[0].x++,p=>p.contact.tools[0].rotate=1,p=>p.contact.hands[0].side='left',p=>p.contact.tools.push({key:'cup'})]){const p=pose();edit(p);
  assert.equal(umbrellaSourceContactPoseEligible(DANGO_RASTER,p,'front',options),false);}
 for(const view of ['three-quarter','back'])assert.equal(umbrellaSourceContactPoseEligible(DANGO_RASTER,pose(),view,options),false);
 for(const k of keys){const m=structuredClone(DANGO_RASTER);m.tools[k].sourceContactPose.sourceSha256='bad';
  assert.equal(umbrellaSourceContactPoseEligible(m,pose(),'front',options),false);let cold=true;
  const s=selector(sprite=>cold&&sprite===DANGO_RASTER.tools[k]?'loading':'ready');
  assert.equal(s.apply(pose(),'front',options).sourceContactPose,undefined);cold=false;
  assert.equal(s.apply(pose(),'front',{...options,action:{...action,propOpacity:.5}}).sourceContactPose,undefined);
  assert.equal(s.apply(pose(),'front',{...options,actionInstanceKey:'next'}).sourceContactPose,'umbrella-front-v1');}
});
test('standard artist retains canonical body and geometry for257 phases; missing resource falls back whole group',async()=>{
 const a=await make(DANGO_RASTER),b=await make(legacy());try{for(let i=0;i<=256;i++){const o={...options,progress:i/256,elapsedMs:i*40},x=a.resolveArtwork(o),y=b.resolveArtwork(o);
  assert.equal(x.sourceContactPose,'umbrella-front-v1');
  assert.deepEqual(x.data.body,y.data.body);
  assert.deepEqual(x.matrices,y.matrices);
  assert.deepEqual(x.face,y.face);
  assert.deepEqual(x.contact.hands[0].gripPoint,y.contact.hands[0].gripPoint || y.contact.hands[0].points.at(-1));
  assert.equal(x.contact.hands[0].limb,false);
  assert.equal(x.contact.tools.length,y.contact.tools.length+1);}}
 finally{a.dispose();b.dispose();}
 for(const name of ['right-8x.png','umbrella-back.png','umbrella-front.png']){const a=await make(DANGO_RASTER,'umbrella-front-v1/'+name);try{const x=a.resolveArtwork(options);
  assert.equal(x.sourceContactPose,undefined);
  assert.deepEqual(x.contact.tools.map(t=>t.key),['umbrella']);}
 finally{a.dispose();}}
});
