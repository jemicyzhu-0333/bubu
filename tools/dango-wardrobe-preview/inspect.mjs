import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createRenderHarness, loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { traceFrame } from '../dango-state-cycle-preview/metrics.mjs';
import { pixels } from '../usagi-gallery/pixels.mjs';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const root = process.cwd(), source = await loadSource(pathToFileURL(root).href);
const out = path.resolve(arg('out') || 'dist/dango-wardrobe-review'); fs.mkdirSync(out, { recursive: true });
const sheet = backend.createCanvas(1440, 810), ctx = sheet.getContext('2d');
ctx.fillStyle = '#edf1ec'; ctx.fillRect(0, 0, sheet.width, sheet.height);
function label(s,x,y,size=14) {ctx.fillStyle='#28413a';ctx.font=`${size}px sans-serif`;ctx.fillText(s,x,y);}
label('EXISTING WARDROBE / FIRST ACTUAL PAINTER INSPECTION',24,30,23);
label('99 CSS px body design width + 2x / no changed art or playback timing',24,54);
const records=[];
for (const [col,key] of ['scarf','sunhat','sprout'].entries()) {
 const outfit=['milestone.scarf', ...(key==='scarf'?[]:[`milestone.${key}`])];
 for (const [row,kind,id] of [[0,'expression','life.idle'],[1,'action','chase-laser']]) {
  const harness=createRenderHarness(source,{skin:'pink',view:'three-quarter',outfit,blink:false,dpr:2});harness.select(kind,id);
  let trace;for(let f=0;f<=45;f++)trace=traceFrame(harness,f/30*1000);
  const p=pixels(harness.body),x=col*480,y=80+row*360;
  ctx.fillStyle='white';ctx.fillRect(x+6,y,468,350);
  label(`${key.toUpperCase()}${key==='scarf'?'':' + SCARF'} / ${row?'RUN':'IDLE'}`,x+18,y+28,18);
  label('99 CSS px',x+24,y+54);label('2x',x+295,y+54);
  ctx.drawImage(harness.body,x-17,y+112,219,219);ctx.drawImage(harness.body,x+80,y+12,438,438);
  records.push({key,kind,id,...p,image:undefined,calls:trace.calls.map(({image,...call})=>call)});
  harness.dispose();
 }
}
fs.writeFileSync(path.join(out,'first-painter-inspection.png'),sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(out,'first-painter-inspection.json'),JSON.stringify(records,null,2));
console.log(JSON.stringify(records.map(({calls,...r})=>({...r,wardrobe:calls.filter(c=>c.src?.includes('/wardrobe/')).map(c=>({src:c.src,rect:c.rect,matrix:c.matrix}))})),null,2));
