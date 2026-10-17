import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const base=new URL('../bubu-runtime-full18-candidate-20261017/research/animation-0.1.0/runtime-facepath05/',import.meta.url);
const {prepareFullFacePack}=await import(new URL('src/pack-loader.mjs',base));
const {ActorPool}=await import(new URL('src/actor-pool.mjs',base));
const {localPackReader}=await import(new URL('tools/read-local-pack.mjs',base));
const {bindFacePaths}=await import(new URL('src/face-binding.mjs',base));
const {geometryBackingBytes}=await import(new URL('src/geometry-accounting.mjs',base));
const fixtures=JSON.parse(fs.readFileSync(new URL('../bubu-3d-a-expression-library-v1-20261017/mapping-fixtures.json',import.meta.url)));
const t0=performance.now(),pack=await prepareFullFacePack(localPackReader(new URL('fixtures/face-full18/',base).pathname)),t1=performance.now();
const pool=new ActorPool(),actor=await pool.create(pack),t2=performance.now(),binding=bindFacePaths(actor.root,pack.profile);
let checks=0;
try {
 for(const f of fixtures.fixtures){binding.apply(f.state,f.intensity);for(const name of fixtures.faceRoster){const mesh=actor.root.getObjectByName(name);for(const [target,index]of Object.entries(mesh.morphTargetDictionary)){assert.equal(mesh.morphTargetInfluences[index],f.nonzero[target]??0);checks++;}}}
 binding.apply(null,0);actor.assertCurrent();
 const stats=pool.stats;await assert.rejects(pool.create(pack),{code:'GLOBAL_BUDGET'});assert.deepEqual(pool.stats,stats);
 const out={scope:'CPU source-mapper parity only; no GPU or visual transitions',samples:fixtures.fixtures.length,scalarChecks:checks,geometryBackingBytes:geometryBackingBytes(actor.root),prepareMs:t1-t0,coldCreateMs:t2-t1,budget:pack.budget,activeStats:stats};
 actor.dispose();for(const k of ['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','active','pending'])assert.equal(pool.stats[k],0,k);out.disposedStats=pool.stats;
 fs.writeFileSync(new URL('binding-probe.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
}finally{binding.dispose();actor.dispose();pool.dispose();}
