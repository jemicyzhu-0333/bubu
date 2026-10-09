import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const backend=createRequire(import.meta.url)(arg('canvas-package'));installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;
globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const {loadSource,createRenderHarness}=await import('../usagi-gallery/runtime-harness.mjs');
const {pixels}=await import('../usagi-gallery/pixels.mjs');const source=await loadSource(pathToFileURL(process.cwd()).href);
const out=path.resolve('dist/usagi-complete-review/scenes');fs.mkdirSync(out,{recursive:true});const scenes=Object.values(source.scenes.SCENES),records=[];
for(let page=0;page<5;page++){
 const image=backend.createCanvas(1320,1300),ctx=image.getContext('2d');ctx.fillStyle='#eeeae2';ctx.fillRect(0,0,1320,1300);
 for(const [row,item] of scenes.slice(page*5,page*5+5).entries()){
  const painter=createRenderHarness(source,{skin:'usagi',dpr:2,outfit:false,blink:true});painter.select('scene',item.id);const hashes=new Set();
  for(let frame=0;frame<=180;frame++){
   const at=frame*1000/30;painter.draw(at);hashes.add(pixels(painter.scene).hash);
   if(frame%36===0){const col=frame/36,composite=painter.composite();ctx.drawImage(composite,col*220,row*260+25,220,220);ctx.fillStyle='#3b2923';ctx.font='12px sans-serif';ctx.fillText(`${item.id} / ${(at/1000).toFixed(1)}s`,col*220+5,row*260+20);}
  }
  records.push({id:item.id,feature:item.feature,frames:181,normalFps:30,durationMs:6000,uniqueSceneFrames:hashes.size,sheet:`scenes-${page}.png`,visualStatus:'pending'});painter.dispose();
 }
 fs.writeFileSync(path.join(out,`scenes-${page}.png`),image.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({renderer:'Actual production renderer, offscreen Skia',bodyCssWidth:99,records},null,2));
