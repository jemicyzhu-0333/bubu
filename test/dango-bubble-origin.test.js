'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectEffectOrigins } = require('../src/surfaces/pet/effect-origin.mjs');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');

test('effect origin projection includes the exact body transform, mirror and canvas placement at each DPR', () => {
  for (const devicePixelRatio of [1, 2, 3]) {
    const stage=resolvePetStage({devicePixelRatio}), s=stage.deviceScale;
    const normal=projectEffectOrigins({bubbles:[50,35]},[s,0,0,s,0,0],{stage,offX:40,offY:40});
    assert.equal(normal.bubbles.x,135.5); assert.equal(normal.bubbles.y,115); assert.equal(normal.bubbles.direction,1);
    const mirrored=projectEffectOrigins({bubbles:[50,35]},[-s,0,0,s,146*s,0],{stage,offX:40,offY:40});
    assert.equal(mirrored.bubbles.x,84.5); assert.equal(mirrored.bubbles.y,115); assert.equal(mirrored.bubbles.direction,-1);
  }
  assert.deepEqual(projectEffectOrigins({bubbles:[1,2]},null,{}),{});
});

test('an unloaded or failed wand has no decorative bubble emitter while the body stays ready', async () => {
  const artist=createDangoRasterArtist({manifest:DANGO_RASTER,loadImage:async src=>{
    if(src.includes('/tools/bubble-wand.png'))throw Error('missing wand');return {src,width:8,height:8};
  }});
  await artist.ready({all:true});
  try{
    const artwork=artist.resolveArtwork({view:'front',action:{id:'bubble-blow',motion:'float',prop:'bubble-wand'},motion:'float'});
    assert.equal(artwork.layeredReady,true);assert.equal(artwork.actionReady,false);assert.deepEqual(artwork.effectOrigins,{});
  }finally{artist.dispose();}
});

const canvasPackage=process.env.DANGO_CANVAS_PACKAGE;
test('actual production bubbles spawn at the visible ring through front,3q,mirrored and moving root frames',
  {skip:!canvasPackage&&'Set DANGO_CANVAS_PACKAGE for actual painter proof'},async()=>{
    const backend=require(canvasPackage);
    const {installOffscreenImages}=await import('../tools/usagi-gallery/offscreen-images.mjs');
    const {loadSource,createRenderHarness}=await import('../tools/usagi-gallery/runtime-harness.mjs');
    const {traceFrame}=await import('../tools/dango-state-cycle-preview/metrics.mjs');
    const {pathToFileURL}=require('node:url');
    installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;
    globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
    const source=await loadSource(pathToFileURL(process.cwd()).href);let checked=0;
    for(const view of ['front','three-quarter'])for(const facing of [1,-1]){
      const harness=createRenderHarness(source,{skin:'pink',view,facing,outfit:[],blink:false});
      harness.select('action','bubble-blow');
      try{
        for(let frame=0;frame<181;frame++){
          const trace=traceFrame(harness,frame/30*1000),fresh=trace.result.state.overlayParticles.filter(p=>p.actionId==='bubble-blow'&&p.life===46);
          if(!fresh.length)continue;
          const ring=trace.calls.find(c=>c.src?.includes('/tools/bubble-wand.png'));assert.ok(ring);
          const [a,b,c,d,e,f]=ring.matrix,ratio=harness.stage.cssWidth/harness.stage.rasterWidth;
          const x=(a*6.5+c*6+e)*ratio+.5,y=(b*6.5+d*6+f)*ratio+2.5;
          for(const particle of fresh){
            assert.ok(Math.abs(particle.x-x)<.001,JSON.stringify({view,facing,frame,actual:[particle.x,particle.y],expected:[x,y],matrix:ring.matrix}));assert.ok(Math.abs(particle.y-y)<.001);
            assert.equal(Math.sign(particle.vx),facing);checked++;
          }
        }
      }finally{harness.dispose();}
    }
    assert.ok(checked>=100,`checked ${checked} emitted particles`);
  });
