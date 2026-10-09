'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {default:rig}=require('../assets/companion/usagi/rig/usagi.rig.mjs');
const {default:support}=require('../src/capabilities/companion/presentation/usagi-support.mjs');
const {createRigArtist}=require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const {withUsagiEffectOrigins}=require('../src/capabilities/companion/presentation/usagi-effect-origins.mjs');
const {applyPoint,localMatrix,multiply}=require('../src/capabilities/companion/presentation/rig/pose.mjs');
const artist=createRigArtist({fallback:support});
test('Usagi bubble origin follows authored ring across all views and sampled motion phases',()=>{
  for(const view of Object.keys(rig.views))for(let n=0;n<=100;n++){
    const artwork=artist.resolve(rig,{view,motion:'float',action:{id:'bubble-blow',prop:'bubble-wand'},progress:n/101});
    const result=withUsagiEffectOrigins(artwork),data=rig.views[view];
    // Authored ring is six units above the wrist (shape origin is wrist y+1).
    const expected=applyPoint(artwork.pose.world.hand_r,data.bones.hand_r.pivot[0],44);
    assert.deepEqual(result.effectOrigins.bubbles,expected);
    assert.equal(result.pose,artwork.pose);
  }
});
test('Usagi bubble origin honors local prop transforms and suppresses absent tools',()=>{
  const artwork=artist.resolve(rig,{view:'front',motion:'float',action:{prop:'bubble-wand'},progress:.5});
  const pose={r:.2,x:2,y:-3,sx:1.1,sy:.8};
  const posed={...artwork,pose:{...artwork.pose,sample:{...artwork.pose.sample,propPoses:{'bubble-wand':pose}}}};
  assert.deepEqual(withUsagiEffectOrigins(posed).effectOrigins.bubbles,
    applyPoint(multiply(artwork.pose.world.hand_r,localMatrix([55,50],pose)),55,44));
  const empty=artist.resolve(rig,{view:'front',motion:'float',action:{prop:'none'},progress:.5});
  assert.deepEqual(withUsagiEffectOrigins(empty).effectOrigins,{});
});

test('Usagi bubble origin follows real channel transition and calm hold',()=>{
  for(const view of Object.keys(rig.views)){
    const channel=`bubble-transition:${view}`;
    const idle=artist.resolve(rig,{view,motion:'idle',elapsedMs:0,channel});
    const raw=artist.resolve(rig,{view,motion:'float',action:{prop:'bubble-wand'},progress:.5});
    let blended=0;
    for(let elapsedMs=16;elapsedMs<400;elapsedMs+=16){
      const artwork=artist.resolve(rig,{view,motion:'float',action:{prop:'bubble-wand'},progress:.5,elapsedMs,channel});
      const actual=withUsagiEffectOrigins(artwork).effectOrigins.bubbles;
      assert.deepEqual(actual,applyPoint(artwork.pose.world.hand_r,rig.views[view].bones.hand_r.pivot[0],44));
      if(JSON.stringify(artwork.pose.world.hand_r)!==JSON.stringify(raw.pose.world.hand_r))blended++;
      if(elapsedMs===16)assert.deepEqual(artwork.pose.world.hand_r,idle.pose.world.hand_r);
    }
    assert.ok(blended>1,'test must exercise intermediate blended poses');
    const calm=(elapsedMs,progress)=>withUsagiEffectOrigins(artist.resolve(rig,{view,motion:'float',action:{prop:'bubble-wand'},progress,elapsedMs,channel,calmVisual:true}));
    assert.deepEqual(calm(420,.1).effectOrigins,calm(480,.9).effectOrigins);
  }
});
