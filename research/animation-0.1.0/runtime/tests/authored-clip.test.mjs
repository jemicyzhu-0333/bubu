import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorPool} from '../src/actor-pool.mjs';
import {preparePack,preparedAdmission,sha256} from '../src/pack-loader.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';

const read=localPackReader(new URL('../fixtures/authored/',import.meta.url).pathname);
const pack=()=>preparePack(read);

const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const fixture=()=>read('authored-clips.json',131072).then(decode);
const clipEvent=(time=0,entrySec=.125,clip='asymmetric-holds')=>({time,type:'playClip',clip,entrySec});
const q=(axis,angle)=>{
  const value=[0,0,0,Math.cos(angle/2)];value[axis]=Math.sin(angle/2);return value;
};
const near=(actual,expected,message,tolerance=2e-12)=>{
  assert.equal(actual.length,expected.length,message);
  for(let i=0;i<actual.length;i++)assert(Math.abs(actual[i]-expected[i])<=tolerance,
    `${message}, component ${i}: ${actual[i]} vs ${expected[i]}`);
};
const lane=(actor,id)=>Array.from(actor.lanes.get(id).value);
const assertAngle=(actor,id,axis,angle,message=id)=>near(lane(actor,id),q(axis,angle),message);
const snapshot=actor=>({lanes:[...actor.lanes].map(([id,l])=>[id,Array.from(l.value)]),face:[actor.face.path,actor.face.value]});
const world=actor=>{
  actor.root.updateMatrixWorld(true);
  const values=[];actor.root.traverse(node=>values.push(...node.matrixWorld.elements));return values;
};
async function actorFor(t,prepared=undefined,options={}) {
  const pool=new ActorPool(options);
  t.after(()=>pool.dispose());
  return {actor:await pool.create(prepared??await pack()),pool};
}
// Replacement bytes and manifest are rehashed before preparation; immutable
// prepared metadata is never modified to manufacture a sampling test case.
async function packWithLibrary(change) {
  const library=await fixture();change(library);
  const bytes=encode(library),hash=await sha256(bytes);
  return preparePack(async(name,max,signal)=>{
    if(name==='authored-clips.json')return bytes;
    const content=await read(name,max,signal);
    if(name!=='manifest.json')return content;
    const manifest=decode(content),asset=manifest.assets.find(a=>a.id===manifest.clips);
    asset.bytes=bytes.length;asset.sha256=hash;return encode(manifest);
  });
}

test('authored fixture is readable independent key data with unequal holds and unchanged mechanical sources',async()=>{
  const library=await fixture(),clip=library.clips[0];
  assert.equal(library.format,'bubu-clips');assert.equal(clip.id,'asymmetric-holds');
  assert.equal(clip.durationSec,1);assert.equal(clip.endBehavior,'hold');
  assert.deepEqual(clip.tracks.map(t=>t.target),['joint:arm.left','joint:arm.right','accessory:testCap']);
  assert.deepEqual(clip.tracks.map(t=>t.interpolation),['LINEAR','STEP','LINEAR']);
  assert.deepEqual(clip.tracks.map(t=>t.keys.map(k=>k.at)),[
    [0,.125,.375,.625,1],[0,.25,.6875,1],[0,.1875,.5,.875,1]
  ]);
  const [left,,cap]=clip.tracks;
  assert.deepEqual(left.keys[0].rotation,left.keys[1].rotation);
  assert.deepEqual(left.keys[2].rotation,left.keys[3].rotation);
  assert.deepEqual(cap.keys[0].rotation,cap.keys[1].rotation);
  assert.deepEqual(cap.keys[2].rotation,cap.keys[3].rotation);
  assert.notEqual(left.keys[1].at-left.keys[0].at,cap.keys[1].at-cap.keys[0].at);
  assert.notEqual(left.keys[3].at-left.keys[2].at,cap.keys[3].at-cap.keys[2].at);
  const profile=decode(await read('character-profile.json',10000));
  for(const track of clip.tracks)for(const key of track.keys) {
    assert(Math.abs(Math.hypot(...key.rotation)-1)<=1e-15);
    const capRadians=track.target.startsWith('joint:')?profile.joints.find(j=>`joint:${j.id}`===track.target).capRadians:.5;
    assert(2*Math.acos(Math.abs(key.rotation[3]))<capRadians);
  }
  const originalHashes={
    'mechanical-character.glb':'a0a6d62bd3edf28885ce51ca6d0353ed4ba6220ab99e7a23b3855b63ad04f446',
    'mechanical-accessory.glb':'f1961dbfa8838e16b31a9e84a2d43ca2728c6ce66fc15150aaae4941569ac9a7',
    'character-profile.json':'a82bae6856c44909b165debe3eaac104423ed4dd7c6cd15abeba1826f109bcee',
    'motion.json':'804ddfc359a249ded96ab91c48bb2a769024d121b4d777c1015053f9a584458e'
  };
  for(const [path,hash] of Object.entries(originalHashes))assert.equal(await sha256(await read(path,65536)),hash,path);
  const manifest=decode(await read('manifest.json',65536));
  assert(manifest.requiredCapabilities.includes('authored-quaternion-clips'));
  const asset=manifest.assets.find(a=>a.id===manifest.clips),bytes=await read(asset.path,131072);
  assert.equal(asset.kind,'clips');assert.equal(asset.bytes,bytes.length);assert.equal(asset.sha256,await sha256(bytes));
});

