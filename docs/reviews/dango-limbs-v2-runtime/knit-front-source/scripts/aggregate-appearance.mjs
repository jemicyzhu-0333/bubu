import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root,out,imp} from './qa-paths.mjs';
const read=p=>JSON.parse(fs.readFileSync(path.join(out,'evidence',p),'utf8'));
const geometry=read('appearance-geometry.json'),guard=read('appearance-source-draw-guard.json');
assert.equal(geometry.actualProduction,true);assert.equal(guard.actualProduction,true);
assert.equal(geometry.groups,32);assert.equal(guard.groups,32);assert.equal(geometry.frames,192);
assert.equal(geometry.rootOutside,0);assert.equal(geometry.sourceSelected,true);
assert.equal(guard.expectedChecks,384);assert.equal(guard.report.length+guard.occluded.length,384);
assert.equal(guard.occluded.length,0,'approved appearance scope must retain both visible hand contributions');
assert.ok(guard.report.every(r=>r.changedPixels>0));
const {DANGO_RASTER}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {KNIT_CONTACT_KEYS}=await imp('src/capabilities/companion/presentation/dango-knit-contact-pose.mjs');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=['src/capabilities/companion/presentation/dango-knit-contact-pose.mjs',
  'src/capabilities/companion/presentation/dango-source-contact-pose.mjs',
  'src/capabilities/companion/presentation/dango-raster-art.mjs',
  'assets/companion/dango/raster/dango.raster.mjs','src/content/appearance.mjs',
  ...Object.values(KNIT_CONTACT_KEYS).map(k=>path.relative(root,fileURLToPath(new URL(DANGO_RASTER.tools[k].src,DANGO_RASTER.baseUrl))))];
const report={status:'pass',actualProduction:true,
  scope:'Unchanged production artist/selector/renderer; all 16 Dango appearance items individually, 15 item-plus-scarf pairs and no-outfit baseline. Skin-specific accessories use their actual skin. DPR 2, phases .15/.5/.85, facing +/-1. Not a Cartesian product of every accessory slot.',
  groups:geometry.groups,frames:geometry.frames,
  descriptorsPinned:['data.body','data.parts','data.face','data.anchors','contact.tools','contact.details'],
  actualAppearanceSelectionMatchesRequest:true,sourceSelectedBothHands:true,allMasksActualStageDimensions:true,
  stageDimensions:geometry.dimensions,drawOrder:geometry.drawOrder,rootPixelsOutsideBody:geometry.rootOutside,
  singleHandFinalContributionChecks:guard.report.length,minimumChangedFinalPixels:Math.min(...guard.report.map(r=>r.changedPixels)),
  fullyOccludedCases:guard.occluded,allChecksAccounted:true,backend:'Skia actual createPetRenderer, not native browser',
  sourceHashes:Object.fromEntries(files.map(p=>[p,hash(path.join(root,p))])),
  scriptHashes:Object.fromEntries(['appearance-geometry.mjs','appearance-draw-qa.mjs','aggregate-appearance.mjs','fixture.mjs','qa-paths.mjs','source-draw-guard.mjs'].map(p=>[p,hash(fileURLToPath(new URL(p,import.meta.url)))])),
  reproduction:{workingDirectory:'/tmp',commands:[
    'node "$REPO/docs/reviews/dango-limbs-v2-runtime/knit-front-source/scripts/appearance-geometry.mjs" --repo "$REPO" --out "$OUT"',
    'node "$REPO/docs/reviews/dango-limbs-v2-runtime/knit-front-source/scripts/appearance-draw-qa.mjs" --repo "$REPO" --out "$OUT"',
    'node "$REPO/docs/reviews/dango-limbs-v2-runtime/knit-front-source/scripts/aggregate-appearance.mjs" --repo "$REPO" --out "$OUT"'],
    outputRule:'OUT must be outside REPO; no frames or generated fixtures are written into the repository.'}};
fs.writeFileSync(path.join(out,'appearance-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,groups:report.groups,frames:report.frames,checks:report.singleHandFinalContributionChecks,minimumChangedFinalPixels:report.minimumChangedFinalPixels}));
