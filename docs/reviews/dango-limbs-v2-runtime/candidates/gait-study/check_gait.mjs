import fs from 'node:fs';
import {sampleGait} from './gait-helper-proposal.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./gait-source.json',import.meta.url)));
const results={};
for(const mode of ['run','walk']){
 const samples=Array.from({length:10001},(_,i)=>sampleGait(i/10000,data.frames,{mode}));
 const supportErrors=samples.flatMap(s=>s.feet.filter(f=>f.support).map(f=>Math.hypot(f.soleWorld[0]-f.contactTarget[0],f.soleWorld[1]-f.contactTarget[1])));
 const maxAnkleJump=Math.max(...samples.slice(1).flatMap((s,i)=>s.feet.map((f,k)=>Math.hypot(f.rootWorld[0]-samples[i].feet[k].rootWorld[0],f.rootWorld[1]-samples[i].feet[k].rootWorld[1]))));
 const frames=[...new Set(samples.flatMap(s=>s.feet.map(f=>f.frame)))];
 results[mode]={samples:samples.length,supportCounts:[...new Set(samples.map(s=>s.supportCount))],flightSamples:samples.filter(s=>s.flight).length,maxSupportContactError:Math.max(...supportErrors),maxAnkleJumpAtDiscreteFrameSwitch:maxAnkleJump,framesUsed:frames,minimumQuantizedClearance:Math.min(...samples.flatMap(s=>s.feet.map(f=>f.clearance))),status:'geometry proposal only; frame-switch jumps reported, not accepted'};
}
fs.writeFileSync(new URL('./gait-helper-check.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