test('entry bridge is linear slerp, delays authored phase, and does not animate unowned lanes',async t=>{
  const {actor}=await actorFor(t);actor.enqueue(clipEvent(0,.125));
  actor.advance(.03125);
  assertAngle(actor,'joint:arm.left',2,.01,'quarter entry is linear, not smoothstep');
  assertAngle(actor,'joint:arm.right',0,-.015);
  assertAngle(actor,'accessory:testCap',1,.025);
  actor.advance(.125);
  assertAngle(actor,'joint:arm.left',2,.04);assertAngle(actor,'joint:arm.right',0,-.06);assertAngle(actor,'accessory:testCap',1,.1);
  actor.advance(.25); // Authored phase .125, still inside each initial hold.
  assertAngle(actor,'joint:arm.left',2,.04);assertAngle(actor,'joint:arm.right',0,-.06);assertAngle(actor,'accessory:testCap',1,.1);
  assert.deepEqual(lane(actor,'joint:foot.left'),[0,0,0,1]);
  assert.deepEqual(lane(actor,'joint:foot.right'),[0,0,0,1]);assert.deepEqual([actor.face.path,actor.face.value],[null,0]);
});

test('independent tracks match hand-calculated linear and unequal-hold samples',async t=>{
  const {actor}=await actorFor(t);actor.enqueue(clipEvent());
  actor.advance(.4375); // Authored phase .3125.
  assertAngle(actor,'joint:arm.left',2,.145); // .04 + (.18-.04) * .75
  assertAngle(actor,'joint:arm.right',0,.12);
  assertAngle(actor,'accessory:testCap',1,-.06); // .1 + (-.3-.1) * .4
  actor.advance(.6875); // Authored phase .5625, both LINEAR lanes are holding.
  assertAngle(actor,'joint:arm.left',2,.18);assertAngle(actor,'joint:arm.right',0,.12);assertAngle(actor,'accessory:testCap',1,-.3);
  actor.advance(.875); // Authored phase .75: left moves, cap still holds.
  assertAngle(actor,'joint:arm.left',2,.18-.26/3);assertAngle(actor,'joint:arm.right',0,-.04);assertAngle(actor,'accessory:testCap',1,-.3);
});

test('STEP keys are right-continuous at exact authored boundaries including final key',async t=>{
  const {actor}=await actorFor(t);actor.enqueue(clipEvent());
  for(const [boundary,before,at] of [[.375,-.06,.12],[.8125,.12,-.04],[1.125,-.04,.08]]) {
    actor.advance(boundary-1e-9);assertAngle(actor,'joint:arm.right',0,before,'before STEP boundary');
    actor.advance(boundary);assertAngle(actor,'joint:arm.right',0,at,'exact STEP boundary');
    actor.advance(boundary+1e-9);assertAngle(actor,'joint:arm.right',0,at,'after STEP boundary');
  }
});

