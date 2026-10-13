import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
let repo=arg('--repo-root',pkg);
while(!fs.existsSync(path.join(repo,'package.json'))||!fs.existsSync(path.join(repo,'assets/companion/dango/raster'))){const up=path.dirname(repo);if(up===repo)throw Error('Supply --repo-root pointing to the repository');repo=up;}
const out=arg('--output');if(!out)throw Error('--output required');fs.mkdirSync(out,{recursive:true});
const source=arg('--source-root',path.join(pkg,'sources/extraction'));
const {createCanvas,loadImage}=createRequire(path.join(repo,'package.json'))('@napi-rs/canvas');
const recipe=JSON.parse(fs.readFileSync(path.join(source,'extraction-recipe.json')));
const palette=[[248,104,120],[248,128,128],[240,80,104],[26,27,38]];
const frames=[];
for(const f of recipe.frames){
 const img=await loadImage(path.join(source,f.sourceRgba)),c=createCanvas(img.width,img.height),ctx=c.getContext('2d');ctx.drawImage(img,0,0);
 const raw=ctx.getImageData(0,0,c.width,c.height);
 for(let i=0;i<raw.data.length;i+=4){if(raw.data[i+3]<240){raw.data[i+3]=0;continue;}const rgb=palette.toSorted((a,b)=>a.reduce((s,v,k)=>s+(v-raw.data[i+k])**2,0)-b.reduce((s,v,k)=>s+(v-raw.data[i+k])**2,0))[0];raw.data.set([...rgb,255],i);}
 const target=[23+f.targetLocal[0],43+f.targetLocal[1]],scale=recipe.bodyScale;
 const local=f.contactSource.map((v,k)=>v-f.cropBox[k]),translation=target.map((v,k)=>v-local[k]*scale);
 const bounds={x:Math.floor(translation[0]),y:Math.floor(translation[1])};bounds.w=Math.ceil(translation[0]+c.width*scale)-bounds.x;bounds.h=Math.ceil(translation[1]+c.height*scale)-bounds.y;
 const surface=createCanvas(bounds.w,bounds.h),sx=surface.getContext('2d'),pixels=sx.createImageData(bounds.w,bounds.h);
 for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){
  const u=Math.floor((bounds.x+x+.5-translation[0])/scale),v=Math.floor((bounds.y+y+.5-translation[1])/scale);
  if(u>=0&&v>=0&&u<c.width&&v<c.height){const a=(v*c.width+u)*4;pixels.data.set(raw.data.slice(a,a+4),(y*bounds.w+x)*4);}
 }
 sx.putImageData(pixels,0,0);
 const logical=createCanvas(66,72);logical.getContext('2d').drawImage(surface,bounds.x,bounds.y);
 fs.writeFileSync(path.join(out,f.side+'-logical.png'),logical.toBuffer('image/png'));
 const big=createCanvas(528,576);big.getContext('2d').imageSmoothingEnabled=false;big.getContext('2d').drawImage(logical,0,0,528,576);fs.writeFileSync(path.join(out,f.side+'-8x.png'),big.toBuffer('image/png'));
 const cut=f.openProximalCutSource.map(p=>p.map((v,k)=>target[k]+(v-f.contactSource[k])*scale));
 frames.push({side:f.side,src:f.side+'-logical.png',exact8x:f.side+'-8x.png',size:[66,72],origin:[0,0],sourceRgba:'sources/extraction/'+f.sourceRgba,scaleArtPerSourcePixel:scale,observedContactBoundary:target,normal:f.normal,anatomicalShoulder:f.side==='left'?[4.5,45.5]:[61.5,45.5],sourceContactBoundary:f.contactSource,sourceOpenCut:f.openProximalCutSource,worldOpenCut:cut,visibleProximalCutCenter:cut[0].map((v,k)=>(v+cut[1][k])/2),fullWidth:Math.hypot(cut[1][0]-cut[0][0],cut[1][1]-cut[0][1]),bounds,ownership:f.ownership});
}
fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify({schema:'dango-source-contact-pose-candidate/1',packageId:'sip-front-v1',runtimeReady:false,status:'candidate; independent validation pending',action:'sip-tea',view:'front',baseCup:[23,43],cupRect:[0,0,22,19],fixedSourcePolicy:'Quantize and project once at p0. Every phase draws identical logical pixels at originalCup(p)-[23,43]. No source switch, rotation, resampling or per-phase quantization.',palette,sourceAlphaThreshold:240,sourcePixelDecode:'@napi-rs/canvas decode/readback, matching original audit; source RGB is preserved separately in extraction PNGs.',frames},null,2)+'\n');
