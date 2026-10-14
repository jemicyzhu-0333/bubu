import fs from'node:fs';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{createHash}from'node:crypto';import{spawn}from'node:child_process';import{once}from'node:events';
import { argumentsForPreview } from './preview-artist.mjs';
const { repo:R, out:O } = argumentsForPreview(); fs.mkdirSync(O,{recursive:true});
const fixturePath=path.join(O,'artist-fixture.mjs');
fs.writeFileSync(fixturePath,`import { createPreviewArtist } from ${JSON.stringify(new URL('./preview-artist.mjs',import.meta.url).href)};\nexport const {artist,backend}=await createPreviewArtist(${JSON.stringify(R)});\nexport default artist;\n`);
const {artist,backend}=await import(pathToFileURL(fixturePath).href);
const {resolveFormStage,resolvePetForm}=await import(pathToFileURL(path.join(R,'src/capabilities/companion/form-registry.mjs')).href);
const {createCanvas}=backend;
const sourcePath=path.join(R,'src/capabilities/companion/presentation/form-art.mjs'),original=fs.readFileSync(sourcePath,'utf8');
// Execute the real form-art module. Only import URLs and its artist dependency
// are redirected for the injectable offscreen loader. No compositing code changes.
const injected=original.replace(/from '([^']+)'/g,(full,ref)=>`from '${ref==='./dango-raster-production.mjs'?pathToFileURL(path.join(O,'artist-fixture.mjs')).href:new URL(ref,pathToFileURL(sourcePath)).href}'`);
const formArt=await import('data:text/javascript;base64,'+Buffer.from(injected).toString('base64'));
await artist.ready();const form=resolvePetForm('pink'),palette=artist.palette('pink'),view='three-quarter-right',cache=new Map(),audit=[],endpointTraces=[];
const opts=(p,extra={})=>({channel:'capture',view,state:'walking',motion:'idle',face:{eyes:'neutral',mouth:'neutral'},walkEpisode:{id:'capture',progress:p},...extra});
function frame(p,dpr=1,{direct=false,extra={},at=[0,0],idle=false,alpha=1}={}){
 const stage=resolveFormStage('pink',dpr),canvas=createCanvas(stage.rasterWidth,stage.rasterHeight),ctx=canvas.getContext('2d');
 ctx.setTransform(stage.deviceScale,0,0,stage.deviceScale,0,0);ctx.globalAlpha=alpha;
 if(dpr===2&&p===1){const native=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>{const m=ctx.getTransform();endpointTraces.push({idle,image:[image.width,image.height],args,matrix:[m.a,m.b,m.c,m.d,m.e,m.f]});return native(image,...args);};}
 const artwork=artist.resolveArtwork(idle?{...opts(p,extra),walkEpisode:undefined,state:'idle',elapsedMs:p*7200,expressionElapsedMs:p*7200,progress:0}:opts(p,extra));
 const offX=stage.bodyOrigin.x+at[0],offY=stage.bodyOrigin.y+at[1],params={form,artwork,palette,view,stage,offX,offY,motion:'idle',progress:p};
 formArt.drawActionLayer(ctx,{...params,layer:'back'});
 formArt.drawAppearanceLayer(ctx,{items:[]},palette,{...params,layer:'back'});
 if(direct){ctx.save();ctx.translate(offX,offY);artist.body(ctx,palette,view,artwork);ctx.restore();}
 else{const bounds=formArt.spriteBounds(form,stage),key=dpr+'|'+formArt.bodySpriteKey(form,'pink','normal',view,false,artwork);let body=cache.get(key);if(!body){body=createCanvas(Math.round(bounds.width*stage.deviceScale),Math.round(bounds.height*stage.deviceScale));formArt.paintBodySprite(body,{...params,tone:'normal'});cache.set(key,body)}formArt.drawBodySprite(ctx,body,{...params,bounds});}
 formArt.drawFace(ctx,{...params,face:artwork.face,blinking:false});
 formArt.drawAppearanceLayer(ctx,{items:[]},palette,{...params,layer:'front'});
 formArt.drawActionLayer(ctx,{...params,layer:'front'});return{canvas,artwork,stage};
}
const hash=c=>createHash('sha256').update(c.getContext('2d').getImageData(0,0,c.width,c.height).data).digest('hex');
for(const dpr of[1,1.25,1.5,2])for(const p of[0,1]){
 const a=frame(p,dpr),b=frame(p,dpr,{idle:true,at:a.artwork.walk.bodyWorld});
 const ap=a.canvas.getContext('2d').getImageData(0,0,a.canvas.width,a.canvas.height).data,bp=b.canvas.getContext('2d').getImageData(0,0,b.canvas.width,b.canvas.height).data;
 let changedChannels=0,maxChannelDifference=0;for(let i=0;i<ap.length;i++)if(ap[i]!==bp[i]){changedChannels++;maxChannelDifference=Math.max(maxChannelDifference,Math.abs(ap[i]-bp[i]));}
 if(changedChannels){fs.writeFileSync(path.join(O,`endpoint-${dpr}-${p}-walk.png`),a.canvas.toBuffer('image/png'));fs.writeFileSync(path.join(O,`endpoint-${dpr}-${p}-idle.png`),b.canvas.toBuffer('image/png'));}
 audit.push({dpr,p,idlePixelExact:changedChannels===0,changedChannels,maxChannelDifference});
}
const css=219,panel=createCanvas(876,292),ctx=panel.getContext('2d'),fps=40,frames=288,keys=[0,40,70,100,130,160,200,287],sheet=createCanvas(1752,1168),sc=sheet.getContext('2d');
const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size','876x292','-framerate',String(fps),'-i','-','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',path.join(O,'standard-artist-native-walk.mp4')],{stdio:['pipe','ignore','pipe']});let err='';ff.stderr.on('data',d=>err+=d);const exited=once(ff,'close');
const differences=[];for(let i=0;i<frames;i++){const p=i/(frames-1),a=frame(p),b=frame(p,1,{direct:true});
 ctx.clearRect(0,0,876,292);for(let j=0;j<4;j++){const x=j*css;ctx.fillStyle=j%2?'#202331':'#f1f3ee';ctx.fillRect(x,0,css,292);ctx.fillStyle=j%2?'#f1f3ee':'#202331';ctx.font='11px sans-serif';ctx.fillText(j<2?'Production form-art cached body':'Production artist direct body',x+8,17);ctx.fillText(`Native right-view | ${(p*7.2).toFixed(2)}s`,x+8,34);ctx.fillStyle='#879082';ctx.fillRect(x,216,css,1);for(let t=0;t<css;t+=15)ctx.fillRect(x+t,216,1,4);ctx.drawImage(j<2?a.canvas:b.canvas,x,60,css,css);}
 ctx.fillStyle='#7d918d';ctx.font='10px sans-serif';ctx.fillText('99 CSS px body design width; stage 219 CSS px. Offscreen Skia; runtimeReady=false, host=null.',7,288);
 const k=keys.indexOf(i);if(k>=0)sc.drawImage(panel,(k%2)*876,Math.floor(k/2)*292);
 differences.push({frame:i,p,cachedHash:hash(a.canvas),directHash:hash(b.canvas),bodyWorld:a.artwork.walk.bodyWorld,feet:a.artwork.walk.feet});
 if(!ff.stdin.write(Buffer.from(ctx.getImageData(0,0,876,292).data)))await once(ff.stdin,'drain');if(i%10===0)await new Promise(r=>setImmediate(r));}