test('shortest-arc LINEAR slerp admits sign-equivalent keys without a long rotation or sign flip',async t=>{
  const prepared=await packWithLibrary(library=>{
    library.clips=[{id:'negative-equivalent',durationSec:1,endBehavior:'hold',tracks:[{
      target:'joint:arm.left',interpolation:'LINEAR',keys:[
        {at:0,rotation:q(2,.16)},{at:.5,rotation:q(2,.16).map(x=>-x)},
        {at:1,rotation:q(2,-.12).map(x=>-x)}
      ]
    }]}];
  });
  const {actor}=await actorFor(t,prepared);actor.enqueue(clipEvent(0,.125,'negative-equivalent'));
  for(const [time,angle] of [[.125,.16],[.375,.16],[.625,.16],[.75,.09],[.875,.02],[1.125,-.12]]) {
    actor.advance(time);assertAngle(actor,'joint:arm.left',2,angle,`negative equivalent at ${time}`);
    assert(lane(actor,'joint:arm.left')[3]>0);
  }
});

test('non-collinear LINEAR rotation uses quaternion slerp rather than component or Euler interpolation',async t=>{
  const angle=.18,a=q(0,angle),b=q(1,angle),dot=a[3]*b[3],theta=Math.acos(dot),u=.25;
  const expected=a.map((x,i)=>(Math.sin((1-u)*theta)*x+Math.sin(u*theta)*b[i])/Math.sin(theta));
  const prepared=await packWithLibrary(library=>{
    library.clips=[{id:'cross-axis',durationSec:1,endBehavior:'hold',tracks:[{
      target:'joint:arm.left',interpolation:'LINEAR',keys:[{at:0,rotation:a},{at:1,rotation:b}]
    }]}];
  });
  const {actor}=await actorFor(t,prepared);actor.enqueue(clipEvent(0,.125,'cross-axis'));
  actor.advance(.375);near(lane(actor,'joint:arm.left'),expected,'quarter spherical cross-axis interpolation');
  assert(Math.abs(Math.hypot(...lane(actor,'joint:arm.left'))-1)<1e-12);
});

test('small-angle LINEAR keys still use phase-linear angular motion and normalize admitted near-unit values',async t=>{
  const prepared=await packWithLibrary(library=>{
    library.clips=[{id:'small-angle',durationSec:1,endBehavior:'hold',tracks:[{
      target:'joint:arm.left',interpolation:'LINEAR',keys:[
        {at:0,rotation:q(2,0).map(x=>-x*(1+2e-7))},
        {at:1,rotation:q(2,.04).map(x=>x*(1-2e-7))}
      ]
    }]}];
  });
  const {actor}=await actorFor(t,prepared);actor.enqueue(clipEvent(0,.125,'small-angle'));
  for(const [time,angle] of [[.125,0],[.375,.01],[.875,.03],[1.125,.04]]) {
    actor.advance(time);assertAngle(actor,'joint:arm.left',2,angle,`small-angle spherical sample at ${time}`);
    assert(Math.abs(Math.hypot(...lane(actor,'joint:arm.left'))-1)<1e-12);
  }
});

test('clip entry interrupts target motion at its actual event-time pose and leaves unowned lanes running',async t=>{
  const {actor}=await actorFor(t);actor.enqueue({time:0,type:'play',segment:'raise'});actor.advance(.083);
  const before=snapshot(actor),beforeWorld=world(actor),from=lane(actor,'joint:arm.left');
  actor.enqueue(clipEvent(.083,.125));actor.advance(.083);
  assert.deepEqual(snapshot(actor),before);assert.deepEqual(world(actor),beforeWorld);
  actor.advance(.11425); // Quarter of bridge, from sampled non-neutral pose.
  const startAngle=2*Math.atan2(from[2],from[3]);
  assertAngle(actor,'joint:arm.left',2,startAngle+(.04-startAngle)*.25);
  const progress=.11425/.4,ease=progress*progress*(3-2*progress);
  assertAngle(actor,'joint:foot.left',2,.16*ease,'unowned foot keeps the old target lane');
  assert(actor.face.value>before.face[1],'unowned expression continues');
});

test('clip-to-clip interruptions are C0 during entry, on a STEP key, and late in authored motion',async t=>{
  for(const interrupt of [.03125,.375,.9375]) {
    const {actor}=await actorFor(t);actor.enqueue(clipEvent());actor.advance(interrupt);
    const before=snapshot(actor),beforeWorld=world(actor);
    actor.enqueue(clipEvent(interrupt,.25));actor.advance(interrupt);
    assert.deepEqual(snapshot(actor),before,`C0 lane state at ${interrupt}`);
    assert.deepEqual(world(actor),beforeWorld,`C0 world matrices at ${interrupt}`);
    actor.advance(interrupt+.25);
    assertAngle(actor,'joint:arm.left',2,.04);assertAngle(actor,'joint:arm.right',0,-.06);assertAngle(actor,'accessory:testCap',1,.1);
  }
});

