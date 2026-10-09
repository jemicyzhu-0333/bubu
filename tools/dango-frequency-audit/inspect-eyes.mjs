import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DANGO_RASTER as manifest} from '../../assets/companion/dango/raster/dango.raster.mjs';
import {installOffscreenImages} from '../usagi-gallery/offscreen-images.mjs';
import {loadSource,createRenderHarness} from '../usagi-gallery/runtime-harness.mjs';
const canvasPackage=process.argv.find(value=>value.startsWith('--canvas-package='))?.slice('--canvas-package='.length)||process.env.DANGO_CANVAS_PACKAGE;
if(!canvasPackage)throw Error('Pass --canvas-package or DANGO_CANVAS_PACKAGE for an existing Skia backend');
const backend=createRequire(import.meta.url)(canvasPackage);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'dist/dango-frequency-audit/eye-diagnosis');fs.mkdirSync(out,{recursive:true});
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(pathToFileURL(root).href);
const sheet=backend.createCanvas(1320,980),ctx=sheet.getContext('2d');ctx.fillStyle='#f1f3ed';ctx.fillRect(0,0,1320,980);
const label=(s,x,y,size=16)=>{ctx.fillStyle='#314238';ctx.font=`${size}px sans-serif`;ctx.fillText(s,x,y);};
label('IDLE EYE DIAGNOSIS / CURRENT ACTUAL RENDERER',24,34,25);
label('Normal = 99 CSS px body design width; enlarged = 198 px. Scarf / body / rig unchanged.',24,59,16);
const records=[];
for(const [vi,view] of ['front','three-quarter'].entries()) {
 const harness=createRenderHarness(source,{skin:'pink',view,dpr:2,calm:false,blink:false,outfit:['milestone.scarf']});harness.select('expression','life.idle');
 for(const [pi,at] of [0,2600].entries()) {
  const x=vi*660+24,y=100+pi*290;harness.draw(at);
  label(`${view} / ${at===0?'neutral at 0 ms':'curious at 2600 ms'}`,x,y,20);
  ctx.drawImage(harness.body,x,y+5,219,219);ctx.drawImage(harness.body,x+205,y-75,438,438);
  fs.writeFileSync(path.join(out,`${view}-${at}.png`),harness.body.toBuffer('image/png'));
 }
 harness.dispose();
 const eyes=manifest.views[view].face.eyes;
 for(const [ei,eyeState]of ['neutral','curious'].entries()) {
  let x=vi*660+35,y=730+ei*115;label(`${view}: ${eyeState} pair, 4.5 px / art unit`,x,y-10,15);
  for(const [side,sprite]of eyes[eyeState].entries()) {
   const data=fs.readFileSync(new URL(sprite.src,manifest.baseUrl)),im=await backend.loadImage(data);
   const c=backend.createCanvas(im.width,im.height),ct=c.getContext('2d');ct.drawImage(im,0,0);const rgba=ct.getImageData(0,0,im.width,im.height).data;
   let occupied=0;const b={left:im.width,top:im.height,right:-1,bottom:-1};
   for(let p=0;p<im.width*im.height;p++)if(rgba[p*4+3]>=16){occupied++;b.left=Math.min(b.left,p%im.width);b.right=Math.max(b.right,p%im.width);b.top=Math.min(b.top,Math.floor(p/im.width));b.bottom=Math.max(b.bottom,Math.floor(p/im.width));}
   const cssWidth=(b.right-b.left+1)/im.width*sprite.rect[2]*1.5,cssHeight=(b.bottom-b.top+1)/im.height*sprite.rect[3]*1.5;
   records.push({view,eyeState,side,src:sprite.src,sha256:createHash('sha256').update(data).digest('hex'),sourcePx:[im.width,im.height],sourceAlphaBounds:b,rect:sprite.rect,pivot:sprite.pivot,cssAlphaSize:[cssWidth,cssHeight],cssAlphaArea:occupied/im.width/im.height*sprite.rect[2]*sprite.rect[3]*2.25});
   ctx.imageSmoothingEnabled=false;ctx.drawImage(im,x+side*220,y,sprite.rect[2]*4.5,sprite.rect[3]*4.5);
   label(`rect ${sprite.rect[2].toFixed(2)} x ${sprite.rect[3].toFixed(2)}`,x+side*220,y+75,14);
  }
 }
}
fs.writeFileSync(path.join(out,'current-idle-eye-comparison.png'),sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(out,'eye-layout.json'),JSON.stringify(records,null,2));console.log(JSON.stringify({out,records},null,2));
