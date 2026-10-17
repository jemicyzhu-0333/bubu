import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import {ExpressionDirector,SOURCE_SHA256,PROFILE_SHA256} from '../src/director.mjs';
const p={format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:SOURCE_SHA256,profileSha256:PROFILE_SHA256,candidates:[{key:'a',faceId:'R0',amount:1,enterSec:.25,exitSec:.25,holdSec:.5,gapSec:.25}]};
const ev=(i)=>({type:'request',owner:'x',requestId:'r'+i,lifetime:i+1,priority:'interaction',candidate:'a',holdMode:'restart'});
const ctor=()=>new ExpressionDirector(p,()=>{});
function sample(name,n,prepare,run){for(let i=0;i<200;i++)run(prepare());const us=[];for(let i=0;i<n;i++){const d=prepare();const t=performance.now();run(d);us.push((performance.now()-t)*1000);}us.sort((a,b)=>a-b);return{name,n,p50us:us[Math.floor(n*.5)],p95us:us[Math.floor(n*.95)],maxUs:us.at(-1)};}
const measurements=[
 sample('one complete lifecycle advance (5 boundaries)',10000,()=>{const d=ctor();d.submit({time:0,events:[ev(0)]});return d;},d=>d.advance(2)),
 sample('steady hold sample (no deadlines crossed)',10000,()=>{const d=ctor();d.submit({time:0,events:[ev(0)]});d.advance(.25);return d;},d=>d.advance(.3)),
 sample('128 queued timestamp batches (full drain)',1000,()=>{const d=ctor();for(let i=0;i<128;i++)d.submit({time:i/1000,events:[ev(i)]});return d;},d=>{d.advance(3);while(!d.progress.complete)d.advance(3);}),
 sample('128 queued batches budget=1 (one boundary only)',1000,()=>{const d=ctor();for(let i=0;i<128;i++)d.submit({time:i/1000,events:[ev(i)]});return d;},d=>d.advance(3,1))
];
const report={node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,scope:'Local wall-clock scalar/director microbenchmark; setup excluded; noop apply; no GPU, real binding, rendering, allocations or hard realtime claim. Timer quantization, JIT and GC affect results.',measurements};
writeFileSync(new URL('../evidence/benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
