'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SCENES } = require('../src/content/scenes.mjs');
const { SCENE_PARTICLES, sceneCoverage, createRasterScenePainter } = require('../src/capabilities/companion/presentation/dango-raster-scenes.mjs');
const { createPetScene } = require('../src/surfaces/pet/scene.mjs');

const sprite = key => ({ src: `${key}.png`, rect: [20,30,180,142] });
function setup(manifest = {}) {
  const calls=[],context={globalAlpha:1,save(){calls.push(['save']);},restore(){calls.push(['restore']);},
    fillRect(...args){calls.push(['rect',...args]);},createLinearGradient(){return{addColorStop(){}};}};
  const painter={paint:(ctx,asset,palette,matrix,opacity)=>{calls.push(['sprite',asset,matrix,opacity]);return true;}};
  return{calls,context,...createRasterScenePainter({manifest,painter})};
}

test('all named scenes and both rooms require real generated layers and their particle assets',()=>{
  const empty=sceneCoverage();assert.equal(empty.complete,false);assert.equal(empty.missingScenes.length,25);assert.equal(empty.missingRooms.length,2);
  const manifest={scenes:Object.fromEntries(Object.keys(SCENES).map(id=>[id,{layers:[sprite(id)]}])),
    sessionScenes:Object.fromEntries(['focused','resting'].map(id=>[id,{layers:[sprite(id)]}])),
    sceneParticles:Object.fromEntries(SCENE_PARTICLES.map(id=>[id,sprite(id)]))};
  assert.equal(sceneCoverage(manifest).complete,true);
  const f=setup(manifest);for(const scene of Object.values(SCENES))assert.equal(f.sceneBackdrop(f.context,{scene}),true);
  for(const mode of ['focused','resting'])assert.equal(f.sceneBackdrop(f.context,{mode}),true);
  assert.equal(f.calls.filter(c=>c[0]==='sprite').length,27);
});

test('known loading scenes suppress legacy geometry, while unknown scene ids safely remain unhandled',()=>{
  const f=setup();assert.equal(f.sceneBackdrop(f.context,{scene:SCENES['dawn-window']}),true);
  assert.ok(f.calls.some(c=>c[0]==='rect'));
  assert.equal(f.calls.some(c=>c[0]==='sprite'),false);
  for(const id of ['missing','__proto__','constructor'])assert.equal(f.sceneBackdrop(f.context,{scene:{id},mode:id}),false);
  assert.equal(f.sceneParticle(f.context,{type:'cloud',x:20,y:30,life:20}),true);
  assert.equal(f.sceneParticle(f.context,{type:'unknown',x:20,y:30,life:20}),false);
});

test('scene particle drawing preserves sampled positions and physics, and calm rooms omit daydream motes',()=>{
  const cloud={src:'cloud.png',rect:[-10,-4,20,8],pivot:[0,0]},dust={src:'dust.png',rect:[-2,-2,4,4]};
  const f=setup({sceneParticles:{cloud,dust}}),value={type:'cloud',x:50,y:70,size:30,life:10,baseLife:20,vx:3,vy:2};
  const before={...value};f.sceneParticle(f.context,value);assert.deepEqual(value,before);
  const call=f.calls.find(c=>c[0]==='sprite');assert.deepEqual(call[2],[1.5,0,0,1.5,50,70]);assert.equal(call[3],.5);
  f.calls.length=0;f.sceneBackdrop(f.context,{mode:'resting',activity:{motion:'daydream'},calmVisual:true,elapsedMs:400});
  assert.equal(f.calls.some(c=>c[0]==='sprite'),false);
  f.sceneBackdrop(f.context,{mode:'resting',activity:{motion:'daydream'},elapsedMs:400});
  assert.equal(f.calls.filter(c=>c[0]==='sprite').length,2);
});

test('the existing scene wrapper delegates only when an artist handles the backdrop',()=>{
  const calls=[],context={},layer=createPetScene({context,art:{drawBackdrop:()=>calls.push('legacy'),drawSessionBackdrop:()=>calls.push('legacy-room')}});
  layer.drawBackdrop(SCENES['dawn-window'],false,ctx=>{assert.strictEqual(ctx,context);calls.push('raster');return true;});
  layer.drawBackdrop(SCENES['dawn-window'],false,()=>false);
  layer.drawSessionBackdrop('focused',{},false,()=>true);
  layer.drawSessionBackdrop('resting',{},false);
  assert.deepEqual(calls,['raster','legacy','legacy-room']);
});
