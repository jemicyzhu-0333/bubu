'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs');
const {fileURLToPath}=require('node:url');
const {createHash}=require('node:crypto');
const {createDangoRasterArtist}=require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const {DANGO_RASTER}=require('../assets/companion/dango/raster/dango.raster.mjs');
const {PALETTES}=require('../src/core/pet-art.mjs');
const {SKINS}=require('../src/skins.mjs');
const skins=Object.entries(SKINS).filter(([,s])=>(s.formId||'dango')==='dango').map(([id])=>id);
const canvasPackage=process.env.DANGO_CANVAS_PACKAGE;

test('all ten Dango palettes preserve source alpha and match identity-Canvas body coverage across canonical views',
 {skip:!canvasPackage&&'Set DANGO_CANVAS_PACKAGE for material pixel evidence'},async()=>{
  assert.equal(skins.length,10);
  const backend=require(canvasPackage);globalThis.Path2D=backend.Path2D;
  const artist=createDangoRasterArtist({manifest:DANGO_RASTER,
    loadImage:async src=>backend.loadImage(fs.readFileSync(fileURLToPath(src))),
    createSurface:(w,h)=>backend.createCanvas(w,h)});
  const identityArtist=createDangoRasterArtist({manifest:DANGO_RASTER,
    loadImage:async src=>{const image=await backend.loadImage(fs.readFileSync(fileURLToPath(src)));
      const surface=backend.createCanvas(image.width,image.height),context=surface.getContext('2d');
      context.drawImage(image,0,0);const pixels=context.getImageData(0,0,image.width,image.height);
      const {recolorRasterPixels}=require('../src/capabilities/companion/presentation/raster/palette.mjs');
      for(const skin of skins){const copy=new Uint8ClampedArray(pixels.data);recolorRasterPixels(copy,PALETTES[skin]);
        for(let i=3;i<copy.length;i+=4)assert.equal(copy[i],pixels.data[i],`${skin}: source alpha must be exact`);}
      context.putImageData(pixels,0,0);return surface;},createSurface:(w,h)=>backend.createCanvas(w,h)});
  await Promise.all([artist.ready(),identityArtist.ready()]);
  const canvas=backend.createCanvas(438,438),ctx=canvas.getContext('2d');
  try{for(const view of ['front','three-quarter','back']){
    const control=identityArtist.resolveArtwork({view,face:{eyes:'neutral',mouth:'neutral'},calmVisual:true});
    ctx.resetTransform();ctx.clearRect(0,0,438,438);ctx.scale(3,3);ctx.translate(40,40);
    identityArtist.action(ctx,{artwork:control,palette:PALETTES.pink,layer:'back'});
    identityArtist.body(ctx,PALETTES.pink,view,control);
    const controlPixels=ctx.getImageData(0,0,438,438).data;
    const identityAlpha=Uint8Array.from({length:controlPixels.length/4},(_,i)=>controlPixels[i*4+3]);
    let alpha=null;const hashes=new Set();
    for(const skin of skins){
      const palette=PALETTES[skin],artwork=artist.resolveArtwork({view,face:{eyes:'neutral',mouth:'neutral'},calmVisual:true});
      ctx.resetTransform();ctx.clearRect(0,0,438,438);ctx.scale(3,3);ctx.translate(40,40);
      artist.action(ctx,{artwork,palette,layer:'back'});artist.body(ctx,palette,view,artwork);
      const data=ctx.getImageData(0,0,438,438).data,next=Uint8Array.from({length:data.length/4},(_,i)=>data[i*4+3]);
      // The backend samples raw Image and Canvas edge alpha differently. An unchanged-color
      // Canvas roundtrip reproduces that difference exactly; do not claim raw alpha equality.
      if(alpha){assert.deepEqual(next,identityAlpha,`${skin}/${view}: exact identity-Canvas alpha`);
        assert.deepEqual(next.map(v=>Number(v>=128)),alpha.map(v=>Number(v>=128)),`${skin}/${view}: opaque silhouette`);
      }else alpha=next;
      hashes.add(createHash('sha256').update(data).digest('hex'));
      assert.ok(next.some(v=>v>0));
    }
    assert.equal(hashes.size,10,`${view}: every declared material is visibly distinct`);
  }}finally{artist.dispose();identityArtist.dispose();canvas.width=1;canvas.height=1;}
 });
