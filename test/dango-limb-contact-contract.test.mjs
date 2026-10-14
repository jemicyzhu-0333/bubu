import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as limb from '../src/capabilities/companion/presentation/dango-limb-compose.mjs';
const dir = new URL('../assets/companion/dango/raster/limbs/', import.meta.url);
const read = f => JSON.parse(fs.readFileSync(new URL(f, dir)));
const M = read('limbs.json'), J = read('joints/elbow.json'), I = read('interfaces/interfaces.json');
const source = { manifest: () => M, joints: () => J, interfaces: () => I, pixels: () => null };

test('final hand contact wins over legacy palm-center endpoint', () => {
  const painter = limb.createDangoLimbPainter({ source, createSurface: () => null });
  const p = painter.plan('front', { side: 'left', gripPoint: [20, 52], points: [[0, 0], [90, 90]] }, { prop: 'cup' });
  assert.ok(p); assert.ok(Math.hypot(p.contactWorld[0] - 20, p.contactWorld[1] - 52) <= 1.25);
});
test('contact roles distinguish a pen grip from the supporting paper hand', () => {
  assert.equal(typeof limb.contactContract, 'function');
  const hand = side => ({ side, points: [[0, 0], [20, 52]] });
  assert.equal(limb.contactContract(hand('right'), { prop: 'document' }).pose, 'grip');
  assert.equal(limb.contactContract(hand('left'), { prop: 'document' }).pose, 'press');
  assert.deepEqual(limb.contactContract(hand('left'), { prop: 'document' }).normal, [0, 1]);
  assert.equal(limb.contactContract({ ...hand('right'), integrated: true }, { motion: 'dash' }), null);
});
test('pose-root interface requires exact authored geometry and depth', () => {
  assert.equal(typeof limb.interfaceApplies, 'function');
  const f = I.frames[0], v = f.verifiedPose;
  const p = { view: v.view, side: v.side, pawMirror: false, mirrorArm: false,
    paw: { src: f.sourcePaw, semantic: { nominalAngle: v.pawAngle } }, S: v.fixedShoulder, W: v.wristWorld,
    joint: { upperAngle: v.upperAngle, foreAngle: v.foreAngle } };
  assert.equal(limb.interfaceApplies(f, p), true);
  for (const altered of [{ ...p, W: [p.W[0]+1,p.W[1]] }, { ...p, side: 'r' },
    { ...p, joint: { ...p.joint, upperAngle: 0 } }, { ...p, pawMirror: true }]) assert.equal(limb.interfaceApplies(f, altered), false);
});
test('surface normal uses registered contact normal, not nominal wrist axis', () => {
  const p = limb.solveLimb(source, { view: 'front', side: 'left', target: [20,52], pose: 'hold',
    contract: { normal: [0,1], normalTolerance: 1 } });
  assert.ok(p);
  const n=p.paw.contactResolution.projectedNormal;
  assert.ok(n[1]>.999);
});
test('painter disposal releases both bounded caches', () => {
  const p=limb.createDangoLimbPainter({source,createSurface:()=>null});
  p.plan('front',{side:'left',points:[[0,0],[20,52]]},{prop:'cup'});
  assert.equal(typeof p.dispose,'function'); assert.ok(p.stats().plans>0);p.dispose();assert.deepEqual(p.stats(),{plans:0,surfaces:0});
});

test('palm passes honor tool occlusion, opacity, and coversPaw without hiding the arm', () => {
  const draws=[];
  const context={globalAlpha:1,save(){this.saved=this.globalAlpha;},restore(){this.globalAlpha=this.saved;},
    drawImage(){draws.push(this.globalAlpha);}};
  const painter=limb.createDangoLimbPainter({source,createSurface:(w,h)=>({getContext:()=>({
    createImageData:()=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})})});
  const hand={side:'left',gripPoint:[20,52],opacity:.3};
  const options={view:'front',hand,action:{prop:'cup'},palette:null};
  painter.paint(context,{...options,layer:'before-tools'});assert.equal(draws.length,0);
  painter.paint(context,{...options,layer:'front'});assert.deepEqual(draws,[.3]);
  painter.paint(context,{...options,layer:'front',covered:true});assert.equal(draws.length,1);
  painter.paint(context,{...options,layer:'back',covered:true});assert.deepEqual(draws,[.3,.3]);
  painter.paint(context,{...options,hand:{...hand,pawOcclusion:'behind-tool'},layer:'before-tools'});
  assert.deepEqual(draws,[.3,.3,.3]);assert.equal(context.globalAlpha,1);
});

