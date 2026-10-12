'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OPEN_EYE_GLYPHS, eyeInkRect, projectOpenEye, createEyeApertureSampler, relativeScale } = require('../src/capabilities/companion/presentation/dango-eye-projection.mjs');
// Expected pupil rect: the view's neutral pupil, resized by the glyph's generated
// relative size and kept on the neutral centre.
function expectedRect(neutral, eyes, i, scale = relativeScale(eyes, i)) {
  const [x, y, w, h] = eyeInkRect(neutral), [rw, rh] = scale;
  return [x + (w - w * rw) / 2, y + (h - h * rh) / 2, w * rw, h * rh];
}
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
async function make() {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await artist.ready({ all: true }); return artist;
}
function draw(artist, artwork, blink=false) {
  const context = recordingContext(), clips=[];
  context.rect=(...rect)=>clips.push(rect);
  artist.face(context, PALETTES.pink, artwork.face, blink, artwork.view, null, artwork);
  return { calls: context.calls, clips };
}
function ink(call) {
  const src=call.image.src.split('/raster/').at(-1).split('?')[0];
  return eyeInkRect({src,rect:call.rect});
}
function dimensions(call) { const r=ink(call);return [r[2]*call.matrix[0],r[3]*call.matrix[3]]; }

test('every full open glyph uses canonical eye footprint and authored perspective, with one sprite per eye', async () => {
  const artist=await make();
  try {
    for(const view of ['front','three-quarter','three-quarter-left','three-quarter-right','profile']) {
      for(const eyes of OPEN_EYE_GLYPHS) {
        const artwork=artist.resolveArtwork({view,face:{eyes,mouth:'neutral',openness:1},calmVisual:true});
        const {calls}=draw(artist,artwork), neutral=artwork.data.face.eyes.neutral;
        assert.equal(calls.length,3);
        for(const i of [0,1]) {
          const [w,h]=dimensions(calls[i]);const target=expectedRect(neutral[i],eyes,i);close(w,target[2]);close(h,target[3]);
          const c=calls[i],s=artwork.data.face.eyes[eyes][i];
          assert.ok(c.image.src.includes(s.src), `retains ${eyes} identity`);
          const r=eyeInkRect(s);
          close(c.matrix[0]*(r[0]+r[2]/2)+c.matrix[4],target[0]+target[2]/2);
          close(c.matrix[3]*(r[1]+r[3]/2)+c.matrix[5],target[1]+target[3]/2);
        }
      }
    }
  } finally { artist.dispose(); }
});

test('wide/curious phrase edges ease pupil size within the frame clock; opacity is never cross-faded', async()=>{
  const artist=await make(), expression=EXPRESSIONS.find(x=>x.id==='life.attentive');
  try {for(const view of ['front','three-quarter']) {
    const frames=[1007,1009,2447,2449].map(t=>{
      const a=artist.resolveArtwork({view,motion:'idle',face:expression.face,expressionId:expression.id,expressionElapsedMs:t,elapsedMs:t,channel:view});
      return draw(artist,a);
    });
    for(const frame of frames) {assert.equal(frame.calls.length,3);assert.equal(frame.clips.length,0);}
    // 2ms apart across the glyph swap: size may move at most 2ms * .002 of the neutral pupil.
    for(const i of [0,1])for(const [a,b] of [[0,1],[2,3]]){const da=dimensions(frames[a].calls[i]),db=dimensions(frames[b].calls[i]);
      for(const k of [0,1])assert.ok(Math.abs(da[k]-db[k])<=da[k]*.005,`${view} eye ${i} jumped ${da[k]}->${db[k]}`);}
    for(const f of frames)for(const i of [0,1])assert.equal(f.calls[i].alpha,1);
    assert.ok(frames[0].calls[0].image.src.includes('wide'));
    assert.ok(frames[1].calls[0].image.src.includes('curious'));
  }} finally{artist.dispose();}
});

