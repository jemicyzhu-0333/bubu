import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DANGO_RASTER} from '../assets/companion/dango/raster/dango.raster.mjs';
import {PET_ACTIONS} from '../src/content/behaviors.mjs';
import {sampleActionContact} from '../src/core/pet-action-contact.mjs';
import {createSourceContactPoseSelector} from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import {createDangoRasterArtist} from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import {KNIT_CONTACT_ID,KNIT_CONTACT_KEYS,knitContactSpriteKeys,knitSourceContactPoseEligible as eligible,applyKnitSourceContactPose as apply} from '../src/capabilities/companion/presentation/dango-knit-contact-pose.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.join(root,'assets/companion/dango/raster/action-contact',KNIT_CONTACT_ID),backend=createRequire(import.meta.url)('@napi-rs/canvas');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),action=PET_ACTIONS['knit-scarf'];
const options=(p=.5,key='test')=>({action,motion:'knit',view:'front',progress:p,elapsedMs:p*12000,actionInstanceKey:key,channel:'pet'});
const pose=p=>({contact:sampleActionContact(action,p,'front',{soft:true,anchors:{'shoulder-left':{x:7.4,y:39.712821},'shoulder-right':{x:58.6,y:39.712821}},toolSprites:{needle:{width:17,height:15,anchors:DANGO_RASTER.tools.needle.anchors}}})});
const decode=async p=>{const im=await backend.loadImage(p),c=backend.createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);return {width:im.width,height:im.height,data:x.getImageData(0,0,im.width,im.height).data};};
test('knit frozen sources are exact4-palette binary alpha zero-transparent and nearest8x',async()=>{
 assert.equal(knitContactSpriteKeys().length,2);
 for(const side of['left','right']){const spec=DANGO_RASTER.tools[KNIT_CONTACT_KEYS[side]],lo=await decode(path.join(base,side+'-logical.png')),hi=await decode(path.join(base,side+'-8x.png'));
  assert.equal(hash(path.join(base,side+'-8x.png')),spec.sourceContactPose.sourceSha256);assert.equal(hash(path.join(base,'sources/generated-master-v1.png')),spec.sourceContactPose.rawSourceSha256);assert.equal(hash(path.join(base,'sources',side+'-mask.png')),spec.sourceContactPose.maskSha256);assert.deepEqual([lo.width,lo.height,hi.width,hi.height],[72,72,576,576]);
  const colors=new Set();for(let y=0;y<72;y++)for(let x=0;x<72;x++){const i=(y*72+x)*4,rgba=Array.from(lo.data.slice(i,i+4));assert([0,255].includes(rgba[3]));if(!rgba[3])assert.deepEqual(rgba,[0,0,0,0]);else colors.add(rgba.slice(0,3).join(','));for(let yy=0;yy<8;yy++)for(let xx=0;xx<8;xx++){const j=((y*8+yy)*576+x*8+xx)*4;assert.deepEqual(Array.from(hi.data.slice(j,j+4)),rgba);}}
  assert.deepEqual([...colors].sort(),['26,27,38','240,80,104','248,104,120','248,128,128'].sort());
 }
});
test('compact recipe reconstructs every logical and nearest8x RGBA pixel with existing Node dependencies',async()=>{
 const recipe=JSON.parse(fs.readFileSync(path.join(base,'compact-recipe.json'),'utf8'));
 assert.equal(hash(path.join(base,recipe.master)),recipe.masterSha256);
 for(const side of['left','right']){
  const part=recipe.parts[side],expected=new Uint8ClampedArray(72*72*4),visited=new Set();
  assert.equal(part.logical.length,part.logicalAlphaArea);
  for(const cell of part.logical){const [x,y]=cell.xy;assert(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<72&&y>=0&&y<72);assert(!visited.has(y*72+x),'duplicate recipe cell');visited.add(y*72+x);assert.equal(cell.rgba.length,4);assert.equal(cell.rgba[3],255);expected.set(cell.rgba,(y*72+x)*4);}
  // Re-evaluate the one uniform coverage rule as well as its stored output map.
  const reconstructed=new Uint8ClampedArray(expected.length);
  for(const c of part.cells){const [x,y]=c.xy;if(x<0||x>=72||y<0||y>=72)continue;if(c.inkCoverage<recipe.globalInkCoverageThreshold&&c.alphaCoverage<recipe.logicalAlphaCoverage)continue;let k=0;if(c.inkCoverage<recipe.globalInkCoverageThreshold){k=1;for(let j=2;j<4;j++)if(c.counts[j]>c.counts[k])k=j;}reconstructed.set([...recipe.palette[k],255],(y*72+x)*4);}
  assert.deepEqual(reconstructed,expected,'coverage recipe and complete output mapping disagree');
  const lo=await decode(path.join(base,side+'-logical.png'));assert.deepEqual(lo.data,expected);
  const hi=await decode(path.join(base,side+'-8x.png')),expanded=new Uint8ClampedArray(576*576*4);
  for(let y=0;y<576;y++)for(let x=0;x<576;x++){const i=(Math.floor(y/8)*72+Math.floor(x/8))*4;expanded.set(expected.subarray(i,i+4),(y*576+x)*4);}
  assert.deepEqual(hi.data,expanded,'nearest8x decoded RGBA mismatch');
 }
});

