import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {installOffscreenImages} from '../usagi-gallery/offscreen-images.mjs';
import {loadSource,createRenderHarness} from '../usagi-gallery/runtime-harness.mjs';
const backend=createRequire(import.meta.url)('@napi-rs/canvas');installOffscreenImages(backend);
globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:1};
const roots=[new URL('../../../integration-baseline/',import.meta.url),new URL('../../',import.meta.url)];
const sources=await Promise.all(roots.map(url=>loadSource(url.href.replace(/\/$/,''))));
const hash=x=>createHash('sha256').update(x).digest('hex'),records=[];
const cases=[];
for(const view of ['front','three-quarter','back']){
 for(const id of Object.keys(sources[0].behaviors.PET_ACTIONS))for(const progress of [.25,.7])cases.push({kind:'action',id,view,progress,outfit:[]});
 for(const item of sources[0].wardrobe.PET_APPEARANCE_ITEMS.filter(x=>x.formId==='dango'))cases.push({kind:'expression',id:'life.idle',view,progress:.4,outfit:[item.id]});
}
for(const spec of cases){const hashes=sources.map(source=>{const h=createRenderHarness(source,{skin:'pink',view:spec.view,blink:false,dpr:1,outfit:spec.outfit});const entry=h.select(spec.kind,spec.id);h.draw(0);h.draw(entry.duration*spec.progress);const value=hash(h.body.toBuffer('image/png'));h.dispose();return value;});records.push({...spec,baseline:hashes[0],candidate:hashes[1],equal:hashes[0]===hashes[1]});}
const result={scope:'Actual application renderer, historical actions and original wardrobe, no new clothing opted in',cases:records.length,mismatches:records.filter(r=>!r.equal),records};fs.writeFileSync(new URL('../../../evidence-production/original-state-regression.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({cases:records.length,mismatches:result.mismatches.length}));if(result.mismatches.length)process.exitCode=1;
