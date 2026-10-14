// Offscreen standard-artist review; never activates checked-in limb defaults.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out') throw Error('Usage: node tools/dango-contact-review/render-quarter.mjs --out <directory>');
const out = path.resolve(args[1]);
fs.mkdirSync(out, { recursive: true });
const {createCanvas,loadImage}=createRequire(import.meta.url)('@napi-rs/canvas');
const {loadLimbSource}=await import('../dango-limbs-qa.mjs');
const {solveLimb,pawLayer,contactContract}=await import('../../src/capabilities/companion/presentation/dango-limb-compose.mjs');
const {createDangoRasterArtist}=await import('../../src/capabilities/companion/presentation/dango-raster-art.mjs');
const {DANGO_RASTER}=await import('../../assets/companion/dango/raster/dango.raster.mjs');
const {PET_ACTIONS}=await import('../../src/content/behaviors.mjs');
const {PALETTES}=await import('../../src/core/pet-art.mjs');
const source=await loadLimbSource(),load=u=>loadImage(fileURLToPath(u));
const base=createDangoRasterArtist({manifest:DANGO_RASTER,loadImage:load,createSurface:createCanvas});
const preview=createDangoRasterArtist({manifest:DANGO_RASTER,loadImage:load,createSurface:createCanvas,limbs:source});
await Promise.all([base.ready({all:true}),preview.ready({all:true})]);
function render(artist,art,action,facing){const c=createCanvas(219,219),x=c.getContext('2d');x.scale(1.5,1.5);if(facing===-1){x.translate(146,0);x.scale(-1,1);}x.translate(40,40);let o={action,artwork:art,palette:PALETTES.pink,view:art.view,progress:art.progress};artist.action(x,{...o,layer:'back'});artist.body(x,PALETTES.pink,art.view,art);artist.face(x,PALETTES.pink,{},false,art.view,null,art);artist.action(x,{...o,layer:'front'});return c;}
const sheet=createCanvas(876,750),ctx=sheet.getContext('2d');ctx.fillStyle='#eeeae4';ctx.fillRect(0,0,sheet.width,sheet.height);ctx.font='12px sans-serif';ctx.fillStyle='#222';
const records=[],comparisons=[];
const rgba=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
for(const [row,id] of ['sip-tea','carry-energy','read-book'].entries()){
 let action=PET_ACTIONS[id],options={action,motion:action.motion,view:'three-quarter',progress:.5,elapsedMs:2000};let a=base.resolveArtwork(options),b=preview.resolveArtwork(options);
 for(const [column,[artist,art,facing,label]]of [[base,a,1,'default / right'],[preview,b,1,'opt-in / right'],[base,a,-1,'default / left'],[preview,b,-1,'opt-in / left']].entries()){
  const frame=render(artist,art,action,facing);ctx.drawImage(frame,column*219,row*250);ctx.fillStyle='#222';ctx.fillText(`${id}: ${label}`,column*219+6,row*250+232);
 }
 for(const facing of [1,-1]){const aa=rgba(render(base,a,action,facing)),bb=rgba(render(preview,b,action,facing));let differentBytes=0;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])differentBytes++;comparisons.push({id,facing,differentBytes});}
 records.push({action:id,view:b.view,tools:b.contact.tools,hands:b.contact.hands.map(h=>{const contract=contactContract(h,action),plan=contract&&solveLimb(source,{view:b.view,side:h.side,target:contract.target,pose:contract.pose,contract});return{side:h.side,limb:h.limb===true,target:contract?.target,assetSide:plan?.side,source:plan?.paw.source,paw:plan?.paw.src,pawMirror:plan?.pawMirror,wholePoseReflection:plan?.reflectAxis,layer:plan&&pawLayer(plan),error:plan?.error,fixedShoulder:plan?.S};})});
}
fs.writeFileSync(out+'/standard-quarter-default-optin.png',sheet.toBuffer('image/png'));
const palms=createCanvas(780,260),pc=palms.getContext('2d');pc.fillStyle='#eeeae4';pc.fillRect(0,0,780,260);pc.fillStyle='#222';pc.font='13px sans-serif';
for(const [i,[side,target]]of [['left',[17.5,45.5]],['right',[35.5,48.5]]].entries()){
 const p=solveLimb(source,{view:'three-quarter-left',side,target,pose:'hold'}),raw=source.pixels(p.paw.src),c=createCanvas(raw.width,raw.height),cx=c.getContext('2d'),im=cx.createImageData(raw.width,raw.height);im.data.set(raw.data);cx.putImageData(im,0,0);pc.imageSmoothingEnabled=false;pc.drawImage(c,20+i*390,32,raw.width*8,raw.height*8);pc.fillText(`${p.paw.semantic.sideRole} | raw source frame`,10+i*390,20);pc.fillText(`layer=${pawLayer(p)}; pawMirror=false`,10+i*390,235);
}
fs.writeFileSync(out+'/independent-quarter-palms-8x.png',palms.toBuffer('image/png'));
fs.writeFileSync(out+'/results.json',JSON.stringify({status:'WIRING PASS ONLY; quarter natural contact still NO-GO',backend:'Actual standard artist using offscreen Skia; no browser/native evidence',comparisons,records},null,2));base.dispose();preview.dispose();
