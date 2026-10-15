import fs from 'node:fs';
import {createRequire} from 'node:module';
import {installOffscreenImages} from '../usagi-gallery/offscreen-images.mjs';
import {loadSource,createRenderHarness} from '../usagi-gallery/runtime-harness.mjs';
const backend=createRequire(import.meta.url)('@napi-rs/canvas');
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;
globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(new URL('../../',import.meta.url).href.replace(/\/$/,''));
const out=new URL('../../../evidence-production/',import.meta.url);fs.mkdirSync(out,{recursive:true});
for(const outfit of [[],['seasonal.pumpkin-beret','seasonal.plum-cape'],['seasonal.pumpkin-beret','seasonal.plum-cape','milestone.boots','milestone.satchel']]){
 const h=createRenderHarness(source,{skin:'pink',view:'front',dpr:2,blink:false,outfit});h.select('action','halloween-lantern');
 for(const t of [0,1000,2400,3800,5700,6800,7199]){h.draw(t);fs.writeFileSync(new URL(`halloween-${outfit.length}-${t}.png`,out),h.body.toBuffer('image/png'));}
 h.updateState({devPreview:null,currentEgg:null});h.draw(7400);fs.writeFileSync(new URL(`halloween-${outfit.length}-off.png`,out),h.body.toBuffer('image/png'));h.dispose();
}
console.log('Captured actual registered production renderer, no overlay compositor.');