test('existing target-segment primitive can interrupt authored motion without resetting the pose',async t=>{
  const {actor}=await actorFor(t);actor.enqueue(clipEvent());actor.advance(.4375);
  const before=snapshot(actor),beforeWorld=world(actor);
  actor.enqueue({time:.4375,type:'play',segment:'turn'});actor.advance(.4375);
  assert.deepEqual(snapshot(actor).lanes,before.lanes);assert.equal(actor.face.value,before.face[1]);
  assert.deepEqual(world(actor),beforeWorld);
  actor.advance(.8375);assertAngle(actor,'joint:arm.left',2,-.13);assertAngle(actor,'accessory:testCap',2,-.13);
});

test('same-time plays retain insertion order, and cancel invalidates clips at and after its timestamp',async t=>{
  const prepared=await packWithLibrary(library=>{
    const next=structuredClone(library.clips[0]);next.id='other';
    for(const track of next.tracks)for(const key of track.keys)key.rotation=q(2,.03);
    library.clips.push(next);
  });
  for(const order of [['asymmetric-holds','other'],['other','asymmetric-holds']]) {
    const {actor}=await actorFor(t,prepared);
    for(const id of order)actor.enqueue(clipEvent(0,.125,id));
    actor.advance(.125);
    assertAngle(actor,'joint:arm.left',2,order[1]==='other'?.03:.04,'last inserted play wins owned lane');
  }
  const {actor}=await actorFor(t,prepared);
  actor.enqueue(clipEvent());actor.enqueue(clipEvent(.375));actor.enqueue({time:.375,type:'cancel'});actor.enqueue(clipEvent(.5));
  actor.advance(.375);assertAngle(actor,'joint:arm.right',0,.12,'cancel samples the prior STEP pose before neutral recovery');
  actor.advance(.6);
  for(const [,l] of actor.lanes)near(Array.from(l.value),[0,0,0,1],'cancel neutral');
  assert.equal(actor.nextDeadline(),Infinity);assert.equal(actor.isAnimating(),false);
});

test('24/30/60/120/144 Hz and direct large jumps give the same canonical clip and interruption samples',async t=>{
  const prepared=await pack(),samples=[];
  const goals=[.03125,.125,.374999,.375,.4375,.6875,.8125,.9,.9375,1.025,1.5,2.025,100];
  for(const hz of [24,30,60,120,144,0]) {
    const {actor}=await actorFor(t,prepared);actor.enqueue(clipEvent());actor.enqueue(clipEvent(.9,.125));
    const current=[];let last=0;
    for(const goal of goals) {
      if(hz)for(let time=last+1/hz;time<goal-1e-10;time+=1/hz)actor.advance(time);
      actor.advance(goal);current.push(snapshot(actor));last=goal;
    }
    samples.push(current);
  }
  for(let i=1;i<samples.length;i++)assert.deepEqual(samples[i],samples[0]);
});

test('minimum .02 sec clip and .02 sec bridge keep exact boundaries even when the display skips the entire clip',async t=>{
  const prepared=await packWithLibrary(library=>{
    library.clips=[{id:'shortest',durationSec:.02,endBehavior:'hold',tracks:[{
      target:'joint:arm.left',interpolation:'STEP',keys:[{at:0,rotation:q(2,-.1)},{at:.5,rotation:q(2,.1)},{at:1,rotation:q(2,.05)}]
    }]}];
  });
  const {actor}=await actorFor(t,prepared);actor.enqueue(clipEvent(0,.02,'shortest'));
  actor.advance(.01);assertAngle(actor,'joint:arm.left',2,-.05);
  actor.advance(.02);assertAngle(actor,'joint:arm.left',2,-.1);
  actor.advance(.03-1e-9);assertAngle(actor,'joint:arm.left',2,-.1);
  actor.advance(.03);assertAngle(actor,'joint:arm.left',2,.1);
  actor.advance(.04);assertAngle(actor,'joint:arm.left',2,.05);assert.equal(actor.isAnimating(),false);
  const {actor:skipped}=await actorFor(t,prepared);skipped.enqueue(clipEvent(0,.02,'shortest'));skipped.advance(30);
  assert.deepEqual(snapshot(skipped),snapshot(actor));
});

