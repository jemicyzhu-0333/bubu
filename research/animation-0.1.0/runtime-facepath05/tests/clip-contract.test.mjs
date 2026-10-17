import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClipLibrary} from '../src/clip-contract.mjs';
import {validateManifest, LIMITS} from '../src/contracts.mjs';
import {preparePack,sha256} from '../src/pack-loader.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';
import {Timeline,FaceLane,QuaternionLane} from '../src/timeline.mjs';
import {Object3D} from 'three';

const profile={joints:[{id:'arm',capRadians:.2}],capabilities:['skeletal-delta']};
const q=angle=>[0,0,Math.sin(angle/2),Math.cos(angle/2)];
const make=()=>({format:'bubu-clips',version:'0.1.0',id:'test',clips:[{id:'one',durationSec:1,endBehavior:'hold',tracks:[{target:'joint:arm',interpolation:'LINEAR',keys:[{at:0,rotation:q(0)},{at:1,rotation:q(.1)}]}]}]});
const run=lib=>validateClipLibrary(lib,profile,[{id:'hat'}]);
const bad=(change,code)=>{const lib=make();change(lib,lib.clips[0],lib.clips[0].tracks[0]);assert.throws(()=>run(lib),{code});};

test('clip contract rejects unknown fields, unsupported versions/channels/curves and ownership ambiguity',()=>{
  for(const mutate of [l=>l.extra=true,(l,c)=>c.speed=2,(l,c,t)=>t.curve='ease',(l,c,t)=>t.keys[0].extra=true])bad(mutate,'UNKNOWN_FIELD');
  bad(l=>l.version='1.0.0','VERSION');bad((l,c)=>c.endBehavior='loop','UNSUPPORTED');
  bad((l,c,t)=>t.interpolation='CUBICSPLINE','UNSUPPORTED');bad((l,c,t)=>t.target='expression:happy','REFERENCE');
  bad((l,c,t)=>t.target='joint:missing','REFERENCE');bad((l,c,t)=>c.tracks.push(structuredClone(t)),'DUPLICATE');
  bad((l,c)=>l.clips.push(structuredClone(c)),'DUPLICATE');
  assert.throws(()=>validateClipLibrary(make(),{...profile,capabilities:[]},[]),{code:'UNBOUND_CAPABILITY'});
});

test('clip contract rejects empty, unordered, duplicate, missing endpoints and invalid duration keys',()=>{
  bad(l=>l.clips=[],'MISSING');bad((l,c)=>c.tracks=[],'MISSING');bad((l,c,t)=>t.keys=[t.keys[0]],'MISSING');
  for(const duration of [0,.019999,10.001,NaN,Infinity])bad((l,c)=>c.durationSec=duration,'RANGE');
  bad((l,c,t)=>t.keys[0].at=.01,'KEY_TIME');bad((l,c,t)=>t.keys[1].at=.99,'KEY_TIME');
  bad((l,c,t)=>t.keys.splice(1,0,{at:0,rotation:q(0)}),'KEY_TIME');
  bad((l,c,t)=>t.keys.splice(1,0,{at:.8,rotation:q(0)},{at:.4,rotation:q(0)}),'KEY_TIME');
  for(const at of [NaN,Infinity,-.1,1.1])bad((l,c,t)=>t.keys[0].at=at,'RANGE');
});

test('minimum key gap tolerates only arithmetic roundoff at its mathematical threshold',()=>{
  for(const phases of [[0,.01,.015,1],[0,.975,.98,1]]){
    const lib=make();lib.clips[0].durationSec=.02;
    lib.clips[0].tracks[0].keys=phases.map(at=>({at,rotation:q(0)}));
    assert.doesNotThrow(()=>run(lib));
  }
  bad((l,c,t)=>{c.durationSec=.02;t.keys=[0,.01,.015-1e-12,1].map(at=>({at,rotation:q(0)}));},'KEY_TIME');
});

