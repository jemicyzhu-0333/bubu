import fs from 'node:fs';import assert from 'node:assert/strict';
const base=new URL('../bubu-shared-d2-input-candidate-20261017/research/animation-0.1.0/runtime-facepath05/',import.meta.url);
const {prepareD2FacePack}=await import(new URL('src/pack-loader.mjs',base));
const {localPackReader}=await import(new URL('tools/read-local-pack.mjs',base));
const {ActorPool}=await import(new URL('src/actor-pool.mjs',base));
const {ShaderLib,ShaderChunk}=await import(new URL('../node_modules/three/build/three.module.js',base));
const pack=await prepareD2FacePack(localPackReader(new URL('fixtures/face-d2/',base).pathname));
const pool=new ActorPool({limits:{deformedVertices:1568280}}),a=await pool.create(pack),b=await pool.create(pack);
const ma=a.root.getObjectByName('A_mouth_ring'),mb=b.root.getObjectByName('A_mouth_ring');
const patch=m=>{const s={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};m.onBeforeCompile(s);return s;};
const sa=patch(ma.material),sb=patch(mb.material),ga=sa.uniforms.bubuD2CavityGate,gb=sb.uniforms.bubuD2CavityGate;
assert.notEqual(ma.material,mb.material);assert.notEqual(ga,gb);assert.equal(ma.geometry,mb.geometry);assert.equal(ma.material.customProgramCacheKey(),mb.material.customProgramCacheKey());
const mask=ma.geometry.getAttribute('bubuD2CavityMask');assert.equal(mask.count,704);const maskBefore=Array.from(mask.array);const eye=a.root.getObjectByName('A_eye_L').material;
assert.notEqual(ma.material,eye);assert.equal(gb.value,0);
const expected=(id,v)=>{if(id!=='N3')return 0;const t=Math.max(0,Math.min(1,(v-.375)/.625));return t*t*(3-2*t);};
let t=0,samples=0,materialDispose=0,geometryDispose=0;ma.material.addEventListener('dispose',()=>materialDispose++);ma.geometry.addEventListener('dispose',()=>geometryDispose++);
try{
 for(const id of pack.profile.paths.map(x=>x.id))for(const amount of [0,.25,.375,.376,.5,.875,1]){a.enqueue({type:'face',time:t,id,amount,fadeOutSec:.1,fadeInSec:.1});for(const dt of [0,.025,.075,.15,.3]){a.advance(t+dt);a.assertCurrent();assert.equal(ga.value,expected(a.state.path,a.state.value));assert.equal(gb.value,0);samples++;}t+=.4;}
 assert.deepEqual(Array.from(mask.array),maskBefore);assert(sa.fragmentShader.includes('diffuseColor.rgb += vec3('));assert(!sa.fragmentShader.includes('NaN'));
 const expand=s=>s.replace(/#include <(\w+)>/g,(_,name)=>{assert.equal(typeof ShaderChunk[name],'string',name);return expand(ShaderChunk[name]);});
 fs.writeFileSync(new URL('patched-standard.vert',import.meta.url),expand(sa.vertexShader));fs.writeFileSync(new URL('patched-standard.frag',import.meta.url),expand(sa.fragmentShader));
 a.dispose();assert.equal(materialDispose,1);assert.equal(geometryDispose,0);b.assertCurrent();assert.equal(pool.stats.cache.live,1);b.dispose();assert.equal(geometryDispose,1);assert.equal(pool.stats.decodedArrayBytes,0);
 const denied=new ActorPool({limits:{decodedArrayBytes:40685899}});await assert.rejects(denied.create(pack),{code:'GLOBAL_BUDGET'});assert.equal(denied.stats.cache.loads,0);denied.dispose();
 const policy={format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:pack.profile.sourceSha256,profileSha256:pack.manifest.assets.find(x=>x.kind==='profile').sha256,candidates:[{key:'n3',faceId:'N3',amount:1,enterSec:.1,exitSec:.1,holdSec:1,gapSec:.1}]};
 const d=await pool.createDirected(pack,policy);const shader=patch(d.root.getObjectByName('A_mouth_ring').material);d.submit({time:0,events:[{type:'request',owner:'test',requestId:'one',lifetime:1,candidate:'n3',priority:'interaction',holdMode:'keep'}]});d.advance(.1);assert.equal(shader.uniforms.bubuD2CavityGate.value,1);d.retire();assert.equal(shader.uniforms.bubuD2CavityGate.value,0);d.assertCurrent();d.dispose();assert.equal(pool.stats.cache.live,0);
 const out={pass:true,samples,independentUniforms:true,allNonN3Zero:true,retireBasisGateZero:true,sharedGeometryDisposedOnce:true,privateMaterialDisposedOnce:true,budget:pack.budget.decodedArrayReservation,shader:'patched pinned standard and expanded chunks; NOT compiler/GPU validation'};
 fs.writeFileSync(new URL('runtime-probe.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(out);
}finally{a.dispose();b.dispose();pool.dispose();}
