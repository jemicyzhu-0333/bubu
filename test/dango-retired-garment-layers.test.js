'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const retired = [['satchel','back','hidden-return'],['cape','front','hidden-panel'],['cape','three-quarter','hidden-panel']];

test('retired reconstruction layers remain reproducible history while visible worn panels stay exact',()=>{
  for(const [key,view,layer] of retired){
    const old=JSON.parse(fs.readFileSync(`assets/companion/dango/raster/sources/wardrobe/evidence/${key}/runtime-candidate.json`));
    assert.deepEqual(DANGO_RASTER.appearance[key].views[view].front,old.views[view].front);
    assert.deepEqual(DANGO_RASTER.appearance[key].views[view].back,old.views[view].back.filter(s=>!s.src.endsWith(`${layer}.png`)));
    assert.ok(fs.existsSync(`assets/companion/dango/raster/sources/history/complete-review-retired-layers/${key}-${view}-${layer}.png`));
    assert.ok(!fs.existsSync(`assets/companion/dango/raster/wardrobe/${key}-${view}-${layer}.png`));
  }
});

const canvasPackage=process.env.DANGO_CANVAS_PACKAGE;
test('actual painter removes only the accidental colored soles from cape and back satchel',
 {skip:!canvasPackage&&'Set DANGO_CANVAS_PACKAGE for source-pixel proof'},async()=>{
  const backend=require(canvasPackage);globalThis.Path2D=backend.Path2D;
  const make=manifest=>createDangoRasterArtist({manifest,loadImage:async src=>backend.loadImage(fs.readFileSync(fileURLToPath(src))),createSurface:(w,h)=>backend.createCanvas(w,h)});
  function draw(artist,item,view){
    const canvas=backend.createCanvas(438,438),ctx=canvas.getContext('2d');ctx.scale(3,3);ctx.translate(40,40);
    const appearance={items:[item]},artwork=artist.resolveArtwork({view,appearance,face:{eyes:'neutral',mouth:'neutral'}});
    artist.action(ctx,{artwork,palette:PALETTES.pink,layer:'back'});
    artist.appearance(ctx,{item,appearance,artwork,palette:PALETTES.pink,layer:'back'});
    artist.body(ctx,PALETTES.pink,artwork.view,artwork);
    artist.face(ctx,PALETTES.pink,artwork.face,false,artwork.view,null,artwork);
    artist.appearance(ctx,{item,appearance,artwork,palette:PALETTES.pink,layer:'front'});
    return ctx.getImageData(0,0,438,438).data;
  }
  const current=make(DANGO_RASTER);await current.ready({all:true});
  try{for(const [key,view,layer] of retired){
    const old=JSON.parse(fs.readFileSync(`assets/companion/dango/raster/sources/wardrobe/evidence/${key}/runtime-candidate.json`));
    const sprite=old.views[view].back.find(s=>s.src.endsWith(`${layer}.png`));assert.ok(sprite);
    const legacy=structuredClone(DANGO_RASTER);legacy.appearance[key].views[view].back=old.views[view].back.map(s=>s.src===sprite.src?{...s,src:`sources/history/complete-review-retired-layers/${key}-${view}-${layer}.png`}:s);
    const before=make(legacy);await before.ready({all:true});
    try{
      const item=PET_APPEARANCE_ITEMS.find(i=>i.renderKey===key),a=draw(before,item,view),b=draw(current,item,view);
      let changes=0,minY=438,maxY=0;
      for(let i=0;i<a.length;i+=4)if(a.slice(i,i+4).some((v,j)=>v!==b[i+j])){changes++;const y=Math.floor(i/4/438);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      assert.ok(changes>50,`${key}/${view}: old reconstruction visibly leaked`);
      assert.ok(minY>=285&&maxY<=320,`${key}/${view}: only foot-sole region changes (${minY}-${maxY})`);
    }finally{before.dispose();}
  }}finally{current.dispose();}
 });
