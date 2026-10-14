'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { sampleGroundedMoonwalk } = require('../src/capabilities/companion/presentation/grounded-moonwalk.mjs');
const { samplePaperReturn, paperReturnFace } = require('../src/capabilities/companion/presentation/paper-return-story.mjs');
const { sampleHatStar } = require('../src/capabilities/companion/presentation/hat-star-path.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { PET_FORMS } = require('../src/capabilities/companion/form-registry.mjs');
const art = require('../src/capabilities/companion/presentation/form-art.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { usagiPropMatrix } = require('../src/capabilities/companion/presentation/usagi-contact.mjs');
const { toolMatrix } = require('../src/capabilities/companion/presentation/dango-raster-actions.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const backend = process.env.PET_MOTION_CANVAS_PACKAGE ? require(process.env.PET_MOTION_CANVAS_PACKAGE) : null;
const canvasTest = { skip: backend ? false : 'Run with PET_MOTION_CANVAS_PACKAGE for production Canvas acceptance' };
let initialized;
async function ready() {
  if (!initialized) initialized = (async () => {
    const { installOffscreenImages } = await import('../tools/usagi-gallery/offscreen-images.mjs');
    installOffscreenImages(backend); global.Path2D = backend.Path2D;
    global.document = { createElement: () => backend.createCanvas(1,1) };
    global.window = { devicePixelRatio:2 };
    await Promise.all(Object.values(PET_FORMS).map(form=>art.prepareArtwork(form,{all:true})));
  })();
  return initialized;
}
const distance = (a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function resolve(character,id,progress,view='three-quarter',extra={}) {
  const action=PET_ACTIONS[id];
  return art.resolveArtwork(PET_FORMS[character],{action,motion:action.motion,progress,view,...extra});
}
function feet(character,artwork,p) {
  const offset=art.motionOffset(PET_FORMS[character],PET_ACTIONS.moonwalk,'moonwalk',p,{bodySize:66,calmVisual:false});
  return ['l','r'].map((side,i)=>{
    let point;
    if(character==='usagi'){
      const data=artwork.rig.views[artwork.drawnView],anchor=data.anchors[i?'usagi.footwear-r':'usagi.footwear'];
      point=applyPoint(artwork.pose.world[`leg_${side}`],anchor.x,anchor.y);
    }else{
      const key=i?'foot-right':'foot-left',anchor=artwork.anchors[key];point=applyPoint(artwork.matrices[key],anchor.x,anchor.y);
    }
    return [point[0]+offset.x,point[1]+offset.y];
  });
}

test('moonwalk exchanges grounded support in production for both forms, and returns home',canvasTest,async()=>{
  await ready();
  for(const character of ['dango','usagi'])for(const view of ['front','three-quarter','profile','back']){
    let previous=null,previousSupport=[],maxLift=0,maxTravel=0;
    const start=feet(character,resolve(character,'moonwalk',0,view),0);
    for(let n=0;n<=900;n++){
      const p=n/900,pose=sampleGroundedMoonwalk(p),actual=feet(character,resolve(character,'moonwalk',p,view),p);
      assert.ok(pose.support.length>=1);
      for(const side of pose.support){
        assert.ok(Math.abs(actual[side][1]-start[side][1])<1e-9,`${character}/${view} planted sole height`);
        if(previous&&previousSupport.includes(side))assert.ok(distance(actual[side],previous[side])<1e-8,`${character}/${view} support does not skate`);
      }
      for(let side=0;side<2;side++){
        maxLift=Math.max(maxLift,start[side][1]-actual[side][1]);maxTravel=Math.max(maxTravel,Math.abs(actual[side][0]-start[side][0]));
      }
      previous=actual;previousSupport=pose.support;
    }
    assert.ok(maxLift>1.7&&maxTravel>=5.9,'contacts must not pass by making the feet motionless');
    assert.ok(previous.every((point,i)=>distance(point,start[i])<1e-9));
  }
});

test('paper return uses real separate paw and prop grip transforms at takeoff and catch',canvasTest,async()=>{
  await ready();
  for(const character of ['usagi','dango'])for(const view of ['front','three-quarter'])for(const calmVisual of [false,true]){
    for(let n=0;n<=200;n++){
      const p=n/200;if(!calmVisual&&!((p>=.14&&p<=.34)||(p>=.76&&p<=.9)))continue;
      const a=resolve(character,'paper-return',p,view,{calmVisual});let hand,grip;
      if(character==='usagi'){
        const data=a.rig.views[a.drawnView],pivot=data.bones.hand_r.pivot;
        hand=applyPoint(a.pose.world.hand_r,...pivot);
        const matrix=usagiPropMatrix(a.pose.world.hand_r,{id:'plane',artwork:a,data});grip=applyPoint(matrix,...pivot);
      }else{
        const h=a.contact.hands.find(h=>h.side==='right'),item=a.contact.tools.find(t=>t.key==='paper-plane');
        hand=applyPoint(h.pawMatrix,...DANGO_RASTER.tools['small-fin'].anchors.grip);
        grip=applyPoint(toolMatrix(item,DANGO_RASTER.tools['paper-plane']),...DANGO_RASTER.tools['paper-plane'].anchors.right);
      }
      assert.ok(distance(hand,grip)<1e-8,`${character}/${view}/${p}: independent grip coincidence`);
    }
  }
});

test('return story has bounded continuous trajectories, true idle bookends and deliberate calm hold',()=>{
  let previous=samplePaperReturn(0),max=0;
  for(let n=1;n<=2000;n++){
    const current=samplePaperReturn(n/2000);max=Math.max(max,distance(current.grip,previous.grip));
    assert.ok(current.grip.every(Number.isFinite));assert.ok(current.grip[0]>=55&&current.grip[0]<=95);
    previous=current;
  }
  assert.ok(max<.25);assert.equal(samplePaperReturn(0).opacity,0);assert.equal(samplePaperReturn(1).opacity,0);
  assert.deepEqual(samplePaperReturn(0).hand,samplePaperReturn(1).hand);
  assert.deepEqual(samplePaperReturn(.1,true),samplePaperReturn(.9,true));assert.equal(samplePaperReturn(.1,true).opacity,1);
  const higher={eyes:'droopy',mouth:'wavy'};assert.equal(paperReturnFace(higher,{action:PET_ACTIONS['paper-return'],expressionId:'life.sleep'}),null);
});

test('magic star routes beneath and around the face instead of traversing eyes, then returns inside hat',()=>{
  for(let n=0;n<=1000;n++){
    const {center:[x,y],opacity}=sampleHatStar(n/1000);
    if(opacity>.001)assert.ok(y>=54.99||x>=76.99,'visible star path stays outside eye/cheek corridor');
  }
  assert.equal(sampleHatStar(.94).opacity,0);assert.equal(sampleHatStar(1).opacity,0);
  assert.deepEqual(sampleHatStar(1).center,[33,55]);
});

test('new story interrupted mid-flight has no retained tool or moving cached-body identity',canvasTest,async()=>{
  await ready();
  for(const character of ['dango','usagi']){
    const form=PET_FORMS[character],skin=character==='dango'?'pink':'usagi',keys=new Set();
    for(let n=0;n<=45;n++){
      const a=resolve(character,'paper-return',n/90,'three-quarter',{elapsedMs:n*10500/90,channel:`interrupt:${character}`});
      keys.add(art.bodySpriteKey(form,skin,'normal','three-quarter',false,a));
    }
    assert.equal(keys.size,1,'pose/phase never creates body-cache entries');
    const idle=art.resolveArtwork(form,{view:'three-quarter',motion:'idle',progress:0,elapsedMs:5350,channel:`interrupt:${character}`});
    assert.equal(character==='usagi'?idle.pose.sample.props.length:idle.contact?.tools.length||0,0);
  }
});

test('outer renderer decoration yields only to authored grounded base actions, never higher-priority states',()=>{
  const {bodyStateOffset,resolveActionBodyPose}=require('../src/surfaces/pet/body-presentation.mjs');
  const body={tone:'normal',x:2,y:3,scaleX:1.04,scaleY:.97,rotateDeg:3};
  for(const id of ['moonwalk','paper-return']){
    const action=PET_ACTIONS[id],options={action,expressionId:action.expression,source:'base'};
    assert.equal(bodyStateOffset({...options,state:'idle',formId:'usagi',bob:2}),0);
    assert.deepEqual(resolveActionBodyPose(body,options),{tone:'normal',x:0,y:0,scaleX:1,scaleY:1,rotateDeg:0});
    assert.equal(resolveActionBodyPose(body,{...options,source:'user'}),body);
    assert.equal(resolveActionBodyPose(body,{...options,expressionId:'life.sleep'}),body);
    assert.equal(bodyStateOffset({...options,state:'sleeping',bob:2}),4);
    assert.equal(bodyStateOffset({...options,state:'dragged',bob:2}),0);
    assert.equal(bodyStateOffset({...options,state:'idle',source:'user',bob:2}),2);
  }
  assert.equal(bodyStateOffset({state:'idle',action:PET_ACTIONS['paper-plane'],bob:2}),2);
});

test('actual production Canvas floor stays fixed across every moonwalk frame',canvasTest,async()=>{
  await ready();
  const {loadSource,createRenderHarness}=await import('../tools/usagi-gallery/runtime-harness.mjs');
  const {pixels}=await import('../tools/usagi-gallery/pixels.mjs');
  const source=await loadSource(pathToFileURL(path.resolve(__dirname,'..')).href);
  for(const skin of ['pink','usagi']){
    const h=createRenderHarness(source,{skin,view:'auto',outfit:false,dpr:2,blink:false});h.select('action','moonwalk');
    const bottoms=[];
    for(let n=0;n<270;n++){
      // Yield for native ImageData cleanup; retain all 270 production frames.
      if(n%10===0)await new Promise(resolve=>setImmediate(resolve));
      h.draw(n/30*1000);bottoms.push(pixels(h.body).bounds.bottom);
    }
    assert.equal(Math.max(...bottoms)-Math.min(...bottoms),0,`${skin}: final raster floor, including renderer body composition`);h.dispose();
  }
});

test('Dango return paw root faces inward and remains near its authored shoulder throughout release',canvasTest,async()=>{
  await ready();
  for(const view of ['front','three-quarter'])for(let n=0;n<=200;n++){
    const a=resolve('dango','paper-return',n/200,view),h=a.contact.hands[0],fin=DANGO_RASTER.tools['small-fin'];
    const root=applyPoint(h.pawMatrix,...fin.anchors.root),grip=applyPoint(h.pawMatrix,...fin.anchors.grip);
    assert.ok(root[0]<grip[0],'native outward fin has its root on the body side');
    assert.ok(root[0]<=62&&root[1]>=38&&root[1]<=50,'no detached root beyond the flank');
  }
});
