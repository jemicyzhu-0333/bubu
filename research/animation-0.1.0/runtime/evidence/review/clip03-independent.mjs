import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateClipLibrary} from '../../src/clip-contract.mjs';import {QuaternionLane} from '../../src/timeline.mjs';
const base=new URL('../../fixtures/authored/',import.meta.url),profile=JSON.parse(fs.readFileSync(new URL('character-profile.json',base))),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',base)));
const q=a=>[0,0,Math.sin(a/2),Math.cos(a/2)],newLane=()=>new QuaternionLane({}, {clone(){return this}}),near=(a,b)=>a.forEach((x,i)=>assert(Math.abs(x-b[i])<2e-12,`${x} != ${b[i]}`));
const fixture=()=>({format:'bubu-clips',version:'0.1.0',id:'independent',clips:[{id:'clip',durationSec:.02,endBehavior:'hold',tracks:[{target:'joint:arm.left',interpolation:'STEP',keys:[0,.01,.015,1].map(at=>({at,rotation:q(.1)}))}]}]});
const mutations={duplicate:x=>x.clips[0].tracks[0].keys[2].at=.01,descending:x=>x.clips[0].tracks[0].keys[2].at=.005,nonfinite:x=>x.clips[0].tracks[0].keys[2].at=Infinity,nearzero:x=>x.clips[0].tracks[0].keys[0].rotation=[0,0,0,1e-100],nanquat:x=>x.clips[0].tracks[0].keys[0].rotation=[0,NaN,0,1],far_from_unit:x=>x.clips[0].tracks[0].keys[0].rotation=[0,0,0,1.01],overcap:x=>x.clips[0].tracks[0].keys[0].rotation=q(.6),duplicate_target:x=>x.clips[0].tracks.push(structuredClone(x.clips[0].tracks[0])),unknown_target:x=>x.clips[0].tracks[0].target='root:translation',below_min_gap:x=>x.clips[0].tracks[0].keys[2].at=.01499999};
const results=[];for(const[name,mutate]of Object.entries(mutations)){const x=fixture();x.clips[0].tracks[0].keys[2].at=.02;mutate(x);assert.throws(()=>validateClipLibrary(x,profile,manifest.equipment));results.push(name+' rejected')}
let threshold;try{validateClipLibrary(fixture(),profile,manifest.equipment);threshold='accepted'}catch(e){threshold=e.code}
// Independent axis-angle oracle, including decimal keys and very large clock origins.
let samples=0;for(const interpolation of ['STEP','LINEAR'])for(const eventTime of [0,.12345,1e6,999999980]){
 const lane=newLane(),duration=.71,entry=.037,keys=[{at:0,rotation:q(.04)},{at:.13,rotation:q(-.12).map(x=>-x)},{at:.57,rotation:q(.18)},{at:1,rotation:q(-.06)}];
 lane.planClip(eventTime,{interpolation,keys},duration,entry);const start=eventTime+entry;const angles=[.04,-.12,.18,-.06];
 const ts=[eventTime,eventTime+entry/2,start,...keys.slice(1).flatMap(k=>{const at=start+k.at*duration;return[at-1e-6,at,at+1e-6]}),start+duration+100].sort((a,b)=>a-b);
 for(const t of ts){lane.sample(t);let a;if(t<start)a=.04*(t-eventTime)/(start-eventTime);else{let i=0;while(i+1<keys.length&&t>=start+keys[i+1].at*duration)i++;a=angles[i];if(interpolation==='LINEAR'&&i+1<keys.length){const lo=start+keys[i].at*duration,hi=start+keys[i+1].at*duration;a+=(angles[i+1]-a)*(t-lo)/(hi-lo)}}near([...lane.value],q(a));samples++}
 assert.equal(lane.clipTrack,null);assert.equal(lane.active(start+duration+100),false);near([...lane.value],q(-.06));
}
console.log(JSON.stringify({malformedChecks:results,exactMinimumGap:threshold,independentAxisAngleSamples:samples,clockOrigins:[0,.12345,1e6,999999980]},null,2));
