// Intended repository location: test/dango-shoulder-registration.test.mjs.
// BUBU_REPO / DANGO_LIMB_PACKAGE_DIR are optional read-only staging overrides.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.BUBU_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const imp=p=>import(pathToFileURL(path.join(root,p)));
const {createCanvas,loadImage}=createRequire(path.join(root,'package.json'))('@napi-rs/canvas');
const {createDangoLimbSource}=await imp('src/capabilities/companion/presentation/dango-limb-assets.mjs');
const {contactContract,createDangoLimbPainter,composeLimb,DANGO_LIMB_BOX:box}=await imp('src/capabilities/companion/presentation/dango-limb-compose.mjs');
const {createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const {DANGO_RASTER}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {DANGO_LIMB_RIG}=await imp('src/content/companion/dango-limbs.mjs');
const {PET_ACTIONS}=await imp('src/content/behaviors.mjs');
const original=path.join(root,'assets/companion/dango/raster/limbs');
const staged=process.env.DANGO_LIMB_PACKAGE_DIR||original;
function file(url){const current=fileURLToPath(url);return fs.existsSync(current)?current:path.join(original,path.relative(staged,current));}
const source=createDangoLimbSource({baseUrl:pathToFileURL(staged+'/').href,manifestPath:'limbs.json',acceptContract:2,
 loadJson:async u=>JSON.parse(fs.readFileSync(file(u))),loadImage:u=>loadImage(file(u)),
 readPixels:im=>{const c=createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);return x.getImageData(0,0,im.width,im.height);}});
await source.start();

test('front right shoulder remains canonical-x half-grid registered and disabled by default',()=>{
 assert.equal(source.state(),'ready',JSON.stringify(source.errors()));
 const socket=source.manifest().sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='r');
 assert.deepEqual(socket.sourceBodyAnchor,[58.6,39.712821]);
 assert.deepEqual(socket.worldRoot,[Math.round(socket.sourceBodyAnchor[0]-.5)+.5,45.5]);
 assert.deepEqual(socket.worldRoot,[58.5,45.5]);
 assert.equal(source.manifest().extensions.runtimeReady,false);
 assert.equal(DANGO_LIMB_RIG.hostAcceptsContract,null);
});

test('composer ignores animated legacy shoulder endpoints and translates the whole limb exactly once',()=>{
 const painter=createDangoLimbPainter({source,createSurface:createCanvas});
 const action=PET_ACTIONS['bubble-blow'],hand={side:'right',gripPoint:[54.046795,53.653846],points:[[58.6,39.712821],[54.046795,53.653846]]};
 const reference=painter.plan('front',hand,action);assert.ok(reference);assert.deepEqual(reference.S,[58.5,45.5]);
 for(const legacyRoot of [[0,0],[137,-93],[-41,81]]){
  const p=painter.plan('front',{...hand,points:[legacyRoot,hand.gripPoint]},action);
  assert.deepEqual(p.S,reference.S);assert.deepEqual(p.E,reference.E);assert.deepEqual(p.W,reference.W);assert.deepEqual(p.contactWorld,reference.contactWorld);
 }
 const render=([dx,dy])=>{const c=createCanvas(256,256),x=c.getContext('2d');x.translate(80+dx,80+dy);for(const layer of ['back','front'])painter.paint(x,{view:'front',hand,action,layer,palette:null});return x.getImageData(0,0,256,256).data;};
 const originalPixels=render([0,0]);
 for(const shift of [[17,-9],[-13,11],[0,0]]){
  const pixels=render(shift);let visible=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const nx=x+shift[0],ny=y+shift[1],from=(y*256+x)*4;
   if(originalPixels[from+3])visible++;
   if(nx<0||nx>=256||ny<0||ny>=256){assert.equal(originalPixels[from+3],0);continue;}
   const to=(ny*256+nx)*4;
   for(let channel=0;channel<4;channel++)assert.equal(pixels[to+channel],originalPixels[from+channel]);
  }
  assert.ok(visible>0);
  const contact=reference.contactWorld.map((n,i)=>n+shift[i]),target=hand.gripPoint.map((n,i)=>n+shift[i]);
  assert.ok(Math.abs(Math.hypot(contact[0]-target[0],contact[1]-target[1])-reference.error)<1e-9);
 }
 painter.dispose();
});

test('actual generic bubble keeps its fixed target, whole-action admission and body-covered arm',async()=>{
 const artist=createDangoRasterArtist({manifest:DANGO_RASTER,limbs:source,loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas});
 await artist.ready({all:true});const action=PET_ACTIONS['bubble-blow'];let joint=null;
 try{for(let i=0;i<=256;i++){
  const z=artist.resolveArtwork({action,motion:action.motion,view:'front',progress:i/256,elapsedMs:i/256*action.duration});
  const h=z.contact.hands.find(h=>h.side==='right');assert.equal(h.limb,true);assert.equal(z.sourceContactPose,undefined);
  assert.deepEqual(contactContract(h,action).target,[54.046795,53.653846]);
  const p=z.limbPainter.plan(z.view,h,action);assert.deepEqual(p.S,[58.5,45.5]);assert.ok(p.error<=.75);
  if(joint===null)joint=p.joint.key;else assert.equal(p.joint.key,joint);
  const c=composeLimb(source,p);
  for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){
   const k=(y*box.w+x)*4+3;
   if(c.arm.data[k]&&!c.paw.data[k])assert.equal(source.bodyAlpha(p.view,x+box.x+.5,y+box.y+.5),true);
  }
 }}finally{artist.dispose();}
});