test('final keys hold indefinitely without demand animation or retained active clip references',async t=>{
  const {actor}=await actorFor(t);actor.enqueue(clipEvent());actor.advance(1.125);
  assertAngle(actor,'joint:arm.left',2,-.08);assertAngle(actor,'joint:arm.right',0,.08);assertAngle(actor,'accessory:testCap',1,.22);
  assert.equal(actor.isAnimating(),false);assert.equal(actor.nextDeadline(),Infinity);
  for(const target of ['joint:arm.left','joint:arm.right','accessory:testCap'])assert.equal(actor.lanes.get(target).clipTrack,null);
  const final=snapshot(actor);assert.equal(actor.advance(100000),false);assert.deepEqual(snapshot(actor),final);
});

test('clip key workload is charged per actor, encoded library shared once, and disposal releases both',async t=>{
  const prepared=await pack(),cost=preparedAdmission(prepared),library=await fixture();
  const scalarCount=library.clips.reduce((n,c)=>n+c.tracks.reduce((m,track)=>m+5*track.keys.length,0),0);
  const clipAsset=prepared.manifest.assets.find(a=>a.id===prepared.manifest.clips);
  assert.equal(cost.clipKeyScalars,scalarCount);
  assert(cost.sources.some(source=>source.bytes===clipAsset.bytes),'encoded clip bytes have shared admission cost');
  const sourceBytes=cost.sources.reduce((n,source)=>n+source.bytes,0);
  const pool=new ActorPool({limits:{clipKeyScalars:scalarCount*2,sourceBytes}});t.after(()=>pool.dispose());
  const [first,second]=await Promise.all([pool.create(prepared),pool.create(prepared)]);
  assert.equal(pool.stats.clipKeyScalars,scalarCount*2);assert.equal(pool.stats.sourceBytes,sourceBytes);
  await assert.rejects(pool.create(prepared),{code:'GLOBAL_BUDGET'});
  first.enqueue(clipEvent());second.enqueue(clipEvent());first.advance(.4375);second.advance(.6875);
  assert.notDeepEqual(lane(first,'joint:arm.left'),lane(second,'joint:arm.left'));
  first.dispose();first.dispose();assert.equal(pool.stats.clipKeyScalars,scalarCount);assert.equal(pool.stats.sourceBytes,sourceBytes);
  second.dispose();assert.equal(pool.stats.clipKeyScalars,0);assert.equal(pool.stats.sourceBytes,0);assert.equal(pool.stats.cache.retainedReferences,0);
});

test('clip workload rejection and actor binding failure roll back before retaining shared sources',async t=>{
  const prepared=await pack(),cost=preparedAdmission(prepared);
  const tooSmall=new ActorPool({limits:{clipKeyScalars:cost.clipKeyScalars-1}});t.after(()=>tooSmall.dispose());
  await assert.rejects(tooSmall.create(prepared),{code:'GLOBAL_BUDGET'});
  assert.equal(tooSmall.stats.actors,0);assert.equal(tooSmall.stats.clipKeyScalars,0);
  assert.equal(tooSmall.stats.sourceBytes,0);assert.equal(tooSmall.stats.cache.loads,0);
  const profile=decode(await read('character-profile.json',65536));profile.joints[0].node='MissingAuthoredBone';
  const bytes=encode(profile),hash=await sha256(bytes);
  const missingBinding=await preparePack(async(name,max,signal)=>{
    if(name==='character-profile.json')return bytes;
    const content=await read(name,max,signal);
    if(name!=='manifest.json')return content;
    const manifest=decode(content),asset=manifest.assets.find(a=>a.kind==='profile');
    asset.bytes=bytes.length;asset.sha256=hash;return encode(manifest);
  });
  const pool=new ActorPool();t.after(()=>pool.dispose());
  await assert.rejects(pool.create(missingBinding),{code:'BINDING'});
  assert.equal(pool.stats.actors,0);assert.equal(pool.stats.clipKeyScalars,0);assert.equal(pool.stats.sourceBytes,0);
  assert.equal(pool.stats.cache.retainedReferences,0);assert.equal(pool.stats.cache.live,0);
});
