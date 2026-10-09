// Review actual wardrobe ordering at one fixed neutral-reference scale per view.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const { pixels } = await import('../usagi-gallery/pixels.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = await loadSource(pathToFileURL(path.resolve(arg('baseline'))).href);
const current = await loadSource(pathToFileURL(root).href);
const outfits = [
 ['GARDEN', ['garden-beret','daisy-clip','petal-collar','seed-pouch','garden-apron','garden-clogs']],
 ['MOON', ['moon-beret','star-collar','envelope-pouch','starlit-cape','constellation','moon-boots']]
];
// Catalogue IDs are checked rather than silently ignoring a misspelled accessory.
for (const [, ids] of outfits) for (const id of ids) if (!current.wardrobe.PET_APPEARANCE_ITEMS.some(item => item.id === `usagi.${id}`)) throw Error(`Unknown ${id}`);
const out = path.resolve(arg('out')); fs.mkdirSync(out,{recursive:true});
const records = [];
for (const theme of ['light','dark']) {
 const canvas = backend.createCanvas(1440, 1000), context = canvas.getContext('2d');
 const bg = theme === 'light' ? '#f4f0e9' : '#282934', fg = theme === 'light' ? '#382d2b' : '#efe5d8';
 context.fillStyle = bg; context.fillRect(0,0,1440,1000); context.fillStyle=fg;
 context.font='20px sans-serif'; context.fillText('USAGI / GARDEN + MOON / actual production wardrobe depth',18,28);
 context.font='12px sans-serif'; context.fillText('BEFORE = frozen source v2 / AFTER = corrected layers / fixed 99px and 198px neutral-reference height',18,50);
 for (const [row,[name,ids]] of outfits.entries()) for (const [col,view] of ['front','three-quarter','profile','back'].entries()) {
  const x = col*360, y = row*463+74;
  const options = {skin:'usagi',view,dpr:2,calm:true,blink:false,outfit:ids.map(id=>`usagi.${id}`)};
  const ref=createRenderHarness(before,{...options,outfit:false}); ref.select('expression','life.idle');ref.draw(0);
  const bounds=pixels(ref.body).bounds, h=bounds.bottom-bounds.top+1, anchor=[(bounds.left+bounds.right+1)/2,bounds.bottom+1];ref.dispose();
  context.fillStyle=fg;context.font='14px sans-serif';context.fillText(`${name} / ${view}`,x+12,y);
  for (const [version,source] of [before,current].entries()) {
   const painter=createRenderHarness(source,options);painter.select('expression','life.idle');painter.draw(0);
   context.font='12px sans-serif';context.fillText(version?'AFTER':'BEFORE',x+22+version*176,y+24);
   for (const [i,size] of [99,198].entries()) {
    const scale=size/h, baseline=y+(i?369:153), center=x+88+version*176;
    context.drawImage(painter.body,center-anchor[0]*scale,baseline-anchor[1]*scale,painter.body.width*scale,painter.body.height*scale);
   }
   if(theme==='light')records.push({outfit:name,view,version:version?'after':'before',hash:pixels(painter.body).hash,neutralBounds:bounds,neutralHeight:h});
   painter.dispose();
  }
  context.font='11px sans-serif';context.fillText('99px reference above / 198px below',x+12,y+407);
 }
 fs.writeFileSync(path.join(out,`wardrobe-views-${theme}.png`),canvas.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'wardrobe-views.json'),JSON.stringify({renderer:'production createPetRenderer, offscreen Skia',baselineRef:arg('baseline-ref')||'local-source',records,note:'Reference height excludes outfits and stays constant across before/after; static four-view ordering, not dynamic acceptance.'},null,2));
