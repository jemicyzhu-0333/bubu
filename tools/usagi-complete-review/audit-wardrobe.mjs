import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { USAGI_INTERACTION_PAIRS } from './review-matrix.mjs';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const { pixels } = await import('../usagi-gallery/pixels.mjs');
const source = await loadSource(pathToFileURL(process.cwd()).href);
const { USAGI_OUTFIT_SETS } = await import('../../src/content/companion/usagi-wardrobe.mjs');
const items=source.wardrobe.PET_APPEARANCE_ITEMS.filter(x=>x.formId==='usagi');
const looks=process.argv.includes('--only-pairs') ? USAGI_INTERACTION_PAIRS : [{id:'bare',itemIds:[]},...items.map(x=>({id:x.id,itemIds:[x.id]})),...USAGI_OUTFIT_SETS];
const out=path.resolve(arg('out')||'dist/usagi-complete-review/wardrobe');fs.mkdirSync(out,{recursive:true});
const records=[];
for(const look of looks){
 const image=backend.createCanvas(1280,780),ctx=image.getContext('2d');
 ctx.fillStyle='#eeeae2';ctx.fillRect(0,0,1280,780);ctx.fillStyle='#3b2923';ctx.font='20px sans-serif';ctx.fillText(look.id,20,25);
 for(const [col,view] of ['front','three-quarter','profile','back'].entries()){
  const painter=createRenderHarness(source,{skin:'usagi',view,dpr:2,calm:true,blink:false,outfit:look.itemIds});
  painter.select('expression','life.idle');painter.draw(0);
  const p=pixels(painter.body);records.push({id:look.id,view,hash:p.hash,bounds:p.bounds,items:look.itemIds});
  ctx.fillStyle='#3b2923';ctx.font='14px sans-serif';ctx.fillText(view,col*320+15,50);
  // Stage uses body design width 66 art units * 1.5 CSS = 99 CSS px.
  for(const [row,scale] of [[0,1],[1,2]]){
   const w=painter.stage.cssWidth*scale,h=painter.stage.cssHeight*scale;
   ctx.drawImage(painter.body,col*320+(320-w)/2,60+row*240,w,h);
  }
  painter.dispose();
 }
 fs.writeFileSync(path.join(out,`${look.id}.png`),image.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({scope:process.argv.includes('--only-pairs') ? '14 named two-slot interaction pairs, four requested views, fixed 99/198 CSS body design width. Not power-set or desktop acceptance.' : '25 single items, bare, three curated combinations; four requested views, fixed 99/198 CSS body design width. Actual production renderer offscreen Skia. Not power-set or desktop acceptance.',records},null,2));
console.log(`${looks.length} looks captured`);