test('unknown stencil margin queries canonical body without erasing positive-axis pixels', () => {
  const sock=M.sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='l');
  const px={width:25,height:25,data:new Uint8ClampedArray(25*25*4)};
  for(let i=0;i<25*25;i++)px.data[i*4+3]=255;
  const query=[];
  const src={...source,pixels:key=>key==='probe'?px:null,bodyAlpha:(v,x,y)=>{query.push([v,x,y]);return Math.floor(x)%2===0;}};
  const p=limb.solveLimb(source,{view:'front',side:'left',target:[20,52],pose:'hold'});
  const plan={...p,U:{...p.U,src:'probe'},F:{...p.F,src:'missing'},paw:{...p.paw,src:'missing'},joint:{...p.joint,mask:null}};
  const c=limb.composeLimb(src,plan);assert.ok(query.length>0);
  const B=limb.DANGO_LIMB_BOX;
  for(const [view,x,y]of query){assert.equal(view,'front');
    const alpha=c.arm.data[((Math.floor(y)-B.y)*B.w+Math.floor(x)-B.x)*4+3];assert.equal(alpha,Math.floor(x)%2===0?255:0);assert.equal(x-Math.floor(x),.5);assert.equal(y-Math.floor(y),.5);}
});

import { drawRasterActions } from '../src/capabilities/companion/presentation/dango-raster-actions.mjs';
test('actual action painter draws wrapped palm after tool and lid-occluded palm before tool', () => {
  for(const occlusion of [undefined,'behind-tool']){
    const events=[],hand={side:'right',limb:true,pawOcclusion:occlusion};
    const artwork={layeredReady:true,actionReady:true,view:'front',data:{parts:{}},matrices:{},
      contact:{hands:[hand],tools:[{key:'broom',x:0,y:0}],details:[],layer:'front'},
      limbPainter:{paint(_ctx,o){if(o.layer===(occlusion?'before-tools':'front'))events.push('palm');return true;}}};
    drawRasterActions({}, {artwork,layer:'front',action:{prop:'broom'}},
      {manifest:{tools:{broom:{}}},painter:{paint(){events.push('tool');return true;}}});
    assert.deepEqual(events,occlusion?['palm','tool']:['tool','palm']);
  }
});

test('actual-alpha exposure is cached by discrete composition and counts visible arm pixels', () => {
  const px={width:1,height:1,data:new Uint8ClampedArray([248,104,120,255])};let queries=0;
  const src={...source,pixels:key=>key==='upper'||key==='fore'?px:null,
    bodyAlpha(){queries++;return false;}};
  const plan={view:'front',side:'l',pose:'grip',S:[4.5,45.5],E:[10.5,45.5],W:[16.5,45.5],
    U:{src:'upper',root:[.5,.5]},F:{src:'fore',root:[.5,.5]},paw:{src:'none',root:[.5,.5]},
    joint:{key:'test',mask:null},mirrorArm:false,pawMirror:false};
  assert.equal(limb.exposedArmArea(src,plan),1);const before=queries;
  assert.equal(limb.exposedArmArea(src,plan),1);assert.equal(queries,before);
});

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { createDangoLimbSource } from '../src/capabilities/companion/presentation/dango-limb-assets.mjs';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
test('dense cup playback remains legacy for the whole unreachable contact interval', async () => {
  const { createCanvas,loadImage }=createRequire(import.meta.url)('@napi-rs/canvas');
  const src=createDangoLimbSource({baseUrl:DANGO_RASTER.baseUrl,acceptContract:2,
    loadJson:async u=>JSON.parse(fs.readFileSync(fileURLToPath(u))),loadImage:u=>loadImage(fileURLToPath(u)),
    readPixels:img=>{const c=createCanvas(img.width,img.height),x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,img.width,img.height);}});
  const artist=createDangoRasterArtist({manifest:DANGO_RASTER,limbs:src,loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas});
  await artist.ready({all:true});
  try{for(let i=0;i<=64;i++){
    const action=PET_ACTIONS['sip-tea'];const z=artist.resolveArtwork({action,motion:action.motion,view:'front',progress:i/64,elapsedMs:i*60});
    assert.ok(z.contact.hands.every(h=>h.limb!==true),`v2 flicker at ${i}/64`);
  }}finally{artist.dispose();}
});

test('unreviewed behind-body hand depth remains legacy, even at a reachable contact', () => {
  const p=limb.createDangoLimbPainter({source,createSurface:()=>null});
  const hand={side:'left',gripPoint:[20,52]};assert.ok(p.plan('front',hand,{prop:'cup'}));
  assert.equal(p.plan('front',{...hand,layer:'back'},{prop:'cup'}),null);
});