test('openness clips a fixed pupil and highlight; blink and authored eyelids remain independent',async()=>{
  const artist=await make();try {
    for(const view of ['front','three-quarter'])for(const eyes of OPEN_EYE_GLYPHS){
      const a=artist.resolveArtwork({view,face:{eyes,mouth:'neutral',openness:.7},calmVisual:true});
      const {calls,clips}=draw(artist,a), neutral=a.data.face.eyes.neutral;
      assert.equal(clips.length,2);
      for(const i of [0,1]){const r=expectedRect(neutral[i],eyes,i);close(dimensions(calls[i])[1],r[3]);close(clips[i][3],r[3]*.7);}
      const blink=draw(artist,{...a,calmVisual:false},true);assert.equal(blink.clips.length,0);assert.ok(blink.calls.slice(0,2).every(c=>c.image.src.includes('closed')));
    }
    for(const eyes of ['half','droopy','shy','waiting','closed','sleepy','smile','content']) {
      const data=DANGO_RASTER.views.front;assert.equal(projectOpenEye(data,eyes,data.face.eyes[eyes][0],0),null);
      const a=artist.resolveArtwork({view:'front',face:{eyes,mouth:'neutral',openness:1},calmVisual:true});
      const result=draw(artist,a);assert.equal(result.clips.length,0);assert.deepEqual(result.calls[0].rect,data.face.eyes[eyes][0].rect);
    }
    const back=artist.resolveArtwork({view:'back',face:{eyes:'wide'},elapsedMs:1});assert.equal(draw(artist,back).calls.length,0);
  }finally{artist.dispose();}
});

test('aperture continuity is bounded, interruptible, channel-local, static-safe and clock-safe',()=>{
  const sampler=createEyeApertureSampler(),f=n=>({eyes:'neutral',openness:n});
  const at=(n,t,extra={})=>sampler.sample(f(n),{elapsedMs:t,...extra});
  close(at(1,0),1);const first=at(.25,16);assert.ok(first>=.968&&first<1);
  const reverse=at(1,32);assert.ok(reverse>first&&reverse<=1);
  close(at(.25,32,{channel:'preview'}),.25);close(at(1,32),reverse,'same timestamp does not advance');
  close(sampler.sample(f(.25),{}),.25);close(at(1,32),reverse);
  close(at(.25,48,{calmVisual:true}),.25);close(at(1,64),1);
  close(at(.25,80,{reducedMotion:true}),.25);close(at(1,96),1);
  close(at(.25,10),.25);close(at(1,600),1);close(at(.25,616,{view:'three-quarter'}),.25);
  sampler.sample({eyes:'closed',openness:0},{elapsedMs:632});close(at(1,648),1);
  sampler.dispose();close(at(.25,664),.25);
  close(at(.25,680,{expressionId:'work.focus'}),.25);
  close(at(1,696,{expressionId:'react.surprised'}),1);
  assert.ok(at(.25,712,{expressionId:'react.surprised'})>=.968);
});

test('all expression/action inputs remain finite; winners and static states retain selected face identity',async()=>{
  const artist=await make();try {
    for(const expression of EXPRESSIONS)for(const view of ['front','three-quarter','profile']) {
      for(const t of [0,1009,2600,5200]) {
        const a=artist.resolveArtwork({view,face:expression.face,expressionId:expression.id,expressionElapsedMs:t,elapsedMs:t,channel:expression.id});
        const result=draw(artist,a);for(const c of result.calls)assert.ok(c.matrix.every(Number.isFinite));
      }
      for(const flag of ['calmVisual','reducedMotion']) {
        const a=artist.resolveArtwork({view,face:expression.face,expressionId:expression.id,[flag]:true,elapsedMs:3000});
        assert.equal(a.calmVisual,true);assert.ok(Number.isFinite(a.eyeAperture));
      }
    }
    const face={eyes:'surprised',mouth:'open',openness:1};
    for(const action of Object.values(PET_ACTIONS)) {
      const a=artist.resolveArtwork({view:'front',action,motion:action.motion,progress:.5,face,expressionId:'system.restricted',elapsedMs:20});
      assert.equal(a.face.eyes,'surprised');assert.equal(a.face.mouth,'open');
      assert.ok(draw(artist,a).calls.every(c=>c.matrix.every(Number.isFinite)));
    }
  }finally{artist.dispose();}
});