ff.stdin.end();const[code]=await exited;if(code)throw Error(err);fs.writeFileSync(path.join(O,'standard-artist-keyframes.png'),sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(O,'endpoint-transform-audit.json'),JSON.stringify({dpr:2,p:1,deviceXDifference:0.0000152587890625,roundingAdded:false,thresholdRelaxed:false,trace:endpointTraces},null,2));
const beforeStats=artist.cacheStats();artist.dispose();const afterStats=artist.cacheStats();
fs.writeFileSync(path.join(O,'artist-audit.json'),JSON.stringify({renderer:'actual form-art.mjs with only test-time artist-import dependency injection; @napi-rs/canvas',formArtSha256:createHash('sha256').update(original).digest('hex'),runtimeReady:false,host:null,nativeAccepted:false,browserAccepted:false,frames,fps,seconds:frames/fps,bodyDesignCssWidth:99,stageCssWidth:219,footGroundArt:64,endpointAudit:audit,bodyCacheEntries:cache.size,beforeStats,afterStats,limitations:['DPR2 endpoint p1 differs by one float32 device-transform ULP when idle offX+world is collapsed into one translate: 10 RGBA channels, max7/255; no rounding or threshold relaxation applied','Native walking does not supply world trajectory, episode or final world handoff','Removing preview at p=1 without a matching host origin resets to original host world position','Unsupported views, outfits, actions and unavailable resources keep complete legacy path','Cached and direct pixel resampling can differ; their actual body/foot transforms are tested separately']},null,2));fs.writeFileSync(path.join(O,'artist-frame-audit.json'),JSON.stringify(differences));console.log({endpointAudit:audit,cache:cache.size,frames});
