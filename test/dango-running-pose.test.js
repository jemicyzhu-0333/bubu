'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleRunningPose, sampleRunningFeet, applyRunningTransform } = require('../src/core/pet-running-pose.mjs');
const { BODY_ANCHORS } = require('../src/content/companion/dango-vector.mjs');
const { sampleDangoFace } = require('../src/capabilities/companion/presentation/dango-face.mjs');
const art = require('../src/capabilities/companion/presentation/dango-art.mjs').default;
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const anchors = BODY_ANCHORS['three-quarter'], action = PET_ACTIONS['chase-butterfly'];
const point = (m,p) => [m[0]*p.x+m[2]*p.y+m[4],m[1]*p.x+m[3]*p.y+m[5]];
function recorder() {
  let m=[1,0,0,1,0,0];
  const multiply=n=>{const [a,b,c,d,e,f]=m,[g,h,i,j,k,l]=n;m=[a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];};
  return {translate:(x,y)=>multiply([1,0,0,1,x,y]),rotate:r=>multiply([Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0]),
    scale:(x,y)=>multiply([x,0,0,y,0,0]),get matrix(){return m;}};
}
test('native running leans and elongates as the feet separate through meaningful opposing strides',()=>{
  const pose=sampleRunningPose(.275);assert.ok(pose.lean>.08&&pose.scaleX>1.07&&pose.scaleY<.94);
  const feet=sampleRunningFeet(anchors,.275),left=point(feet['foot-left'],anchors['foot-left']),right=point(feet['foot-right'],anchors['foot-right']);
  assert.ok(right[0]-left[0]>35);assert.ok(Math.abs(right[1]-left[1])>3);
  assert.deepEqual(sampleRunningFeet(anchors,0),sampleRunningFeet(anchors,1));
  assert.equal(sampleRunningPose(0).effort,0);assert.equal(sampleRunningPose(1).effort,0);
});
test('the mirrored runner leans into travel in both directions',()=>{
  const right=recorder(),left=recorder();
  applyRunningTransform(right,.275,{size:146,facing:1});applyRunningTransform(left,.275,{size:146,facing:-1});
  for(const p of [{x:60,y:50},{x:91,y:98},{x:45,y:88}]){
    const a=point(right.matrix,p),b=point(left.matrix,{x:146-p.x,y:p.y});
    assert.ok(Math.abs(a[0]+b[0]-146)<1e-9);assert.ok(Math.abs(a[1]-b[1])<1e-9);
  }
});
test('calm and dragged running stop the feet and whole-body transform immediately',()=>{
  const idleFeet=sampleRunningFeet(anchors,0);
  for(const progress of [.1,.275,.7]){
    assert.deepEqual(sampleRunningFeet(anchors,progress,{calmVisual:true}),idleFeet);
    const dragged=art.resolveArtwork({action,motion:'dash',view:'three-quarter',progress,state:'dragged'});
    assert.deepEqual(dragged.footwearTransforms,idleFeet);
    assert.equal(dragged.calmVisual,true,'the same frozen policy reaches the paws and dust');
    for(const options of [{calmVisual:true},{state:'dragged'}]){
      const ctx=recorder();art.applyMotionTransform(ctx,'dash',progress,{...options,action});
      assert.deepEqual(ctx.matrix,[1,0,0,1,0,0]);
    }
    assert.deepEqual(art.motionOffset('dash',progress,false,{action,state:'dragged'}),{x:0,y:0});
  }
});
test('running torso has one stable cache variant while calm and dragged states retain the resting silhouette',()=>{
  const first=art.resolveArtwork({action,motion:'dash',progress:.2}),later=art.resolveArtwork({action,motion:'dash',progress:.8});
  const idle=art.resolveArtwork({motion:'idle'});
  assert.equal(first.key,later.key);assert.notEqual(first.key,idle.key);assert.equal(first.running,true);
  for(const options of [{calmVisual:true},{state:'dragged'}]){
    const staticPose=art.resolveArtwork({action,motion:'dash',...options});
    assert.equal(staticPose.key,idle.key);assert.equal(staticPose.running,false);
  }
});
test('a nine-second running cycle has bounded per-frame foot travel and a quiet closed-mouth face',()=>{
  let previous=null,max=0;
  for(let i=0;i<=540;i++){
    const feet=sampleRunningFeet(anchors,i/540);
    const tips=['foot-left','foot-right'].map(side=>point(feet[side],{x:anchors[side].x,y:62}));
    if(previous)tips.forEach((tip,j)=>{max=Math.max(max,Math.hypot(tip[0]-previous[j][0],tip[1]-previous[j][1]));});
    previous=tips;
    const face=sampleDangoFace({eyes:'neutral',mouth:'neutral'},{action,progress:i/540,expressionId:action.expression});
    assert.equal(face.mouth,'neutral');assert.equal(face.eyes,'neutral');
  }
  // At the desktop's 1.5 CSS-pixel/art-unit scale, no foot travels more than
  // two CSS pixels between 60 Hz frames even at the full ten-stride cadence.
  assert.ok(max<4/3,`adjacent foot travel ${max}`);
  const feedback={eyes:'surprised',mouth:'open'};
  assert.strictEqual(sampleDangoFace(feedback,{action,expressionId:'react.startled'}),feedback);
  assert.deepEqual(sampleDangoFace(feedback,{action,calmVisual:true,progress:.1}),sampleDangoFace(feedback,{action,calmVisual:true,progress:.9}));
});
