import fs from'node:fs';import{createHash}from'node:crypto';import path from 'node:path';import{pathToFileURL}from'node:url';import{createPreviewArtist,argumentsForPreview}from'./preview-artist.mjs';
const {repo,out}=argumentsForPreview();fs.mkdirSync(out,{recursive:true});const{artist,backend}=await createPreviewArtist(repo);
const{resolveFormStage}=await import(pathToFileURL(path.join(repo,'src/capabilities/companion/form-registry.mjs')).href);
const{createCanvas}=backend;await artist.ready();const palette=artist.palette('pink'),rows=[];
for(const dpr of[1,1.25,1.5,2]){const stage=resolveFormStage('pink',dpr),c=createCanvas(stage.rasterWidth,stage.rasterHeight),ctx=c.getContext('2d'),last=new Map;let checked=0,minBottom=Infinity,maxBottom=-Infinity,bodyCacheKeys=new Set;
 for(let i=0;i<=160;i++){const p=i/160,art=artist.resolveArtwork({view:'three-quarter-right',state:'walking',motion:'idle',face:{eyes:'neutral',mouth:'neutral'},walkEpisode:{id:'audit',progress:p}});bodyCacheKeys.add(art.key);
  for(const foot of art.walk.feet){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);ctx.scale(stage.deviceScale,stage.deviceScale);ctx.translate(40,40);const mask={...art,hiddenParts:['ear-left','ear-right',foot.key==='foot-left'?'foot-right':'foot-left']};artist.action(ctx,{artwork:mask,view:art.view,palette,layer:'back'});const data=ctx.getImageData(0,0,c.width,c.height).data,hash=createHash('sha256').update(data).digest('hex'),prior=last.get(foot.key);let bottom=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3])bottom=y;
   if(foot.support){minBottom=Math.min(minBottom,bottom);maxBottom=Math.max(maxBottom,bottom);if(prior?.support){if(hash!==prior.hash)throw Error(`planted pixels drift ${dpr} ${i} ${foot.key}`);checked++;}}
   last.set(foot.key,{support:foot.support,hash});
  }if(i%10===0)await new Promise(r=>setImmediate(r));
 }rows.push({dpr,plantedAdjacentFramesChecked:checked,plantedPixelsExact:true,minSupportBottomDeviceY:minBottom,maxSupportBottomDeviceY:maxBottom,bottomDriftDevicePixels:maxBottom-minBottom,bodyCacheKeys:bodyCacheKeys.size});}
artist.dispose();fs.writeFileSync(path.join(out,'contact-audit.json'),JSON.stringify({renderer:'same standard artist.action back pass, per-foot isolated actual native raster pixels',groundArt:64,rows},null,2));console.log(rows);