test('257 phases preserve props/data and independently lock each paw to its opposite-moving needle',()=>{for(let i=0;i<=256;i++){const p=i/256,original=pose(p),o=options(p);assert(eligible(DANGO_RASTER,original,'front',o));const a=apply(DANGO_RASTER,original,o),ns=original.contact.tools.filter(t=>t.key==='needle');assert.equal(a.sourceContactPose,KNIT_CONTACT_ID);assert.strictEqual(a.contact.tools,original.contact.tools);assert.strictEqual(a.contact.details,original.contact.details);for(let j=0;j<2;j++){const h=a.contact.hands[j];assert.deepEqual(h.gripPoint,[ns[j].x+(j?12.25:4.75),45.125]);assert.deepEqual(h.pawMatrix,[1,0,0,1,ns[j].x-(j?30:22),0]);}assert(Math.abs(a.contact.hands[0].pawMatrix[4]+a.contact.hands[1].pawMatrix[4])<1e-8);}});
test('invalid action/view/transform/prop or source contract fails closed',()=>{for(const patch of[{state:'dragged'},{matrix:[1,0,0,1,0,0]},{progress:NaN},{action:{...action,id:'wave'}},{action:{...action,propOpacity:2}}])assert(!eligible(DANGO_RASTER,pose(.5),'front',{...options(),...patch}));assert(!eligible(DANGO_RASTER,pose(.5),'three-quarter',options()));for(const side of['left','right'])for(const fn of[s=>s.sourceContactPose.runtimeReady=false,s=>s.rect[2]++,s=>s.sourceContactPose.sourceSha256='bad',s=>s.sourceContactPose.strokePriority=false]){const m=structuredClone(DANGO_RASTER);fn(m.tools[KNIT_CONTACT_KEYS[side]]);assert(!eligible(m,pose(.5),'front',options()));}for(const fn of[p=>p.contact.tools[1].x+=.1,p=>p.contact.tools[2].flip=false,p=>p.contact.hands[0].points[0][0]++,p=>p.contact.hands[0].pawSprite='other']){const p=pose(.5);fn(p);assert(!eligible(DANGO_RASTER,p,'front',options()));}});
test('production selector readiness is atomic, sticky within episode, and clean across restart/interruption',()=>{const states={},sel=createSourceContactPoseSelector({manifest:DANGO_RASTER,source:{state:s=>states[s.src]||'ready'}}),run=(p,key,patch={})=>sel.apply(pose(p),'front',{...options(p,key),...patch});assert.equal(run(0,'one').sourceContactPose,KNIT_CONTACT_ID);states[DANGO_RASTER.tools[KNIT_CONTACT_KEYS.right].src]='loading';assert.equal(run(.1,'one').sourceContactPose,undefined);states[DANGO_RASTER.tools[KNIT_CONTACT_KEYS.right].src]='ready';assert.equal(run(.2,'one').sourceContactPose,undefined);assert.equal(run(0,'two').sourceContactPose,KNIT_CONTACT_ID);assert.equal(run(.1,'two',{state:'dragged'}).sourceContactPose,undefined);assert.equal(run(.2,'two').sourceContactPose,undefined);assert.equal(run(0,'three').sourceContactPose,KNIT_CONTACT_ID);for(const opacity of[1,.5,0]){const a=run(.3,'three',{action:{...action,propOpacity:opacity,handoffRecovery:1-opacity}});assert(a.contact.hands.every(h=>h.opacity===opacity));}sel.dispose();});
test('actual production artist loads/selects registered pair and keeps other actions/views unchanged',async()=>{const make=m=>createDangoRasterArtist({manifest:m,createSurface:backend.createCanvas,loadImage:u=>backend.loadImage(fileURLToPath(u))}),m=structuredClone(DANGO_RASTER);for(const key of knitContactSpriteKeys())m.tools[key].sourceContactPose.runtimeReady=false;const a=make(DANGO_RASTER),old=make(m);try{a.resolveArtwork(options(0,'cold'));await Promise.all([a.ready({all:true}),old.ready({all:true})]);assert.equal(a.resolveArtwork(options(.1,'cold')).sourceContactPose,undefined);const art=a.resolveArtwork(options(.25,'ready')),before=old.resolveArtwork(options(.25,'ready'));assert.equal(art.sourceContactPose,KNIT_CONTACT_ID);assert.deepEqual(art.contact.tools,before.contact.tools);assert.deepEqual(art.data,before.data);for(const [id,view]of[['knit-scarf','three-quarter'],['sip-tea','front'],['catch-star','three-quarter'],['wave','front']]){const o={...options(.5,id),action:PET_ACTIONS[id],motion:PET_ACTIONS[id].motion,view};assert.deepEqual(a.resolveArtwork(o),old.resolveArtwork(o));}}finally{a.dispose();old.dispose();}});
