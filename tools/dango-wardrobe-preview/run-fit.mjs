import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createRenderHarness, loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { traceFrame } from '../dango-state-cycle-preview/metrics.mjs';
import { makeMetrics,summarize } from './metrics.mjs';
const arg = name => process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const backend=createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(pathToFileURL(process.cwd()).href),metrics=makeMetrics(backend),reports=[];
for(const key of ['sunhat','sprout']) {
 const harness=createRenderHarness(source,{skin:'pink',view:'three-quarter',outfit:['milestone.scarf',`milestone.${key}`],blink:false});harness.select('action','chase-laser');
 const rows=[];for(let f=0;f<60;f++){const at=1900+f/60*950;const t=traceFrame(harness,at);rows.push(metrics.measure(t,harness.body,at,key,true));}
 reports.push({key,...summarize(rows),rows});harness.dispose();
}
metrics.dispose();fs.writeFileSync('dist/dango-wardrobe-review/run-fit.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports.map(({rows,...r})=>r),null,2));
