import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root,out,imp} from './qa-paths.mjs';
const read=p=>JSON.parse(fs.readFileSync(path.join(out,'evidence',p),'utf8'));
const matrix=read('strict-contact-matrix.json'),guard=read('strict-source-draw-guard.json');
assert.equal(matrix.actualProduction,true);assert.equal(guard.actualProduction,true);
assert.equal(matrix.frames,1032);assert.equal(matrix.lifecycle.length,32);
assert.equal(matrix.failures.length,0);assert.equal(guard.report.length,3168);
assert.ok(guard.report.every(r=>r.changedPixels>0));
const {DANGO_RASTER}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {KNIT_CONTACT_KEYS}=await imp('src/capabilities/companion/presentation/dango-knit-contact-pose.mjs');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=['src/capabilities/companion/presentation/dango-knit-contact-pose.mjs',
  'src/capabilities/companion/presentation/dango-source-contact-pose.mjs',
  'src/capabilities/companion/presentation/dango-raster-art.mjs',
  'assets/companion/dango/raster/dango.raster.mjs',
  ...Object.values(KNIT_CONTACT_KEYS).map(k=>path.relative(root,fileURLToPath(new URL(DANGO_RASTER.tools[k].src,DANGO_RASTER.baseUrl))))];
const report={status:'pass',actualProduction:true,productionIntegration:true,
  selectionRoute:matrix.selectionRoute,backend:matrix.backend,
  geometryFrames:matrix.frames,actualRendererLifecycleCases:matrix.lifecycle.length,
  singleHandContributionChecks:guard.report.length,minimumChangedFinalPixels:Math.min(...guard.report.map(r=>r.changedPixels)),
  stageDimensions:matrix.dimensions,drawOrder:matrix.drawOrder,geometry:matrix.reports,geometryFailures:matrix.failures,
  sourceHashes:Object.fromEntries(files.map(p=>[p,hash(path.join(root,p))])),
  scriptHashes:Object.fromEntries(fs.readdirSync(fileURLToPath(new URL('.',import.meta.url))).filter(p=>p.endsWith('.mjs')).sort().map(p=>[p,hash(fileURLToPath(new URL(p,import.meta.url)))])),
  reproduction:{workingDirectory:'/tmp',commands:[
    'node "$REPO/docs/reviews/dango-limbs-v2-runtime/knit-front-source/scripts/matrix.mjs" --repo "$REPO" --out "$OUT"',
    'node "$REPO/docs/reviews/dango-limbs-v2-runtime/knit-front-source/scripts/strict-draw-qa.mjs" --repo "$REPO" --out "$OUT"',
    'node "$REPO/docs/reviews/dango-limbs-v2-runtime/knit-front-source/scripts/aggregate.mjs" --repo "$REPO" --out "$OUT"'],
    outputRule:'OUT must be outside REPO. Generated adapters, renderer fixtures and reports are written only beneath OUT.',
    observation:'Only module routing and the final cached-body draw observer are adapted in temporary fixtures. The production selector, helper, renderer draw calls and PNG registration remain unchanged.'}};
fs.writeFileSync(path.join(out,'QA-SUMMARY.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,actualProduction:true,geometryFrames:report.geometryFrames,lifecycle:report.actualRendererLifecycleCases,guard:report.singleHandContributionChecks}));
