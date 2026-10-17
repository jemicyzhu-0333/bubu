import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {ExpressionDirector,SOURCE_SHA256,PROFILE_SHA256} from '../bubu-expression-director-p0-20261017/src/director.mjs';
import {prepareFacePack} from '../bubu-runtime-0.1.0-facepath06-20261017/src/pack-loader.mjs';
import {ActorPool} from '../bubu-runtime-0.1.0-facepath06-20261017/src/actor-pool.mjs';
import {bindFacePaths} from '../bubu-runtime-0.1.0-facepath06-20261017/src/face-binding.mjs';
import {localPackReader} from '../bubu-runtime-0.1.0-facepath06-20261017/tools/read-local-pack.mjs';
const pack=await prepareFacePack(localPackReader(new URL('../bubu-runtime-0.1.0-facepath06-20261017/fixtures/face-slice7/',import.meta.url).pathname));
const p={format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:SOURCE_SHA256,profileSha256:PROFILE_SHA256,candidates:pack.profile.paths.map((path,i)=>({key:'c'+i,faceId:path.id,amount:1,enterSec:.13,exitSec:.11,holdSec:.17,gapSec:.09}))};
const ev=(i)=>({type:'request',owner:'x',requestId:'r'+i,lifetime:i+1,priority:'interaction',candidate:'c'+(i%7),holdMode:'restart'});
let results=[];
for(const n of [1,2,4]){
 const pool=new ActorPool({limits:{vertices:250000,deformedVertices:1500000}}), actors=await Promise.all(Array.from({length:n},()=>pool.create(pack)));
 const bindings=actors.map(a=>bindFacePaths(a.root,pack.profile));
 const ds=bindings.map(b=>new ExpressionDirector(p,(id,v)=>b.apply(id,v)));
 // Test-only adapter; the actor's own timeline is NEVER advanced. Production API lacks this handover.
 for(let i=0;i<128;i++)for(const d of ds)d.submit({time:i*.037,events:[ev(i)]});
 let us=[];for(let k=0;k<600;k++){let t=k/120;let s=performance.now();for(const d of ds)d.advance(t);us.push((performance.now()-s)*1000);for(let j=0;j<n;j++){const st=ds[j].state;bindings[j].assertCurrent(st.path,st.amount);}}
 for(let j=0;j<n;j++){ds[j].advance(10);bindings[j].assertCurrent(null,0);assert.equal(ds[j].state.phase,'idle');}
 us.sort((a,b)=>a-b);bindings.forEach(b=>b.dispose());pool.dispose();assert.equal(pool.stats.cache.live,0);assert.equal(pool.stats.actors,0);
 results.push({actors:n,ticks:600,events:128,p50us:us[300],p95us:us[570],maxUs:us.at(-1),endBasis:true,countersZero:true});
}
// Callback exception robustness is deliberately excluded today; demonstrate the integration hazard.
let fail=true;const d=new ExpressionDirector(p,()=>{},r=>{if(fail&&r.type==='request')throw Error('observer failure')});d.submit({time:0,events:[ev(0)]});let thrown;try{d.advance(1)}catch(e){thrown=e.message}fail=false;let recovery;try{d.advance(1);recovery=d.state}catch(e){recovery={error:e.message}};
const report={scope:'Independent synthetic adapter to real admitted 7-slot eight-layer clones. CPU only; not production integration or visual/GPU pass; assertion time excluded. One sweep, no stable-device performance claim.',node:process.version,results,observerException:{thrown,recovery}};
writeFileSync(new URL('probe.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
