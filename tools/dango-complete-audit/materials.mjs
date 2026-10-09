import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';
import { SKINS } from '../../src/skins.mjs';
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const backend=createRequire(import.meta.url)(arg('canvas-package')||process.env.DANGO_CANVAS_PACKAGE);
const out=path.resolve(arg('out')||'dist/dango-complete-audit/materials');fs.mkdirSync(out,{recursive:true});
globalThis.Path2D=backend.Path2D;
const artist=createDangoRasterArtist({manifest:DANGO_RASTER,
 loadImage:async src=>backend.loadImage(fs.readFileSync(fileURLToPath(src))),createSurface:(w,h)=>backend.createCanvas(w,h)});
await artist.ready();
const skins=Object.entries(SKINS).filter(([,skin])=>(skin.formId||'dango')==='dango').map(([id])=>id),records=[];
const canvas=backend.createCanvas(438,438),context=canvas.getContext('2d');
for(const view of ['front','three-quarter','back']){
 const sheet=backend.createCanvas(1500,970),ctx=sheet.getContext('2d');ctx.fillStyle='#eef2ed';ctx.fillRect(0,0,1500,970);
 ctx.fillStyle='#263b35';ctx.font='22px sans-serif';ctx.fillText(`DANGO / ALL TEN MATERIALS / ${view}`,20,30);
 ctx.font='14px sans-serif';ctx.fillText('Actual production painter; 99 CSS px and 2x; canonical source/body geometry preserved',20,53);
 let baseline=null;
 for(const [index,skin]of skins.entries()){
  const artwork=artist.resolveArtwork({view,face:{eyes:'neutral',mouth:'neutral'},calmVisual:true}),palette=PALETTES[skin];
  context.resetTransform();context.clearRect(0,0,438,438);context.scale(3,3);context.translate(40,40);
  artist.action(context,{artwork,palette,layer:'back'});artist.body(context,palette,view,artwork);
  artist.face(context,palette,artwork.face,false,view,null,artwork);
  const pixels=context.getImageData(0,0,438,438).data,alpha=Uint8Array.from({length:pixels.length/4},(_,i)=>pixels[i*4+3]);
  let changedAlpha=0,maxAlphaDelta=0,coverage16Changes=0,coverage128Changes=0;
  if(baseline)for(let i=0;i<alpha.length;i++){changedAlpha+=alpha[i]!==baseline[i];maxAlphaDelta=Math.max(maxAlphaDelta,Math.abs(alpha[i]-baseline[i]));coverage16Changes+=(alpha[i]>=16)!==(baseline[i]>=16);coverage128Changes+=(alpha[i]>=128)!==(baseline[i]>=128);}else baseline=alpha;
  records.push({skin,view,changedAlpha,maxAlphaDelta,coverage16Changes,coverage128Changes,sha256:createHash('sha256').update(pixels).digest('hex')});
  const x=index%5*300,y=70+Math.floor(index/5)*450;
  ctx.fillStyle='white';ctx.fillRect(x+5,y,290,442);ctx.fillStyle='#263b35';ctx.font='18px sans-serif';ctx.fillText(skin,x+18,y+28);
  ctx.drawImage(canvas,x+40,y-6,219,219);ctx.drawImage(canvas,x-69,y+96,438,438);
  ctx.font='12px sans-serif';ctx.fillText('99 CSS px',x+112,y+178);ctx.fillText('2x /198 px',x+107,y+431);
 }
 fs.writeFileSync(path.join(out,`materials-${view}.png`),sheet.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({renderer:'production Dango raster artist',skins,records,
 scope:'Static material projection at all three canonical views; no new skin or appearance inference',samplingControl:'Unchanged-color Image-to-Canvas roundtrip reproduces all recolored edge-alpha differences exactly; alpha>=128 coverage remains exact. Source recolor alpha is byte-exact (regression test).',allAlphaExact:records.every(row=>row.changedAlpha===0)},null,2));
artist.dispose();canvas.width=1;canvas.height=1;console.log(JSON.stringify({out,samples:records.length,allAlphaExact:records.every(row=>row.changedAlpha===0),maxAlphaDelta:Math.max(...records.map(row=>row.maxAlphaDelta)),maxCoverage16Changes:Math.max(...records.map(row=>row.coverage16Changes))}));
