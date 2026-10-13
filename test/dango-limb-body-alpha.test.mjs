import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createDangoLimbSource} from '../src/capabilities/companion/presentation/dango-limb-assets.mjs';
const base=new URL('../assets/companion/dango/raster/',import.meta.url).href;
const manifest=JSON.parse(fs.readFileSync(new URL('limbs/limbs.json',base)));
const body=manifest.sockets.find(s=>s.kind==='shoulder'&&s.view==='front').sourceBody;
test('canonical body coverage queries full registered art rectangle and preserves unknown',async()=>{
 const source=createDangoLimbSource({baseUrl:base,acceptContract:2,
 loadJson:async u=>JSON.parse(fs.readFileSync(fileURLToPath(u))),
 loadImage:async src=>({src,width:2,height:2}),
 readPixels:image=>({width:2,height:2,data:new Uint8ClampedArray([0,0,0,255,0,0,0,0,0,0,0,0,0,0,0,255])})});
 assert.equal(typeof source.bodyAlpha,'function');assert.equal(source.bodyAlpha('front',0,0),null);
 await source.start();const [x,y,w,h]=body.rect;
 assert.equal(source.bodyAlpha('front',x+w*.1,y+h*.1),true);
 assert.equal(source.bodyAlpha('front',x+w*.7,y+h*.1),false);
 assert.equal(source.bodyAlpha('front',x+w*.7,y+h*.7),true);
 assert.equal(source.bodyAlpha('front',x-1,y),false);
 assert.equal(source.bodyAlpha('unknown',x,y),null);
 assert.equal(source.bodyAlpha('front',NaN,y),null);
});
