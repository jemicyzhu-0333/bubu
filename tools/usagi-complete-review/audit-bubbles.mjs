// Bounded diagnostic capture only: production scene + body + overlay, four requests and two facings.
// Example: node tools/usagi-complete-review/audit-bubbles.mjs --canvas-package=/existing/package --label=new-capture
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const out=path.resolve(root,'dist/usagi-complete-review/actions/bubble-composite',arg('label')||'capture');
if(fs.existsSync(path.join(out,'manifest.json')))throw new Error('Choose a new --label to preserve existing evidence');
const packagePath=arg('canvas-package');
if(!packagePath)throw new Error('Pass --canvas-package=/absolute/path/to/existing/@napi-rs/canvas');
const require=createRequire(import.meta.url),backend=require(packagePath);
const imp=file=>import(pathToFileURL(path.join(root,file)));
const {installOffscreenImages}=await imp('tools/usagi-gallery/offscreen-images.mjs');installOffscreenImages(backend);
globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const {loadSource,createRenderHarness}=await imp('tools/usagi-gallery/runtime-harness.mjs');
const {applyPoint,multiply,localMatrix}=await imp('src/capabilities/companion/presentation/rig/pose.mjs');
const {projectEffectOrigins}=await imp('src/surfaces/pet/effect-origin.mjs');
const {snapToPetDevicePixel}=await imp('src/core/pet-stage.mjs');
const source=await loadSource(pathToFileURL(root).href), action=source.behaviors.PET_ACTIONS['bubble-blow'];
fs.mkdirSync(out,{recursive:true});
const times=[900,2250,3600,4950,6300,8100];
const sourceHashes={};
function hashTree(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const f=path.posix.join(dir,e.name);if(e.isDirectory())hashTree(f);else sourceHashes[f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');}}
hashTree('src');hashTree('assets/companion/usagi');
const manifest={sourceHashes,generatedAt:new Date().toISOString(),label:arg('label')||'capture',renderer:'Exact production renderer + body/scene/overlay, deterministic 30fps stepping',bodyWidthsCSS:[99,198],stageCss:220,rows:[]};
for(const requestedView of ['front','three-quarter','profile','back'])for(const facing of [1,-1]){
 const h=createRenderHarness(source,{skin:'usagi',outfit:false,view:requestedView,facing,dpr:2,blink:false});h.select('action','bubble-blow');
 const view=source.formArt.resolveView(h.form,requestedView,{action,state:'idle'});
 const ctx=h.body.getContext('2d'),getTransform=ctx.getTransform.bind(ctx);let capturedMatrix;
 ctx.getTransform=()=>{const m=getTransform();capturedMatrix=m;return m;};
 const normal=backend.createCanvas(1320,250),expanded=backend.createCanvas(2640,470),annotated=backend.createCanvas(1320,250);
 const composite=backend.createCanvas(440,440),cs=normal.getContext('2d'),ce=expanded.getContext('2d'),ca=annotated.getContext('2d');
 const name=`${requestedView}-facing${facing}`;
 for(const [c,w] of [[cs,1320],[ce,2640],[ca,1320]]){c.fillStyle='#eef3f3';c.fillRect(0,0,w,w===2640?470:250);c.fillStyle='#273844';c.font='14px sans-serif';c.fillText(`bubble-blow | requested ${requestedView} -> actual ${view} | facing ${facing} | ${w===2640?198:99} CSS body width`,10,18);}
 let at=0,latest;const samples=[];const birthRecords=[];
 for(let index=0;index<times.length;index++){
  const target=times[index];while(at<target){at=Math.min(target,at+1000/30);latest=h.draw(at);const births=latest.state.overlayParticles.filter(p=>p.life===p.baseLife||p.life===60);if(births.length)birthRecords.push({atMs:at,particles:births});}
  h.composite(composite);cs.drawImage(composite,index*220,25,220,220);ce.drawImage(composite,index*440,25,440,440);ca.drawImage(composite,index*220,25,220,220);
  const progress=target/action.duration;
  const artwork=source.formArt.resolveArtwork(h.form,{view,motion:action.motion,action,progress,elapsedMs:target,channel:`bubble-audit-${name}`,face:{eyes:'neutral',mouth:'neutral'},expressionId:action.expression});
  const data=artwork.rig.views[artwork.drawnView],prop=data.props['bubble-wand'],p=artwork.pose.sample.propPoses?.['bubble-wand'];
  const bone=artwork.pose.world[prop.bone],m=p?multiply(bone,localMatrix(data.bones[prop.bone].pivot,p)):bone;
  const ring=applyPoint(m,...applyPoint(prop.shapes[1].m,0,-7));
  const offset=source.formArt.motionOffset(h.form,action,action.motion,progress,{calmVisual:false,bodySize:h.stage.bodySize,facing,state:'idle'});
  const bob=Math.round(Math.sin(target/(1000/60)*.15)*2);
  const offX=snapToPetDevicePixel(h.stage.bodyOrigin.x+offset.x,h.stage.deviceScale),offY=snapToPetDevicePixel(h.stage.bodyOrigin.y+bob+offset.y,h.stage.deviceScale);
  const projected=projectEffectOrigins({ring},capturedMatrix,{stage:h.stage,offX,offY,formScale:h.stage.bodySize/h.form.bodySize}).ring;
  const generic={x:110+Math.cos(progress*Math.PI*4)*18,y:105+Math.sin(progress*Math.PI*3)*10};
  const fixed={x:140,y:105};
  const lastBirth=birthRecords.at(-1);
  samples.push({atMs:target,progress,ringArt:ring,ringOverlayCSS:projected,projection:{matrix:[capturedMatrix.a,capturedMatrix.b,capturedMatrix.c,capturedMatrix.d,capturedMatrix.e,capturedMatrix.f],offX,offY},artworkEffectOrigins:artwork.effectOrigins??null,legacyFixedOrigin:fixed,genericOrigin:generic,fixedDistanceCSS:Math.hypot(projected.x-fixed.x,projected.y-fixed.y),genericDistanceCSS:Math.hypot(projected.x-generic.x,projected.y-generic.y),lastBirthAt:lastBirth?.atMs,lastBirthParticles:lastBirth?.particles,visibleParticles:latest.state.overlayParticles.length});
  for(const [p,color] of [[projected,'#e33636'],[fixed,'#2579eb'],[generic,'#1ba448']]){ca.strokeStyle=color;ca.lineWidth=1;ca.strokeRect(index*220+p.x-4,25+p.y-4,8,8);}
  for(const [c,w]of[[cs,220],[ce,440],[ca,220]]){c.fillStyle='#283f48';c.font='11px sans-serif';c.fillText(`${target}ms`,index*w+4,w===440?466:247);}
 }
 const files={normal:`${name}.png`,expanded:`${name}-2x.png`,annotated:`${name}-origins.png`};
 for(const [key,c]of[['normal',normal],['expanded',expanded],['annotated',annotated]])fs.writeFileSync(path.join(out,files[key]),c.toBuffer('image/png'));
 manifest.rows.push({requestedView,resolvedView:view,facing,files,samples,birthRecords});h.dispose();console.log(name);
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
