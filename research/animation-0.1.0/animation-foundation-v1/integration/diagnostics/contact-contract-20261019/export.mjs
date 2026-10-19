import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {exportPaths} from './export-paths.mjs';
const {research,out}=exportPaths();
const {loadGLB,disposeAsset,sha256}=await import(pathToFileURL(path.join(research,'animation-foundation-v1/integration/asset-fixtures.mjs')));
const {bakeAccessory}=await import(pathToFileURL(path.join(research,'animation-foundation-v1/secondary-motion/asset-admission.mjs')));
const model=path.join(research,'wearable-approved-round5/accessory-expansion/models/07-cape.glb');
assert.equal(sha256(model),'e29010956b989a60e196472b2206e6c397b34f12f3b7092d67f53f189c128e21','Frozen cape identity mismatch');
let raw,parts=[];
try {
 raw=await loadGLB(model);parts=bakeAccessory(raw);
 fs.writeFileSync(path.join(out,'frozen-cape.json'),JSON.stringify({sha256:sha256(model),parts:parts.map(p=>({name:p.name,positions:[...p.geometry.attributes.position.array],indices:[...p.geometry.index.array]}))}));
} finally {
 for(const p of parts)p.geometry.dispose();if(raw)disposeAsset(raw);
}
