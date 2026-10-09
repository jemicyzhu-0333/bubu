// Actual paused-image decoding exercises the unchanged popover subscription path.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const backend=createRequire(import.meta.url)(arg('canvas-package'));
const mode=arg('mode')||'release',waiting=[];let hold=true;
globalThis.Image=class extends backend.Image{
 get src(){return this.localSource||'';}
 set src(value){
  this.localSource=value;if(!value)return;
  const decode=()=>{try{if(mode==='failure'&&value.includes('/usagi/wardrobe/'))throw Error('injected wardrobe decode failure');super.src=fs.readFileSync(fileURLToPath(value));}catch(error){queueMicrotask(()=>this.onerror?.(error));}};
  if(hold&&value.includes('/usagi/wardrobe/'))waiting.push(decode);else decode();
 }
};
globalThis.Path2D=backend.Path2D;
const make=()=>{const c=backend.createCanvas(1,1);c.style={};return c;};globalThis.document={createElement:make};globalThis.window={devicePixelRatio:2};
const {createCompanionPortraitPainter}=await import('../../src/surfaces/popover/features/companion-portrait.mjs');
const {default:artist}=await import('../../src/capabilities/companion/presentation/usagi-art.mjs');
const {USAGI_OUTFIT_SETS}=await import('../../src/content/companion/usagi-wardrobe.mjs');
const {pixels}=await import('../usagi-gallery/pixels.mjs');
const out=path.resolve(`dist/usagi-complete-review/cold-${mode}`);fs.mkdirSync(out,{recursive:true});
const rows=[];
for(const look of USAGI_OUTFIT_SETS){
 const hero=make(),thumb=make(),preview=make(),painter=createCompanionPortraitPainter({document,window,canvas:hero});
 painter.drawHero({skinId:'usagi',itemIds:look.itemIds,calmVisual:true,now:0});
 painter.drawPetPreview(thumb,{skinId:'usagi',itemIds:look.itemIds,size:'thumb'});
 painter.drawPetPreview(preview,{skinId:'usagi',itemIds:look.itemIds,size:'preview'});
 const surfaces={hero,thumb,preview},before={};
 for(const [tier,canvas] of Object.entries(surfaces)){before[tier]=pixels(canvas);fs.writeFileSync(path.join(out,`${look.id}-${tier}-cold.png`),canvas.toBuffer('image/png'));}
 rows.push({look,painter,surfaces,before});
}
const ready=artist.ready();await new Promise(r=>setImmediate(r));hold=false;for(const decode of waiting)decode();await ready;await new Promise(r=>setImmediate(r));
const report=[];const sheet=backend.createCanvas(1320,750),ctx=sheet.getContext('2d');ctx.fillStyle='#eeeae2';ctx.fillRect(0,0,1320,750);
for(const [index,row] of rows.entries()){
 const data={id:row.look.id,mode,tiers:{}};
 for(const [tier,canvas] of Object.entries(row.surfaces)){
  const after=pixels(canvas);data.tiers[tier]={beforeHash:row.before[tier].hash,afterHash:after.hash,occupied:after.occupied,changed:row.before[tier].hash!==after.hash};
  if(!after.occupied)throw Error('Blank static portrait');
  if(mode==='release'&&!data.tiers[tier].changed)throw Error(`No async redraw: ${row.look.id}/${tier}`);
  fs.writeFileSync(path.join(out,`${row.look.id}-${tier}-ready.png`),canvas.toBuffer('image/png'));
 }
 const cold=await backend.loadImage(path.join(out,`${row.look.id}-hero-cold.png`));ctx.fillStyle='#342923';ctx.font='16px sans-serif';ctx.fillText(`${row.look.id}: cold / ${mode}`,index*440+15,25);ctx.drawImage(cold,index*440+50,55,296,296);ctx.drawImage(row.surfaces.hero,index*440+50,400,296,296);
 row.painter.dispose();report.push(data);
}
fs.writeFileSync(path.join(out,'portraits.png'),sheet.toBuffer('image/png'));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({renderer:'Actual popover painter offscreen Skia; images deliberately delayed, then decoded or failed. No manual repaint after release.',records:report},null,2));console.log(JSON.stringify(report));
