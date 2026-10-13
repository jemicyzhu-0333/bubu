import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import {readOptions} from './candidate-fixture.mjs';
const cli=readOptions(),here=path.dirname(fileURLToPath(import.meta.url));
const record=JSON.parse(fs.readFileSync(path.resolve(here,'../evidence/portable-reproduction.json')));
const {createCanvas,loadImage}=createRequire(path.resolve(cli.repo,'package.json'))('@napi-rs/canvas');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),rows=[];
for(const expected of record.frames){
  const filename=path.join(cli.out,'frames',`${String(expected.phaseIndex).padStart(3,'0')}.png`);
  const image=await loadImage(filename),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pngHash=sha(fs.readFileSync(filename)),rgbaHash=sha(Buffer.from(ctx.getImageData(0,0,image.width,image.height).data));
  rows.push({phaseIndex:expected.phaseIndex,pngBytesEqual:pngHash===expected.sha256,rgbaPixelsEqual:rgbaHash===expected.rgbaSha256,pngHash,rgbaHash});
}
if(rows.some(r=>!r.pngBytesEqual||!r.rgbaPixelsEqual))throw Error(JSON.stringify({ok:false,rows},null,2));
console.log(JSON.stringify({ok:true,rows},null,2));