test('real PNG pixels verify the neutral ink metadata and normalized visible pupil bounds',async()=>{
  const fs=require('node:fs');
  const {createCanvas,loadImage}=require('@napi-rs/canvas');
  const {DANGO_EYE_INK_BOUNDS,DANGO_EYE_RELATIVE_SCALE}=require('../src/content/companion/dango-eye-footprints.mjs');
  assert.ok(DANGO_EYE_RELATIVE_SCALE.wide.every(([w,h])=>w>1.05&&h>1.05),'wide eyes stay larger than neutral');
  const {drawRasterFace}=require('../src/capabilities/companion/presentation/dango-raster-face.mjs');
  const {createRasterPainter}=require('../src/capabilities/companion/presentation/raster/paint.mjs');
  const images=new Map();
  function darkBounds(image){
    const c=createCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;
    let l=c.width,t=c.height,r=-1,b=-1;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4;
      if(pixels[i+3]>127&&Math.max(pixels[i],pixels[i+1],pixels[i+2])<100){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}
    }
    return [l,t,r+1-l,b+1-t];
  }
  for(const [src,bounds]of Object.entries(DANGO_EYE_INK_BOUNDS)){
    const im=await loadImage(fs.readFileSync(new URL(src,DANGO_RASTER.baseUrl)));images.set(src,im);
    assert.deepEqual([im.width,im.height,...darkBounds(im)],bounds,src);
  }
  for(const view of ['front','three-quarter','three-quarter-left','three-quarter-right'])for(const eyes of OPEN_EYE_GLYPHS){
    for(const s of DANGO_RASTER.views[view].face.eyes[eyes])if(!images.has(s.src))images.set(s.src,await loadImage(fs.readFileSync(new URL(s.src,DANGO_RASTER.baseUrl))));
  }
  const source={get:s=>images.get(s.src)},painter=createRasterPainter({source,createSurface:createCanvas});
  for(const view of ['front','three-quarter','three-quarter-left','three-quarter-right'])for(const eyes of OPEN_EYE_GLYPHS){
    const data=DANGO_RASTER.views[view],face={eyes,mouth:'neutral',openness:1};
    const c=createCanvas(480,480),ctx=c.getContext('2d');ctx.scale(6,6);
    drawRasterFace(ctx,{view,data,face,layeredReady:true},face,false,PALETTES.pink,{source,painter});
    for(const [index,reference] of data.face.eyes.neutral.entries()){
      // Generated relative size keeps expression differences on the neutral pupil centre.
      const [nx,ny,nw,nh]=eyeInkRect(reference),[rw,rh]=DANGO_EYE_RELATIVE_SCALE[eyes][index];
      const w=nw*rw,h=nh*rh,x=nx+(nw-w)/2,y=ny+(nh-h)/2,left=Math.floor(x*6)-2,top=Math.floor(y*6)-2;
      const crop=createCanvas(Math.ceil(w*6)+5,Math.ceil(h*6)+5);crop.getContext('2d').drawImage(c,-left,-top);
      const actual=darkBounds(crop);
      assert.ok(Math.abs(actual[2]-w*6)<=1.5,`${view}/${eyes} visible width ${actual[2]} vs ${w*6}`);
      assert.ok(Math.abs(actual[3]-h*6)<=1.5,`${view}/${eyes} visible height ${actual[3]} vs ${h*6}`);
    }
  }
});

test('lookback transforms carry the pupil and lid together without leaking into the next eye or mouth',async()=>{
 const {multiply}=require('../src/capabilities/companion/presentation/rig/pose.mjs');
 const artist=await make();try{
  const artwork=artist.resolveArtwork({view:'front',face:{eyes:'curious',mouth:'neutral',openness:.7},dnd:true});
  const raw=draw(artist,artwork),matrices=[[.98,.2,-.2,.98,2,-1],[.99,-.1,.1,.99,-1,2],[1,0,0,1,0,0]];
  const turned=draw(artist,{...artwork,lookback:{matrices}});
  assert.equal(turned.clips.length,2);assert.deepEqual(turned.clips,raw.clips);
  for(const i of [0,1,2]){
   const expected=multiply(matrices[i],raw.calls[i].matrix);
   for(let j=0;j<6;j++)close(turned.calls[i].matrix[j],expected[j]);
  }
 }finally{artist.dispose();}
});

test('generated relative sizes keep wide eyes larger than neutral and settle smoothly', () => {
  const sampler=createEyeApertureSampler(), face={eyes:'focused',mouth:'neutral',openness:1};
  let last=sampler.sampleEyes(face,{elapsedMs:0,expressionId:'x'});
  assert.deepEqual(last.scale,[relativeScale('focused',0),relativeScale('focused',1)]);
  for(let t=16;t<=800;t+=16){
    const next=sampler.sampleEyes({...face,eyes:'wide'},{elapsedMs:t,expressionId:'x'});
    for(const i of [0,1])for(const k of [0,1])assert.ok(Math.abs(next.scale[i][k]-last.scale[i][k])<=16*.002+1e-12);
    last=next;
  }
  for(const i of [0,1])for(const k of [0,1])assert.ok(Math.abs(last.scale[i][k]-relativeScale('wide',i)[k])<1e-4);
  assert.ok(relativeScale('wide',0)[1]>1.05);
  const fresh=sampler.sampleEyes({...face,eyes:'focused'},{elapsedMs:900,expressionId:'other'});
  assert.deepEqual(fresh.scale,[relativeScale('focused',0),relativeScale('focused',1)],'new semantic id is immediate');
});