test('quaternion validity and caps are checked after normalization with sign-equivalent endpoints',()=>{
  for(const value of [[0,0,0,0],[1e-20,0,0,0],[0,0,0,.5]])bad((l,c,t)=>t.keys[0].rotation=value,'QUATERNION');
  for(const value of [[NaN,0,0,1],[Infinity,0,0,1],[0,0,0,2]])bad((l,c,t)=>t.keys[0].rotation=value,'RANGE');
  bad((l,c,t)=>t.keys[0].rotation=[0,0,1],'QUATERNION');
  for(const scale of [1-1e-6+1e-12,1+1e-6-1e-12]){
    const lib=make();lib.clips[0].tracks[0].keys[1].rotation=q(.2).map(x=>-x*scale);assert.doesNotThrow(()=>run(lib));
  }
  for(const scale of [1-1e-6-1e-12,1+1e-6+1e-12])bad((l,c,t)=>t.keys[1].rotation=q(.1).map(x=>x*scale),'QUATERNION');
  bad((l,c,t)=>t.keys[1].rotation=q(.20001).map(x=>x*(1+5e-7)),'JOINT_LIMIT');
  const accessory=make();accessory.clips[0].tracks[0].target='accessory:hat';accessory.clips[0].tracks[0].keys[1].rotation=q(.5);run(accessory);
  accessory.clips[0].tracks[0].keys[1].rotation=q(.50001);assert.throws(()=>run(accessory),{code:'JOINT_LIMIT'});
});

test('per-library, per-track and aggregate key budgets reject before runtime activation',()=>{
  bad((l,c)=>l.clips=Array.from({length:LIMITS.clips+1},(_,i)=>({...c,id:'c'+i})),'LIMIT');
  bad((l,c,t)=>c.tracks=Array.from({length:LIMITS.clipTracks+1},()=>t),'LIMIT');
  bad((l,c,t)=>t.keys=Array.from({length:LIMITS.keysPerTrack+1},(_,i)=>({at:i/LIMITS.keysPerTrack,rotation:q(0)})),'LIMIT');
  const lib=make(),joints=Array.from({length:17},(_,i)=>({id:'j'+i,capRadians:.2}));
  lib.clips[0].tracks=joints.map(j=>({target:'joint:'+j.id,interpolation:'STEP',keys:Array.from({length:128},(_,i)=>({at:i/127,rotation:q(0)}))}));
  assert.throws(()=>validateClipLibrary(lib,{joints,capabilities:['skeletal-delta']},[]),{code:'LIMIT'});
  lib.clips[0].tracks.pop();assert.equal(validateClipLibrary(lib,{joints,capabilities:['skeletal-delta']},[]).clipKeyScalars,10240);
});

test('manifest requires referenced and declared authored capability, bounds bytes and rejects extra library',async()=>{
  const read=localPackReader(new URL('../fixtures/authored/',import.meta.url).pathname);
  const original=JSON.parse(new TextDecoder().decode(await read('manifest.json',65536)));
  for(const [change,code] of [
    [m=>m.requiredCapabilities=m.requiredCapabilities.filter(c=>c!=='authored-quaternion-clips'),'UNBOUND_CAPABILITY'],
    [m=>delete m.clips,'REFERENCE'],[m=>m.clips='missing','REFERENCE'],
    [m=>m.assets.find(a=>a.kind==='clips').bytes=131073,'RANGE']
  ]){const m=structuredClone(original);change(m);assert.throws(()=>validateManifest(m),{code});}
  const pack=await preparePack(read);assert(Object.isFrozen(pack.clips.clips[0].tracks[0].keys[0].rotation));
  assert.throws(()=>pack.clips.clips[0].tracks[0].keys[0].rotation[0]=1,TypeError);
  const libraryAsset=pack.manifest.assets.find(a=>a.id===pack.manifest.clips);
  const bytes=pack.data.get(libraryAsset.id);bytes.fill(0);assert.equal(await sha256(pack.data.get(libraryAsset.id)),libraryAsset.sha256);
});

