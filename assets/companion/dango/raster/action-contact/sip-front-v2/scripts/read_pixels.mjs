import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const [repo,input,output]=process.argv.slice(2);
if(!repo||!input||!output)throw Error('repo, input and output required');
const {createCanvas,loadImage}=createRequire(path.resolve(repo,'package.json'))('@napi-rs/canvas');
const im=await loadImage(input),c=createCanvas(im.width,im.height),x=c.getContext('2d');
x.drawImage(im,0,0);fs.writeFileSync(output,Buffer.from(x.getImageData(0,0,im.width,im.height).data));