test('playClip rejects missing entry, unknown clip, past time, clock overflow, unknown fields and queue overflow',()=>{
  const node=new Object3D(),lane=new QuaternionLane(node,node.quaternion);
  const timeline=new Timeline(new Map([['joint:arm',lane]]),new FaceLane(),[],()=>{},make().clips);
  const valid={time:0,type:'playClip',clip:'one',entrySec:.02};
  for(const [e,code] of [
    [{...valid,entrySec:undefined},'RANGE'],[{...valid,entrySec:0},'RANGE'],[{...valid,entrySec:1.01},'RANGE'],
    [{...valid,clip:'unknown'},'REFERENCE'],[{...valid,time:-1},'RANGE'],[{...valid,time:1e9},'RANGE'],
    [{...valid,curve:'ease'},'EVENT']
  ])assert.throws(()=>timeline.enqueue(e),{code});
  timeline.advance(.5);assert.throws(()=>timeline.enqueue(valid),{code:'RANGE'});
  for(let i=0;i<128;i++)timeline.enqueue({...valid,time:1});
  assert.throws(()=>timeline.enqueue({...valid,time:1}),{code:'LIMIT'});
});

test('absolute STEP boundaries remain right-continuous at nonbinary phases and large canonical times',()=>{
  const lib=make(),track=lib.clips[0].tracks[0];lib.clips[0].durationSec=.02;
  track.interpolation='STEP';track.keys=[0,.01,.015,1].map((at,i)=>({at,rotation:q(i*.03)}));run(lib);
  for(const start of [.123,999999998]){
    const node=new Object3D(),lane=new QuaternionLane(node,node.quaternion),t=new Timeline(new Map([['joint:arm',lane]]),new FaceLane(),[],()=>{},lib.clips);
    t.enqueue({time:start,type:'playClip',clip:'one',entrySec:.02});
    const edge=(start+.02)+.015*.02;t.advance(edge-1e-6);
    assert(Math.abs(lane.value[2]-q(.03)[2])<1e-14);t.advance(edge);
    assert(Math.abs(lane.value[2]-q(.06)[2])<1e-14);
  }
});

test('admitted near-unit target primitive is normalized before a subsequent infinitesimal clip entry',async()=>{
  const {validateMotion}=await import('../src/contracts.mjs');
  const raw=q(.16).map(v=>v*1.000005);
  const motion={format:'bubu-motion',version:'0.1.0',id:'targets',segments:[{id:'near-unit',durationSec:.02,curve:'smoothstep',joints:{arm:raw},accessories:{}}]};
  validateMotion(motion,{...profile,expressions:{paths:[]}},[]);
  const node=new Object3D(),lane=new QuaternionLane(node,node.quaternion),t=new Timeline(new Map([['joint:arm',lane]]),new FaceLane(),motion.segments,()=>{},make().clips);
  t.enqueue({time:0,type:'play',segment:'near-unit'});t.advance(.02);
  assert(Math.abs(Math.hypot(...lane.value)-1)<1e-15);
  const before=[...lane.value];t.enqueue({time:.02,type:'playClip',clip:'one',entrySec:.02});t.advance(.02);assert.deepEqual([...lane.value],before);
  t.advance(.02+1e-12);assert(Math.hypot(...lane.value.map((v,i)=>v-before[i]))<1e-11);
  const oversized=structuredClone(motion);oversized.segments[0].joints.arm=q(.20002).map(v=>v*1.000005);
  assert.throws(()=>validateMotion(oversized,{...profile,expressions:{paths:[]}},[]),{code:'JOINT_LIMIT'});
});

test('target play and playClip have equal priority with the last enqueue owning common channels',()=>{
  const motion=[{id:'target',durationSec:.02,joints:{arm:q(-.1)},accessories:{}}];
  for(const clipLast of [false,true]){
    const node=new Object3D(),lane=new QuaternionLane(node,node.quaternion),t=new Timeline(new Map([['joint:arm',lane]]),new FaceLane(),motion,()=>{},make().clips);
    const events=[{time:0,type:'play',segment:'target'},{time:0,type:'playClip',clip:'one',entrySec:.02}];
    if(!clipLast)events.reverse();for(const e of events)t.enqueue(e);t.advance(.02);
    assert(Math.abs(lane.value[2]-q(clipLast?0:-.1)[2])<1e-14);
  }
});
