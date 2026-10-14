import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: {
  repo: { type: 'string' }, out: { type: 'string' },
  full: { type: 'boolean' }, smoke: { type: 'boolean' },
  outline: { type: 'boolean' }, recovery: { type: 'boolean' },
  'split-check': { type: 'boolean' }, 'handoff-sheet': { type: 'boolean' },
  sheet: { type: 'boolean' }
} });
if (!values.repo || !values.out) throw Error('Required: --repo=/absolute/repository --out=/new/output/directory');
if (!path.isAbsolute(values.repo) || !path.isAbsolute(values.out)) throw Error('Both --repo and --out must be absolute paths.');
if (values.full && values.smoke) throw Error('Choose --full or --smoke.');
const repo = path.resolve(values.repo) + path.sep;
const out = path.resolve(values.out) + path.sep;
if (out.startsWith(repo)) throw Error('Place generated audit outputs outside the repository.');
fs.mkdirSync(out, { recursive: true });
const loadModule = relative => import(pathToFileURL(path.join(repo, relative)).href);
const {createCanvas,loadImage}=createRequire(repo+'package.json')('@napi-rs/canvas');
const {createDangoRasterArtist}=await loadModule('src/capabilities/companion/presentation/dango-raster-art.mjs');
const {DANGO_RASTER}=await loadModule('assets/companion/dango/raster/dango.raster.mjs');
const {PET_ACTIONS}=await loadModule('src/content/behaviors.mjs');
const {PALETTES}=await loadModule('src/core/pet-art.mjs');
const action=PET_ACTIONS['sip-tea'];
// Freeze the original middle-column baseline even after production enables short hands.
// Only this in-memory clone changes; the imported manifest and all asset bytes remain untouched.
const baselineManifest = structuredClone(DANGO_RASTER);
const baselineGates = [];
for (const [key, sprite] of Object.entries(baselineManifest.tools)) {
  if (['sip-front-short-v1', 'sip-front-v2'].includes(sprite.sourceContactPose?.id)) {
    baselineGates.push({ key, id: sprite.sourceContactPose.id,
      importedRuntimeReady: DANGO_RASTER.tools[key].sourceContactPose.runtimeReady,
      baselineRuntimeReady: false });
    sprite.sourceContactPose.runtimeReady = false;
  }
}
if (!baselineGates.length) throw Error('No known sip source gates found in the supplied repository.');
const artist=createDangoRasterArtist({manifest:baselineManifest,loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas});
await artist.ready({all:true});
const dir=repo+'assets/companion/dango/raster/action-contact/sip-front-v1/';
const meta=JSON.parse(fs.readFileSync(dir+'frames.json'));
const plans={},diagnostics={};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const hashPaths = [
  'assets/companion/dango/raster/action-contact/sip-front-v1/left-logical.png',
  'assets/companion/dango/raster/action-contact/sip-front-v1/right-logical.png',
  'assets/companion/dango/raster/views/front/body.png',
  'assets/companion/dango/raster/tools/cup.png'
];
const inputHashes = Object.fromEntries(hashPaths.map(relative => [relative, hash(fs.readFileSync(path.join(repo, relative)))]));
fs.writeFileSync(out+'input-hashes.json', JSON.stringify(inputHashes,null,2)+'\n');
fs.writeFileSync(out+'baseline-manifest.json', JSON.stringify({ baselineGates, originalManifestUnmodified: baselineGates.every(g => DANGO_RASTER.tools[g.key].sourceContactPose.runtimeReady === g.importedRuntimeReady) },null,2)+'\n');
function pixels(c){return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
function pointSegment(q,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy);}
function components(data,w,h,threshold=127,ink=false,eight=false){const seen=new Uint8Array(w*h),sizes=[];for(let j=0;j<w*h;j++){const q=4*j;if(seen[j]||data[q+3]<=threshold||(ink&&data[q]>70))continue;const todo=[j];seen[j]=1;let n=0;for(let k=0;k<todo.length;k++){const i=todo[k],x=i%w,y=Math.floor(i/w);n++;for(const v of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1,...(eight?[x>0&&y>0?i-w-1:-1,x+1<w&&y>0?i-w+1:-1,x>0&&y+1<h?i+w-1:-1,x+1<w&&y+1<h?i+w+1:-1]:[])])if(v>=0&&!seen[v]&&data[4*v+3]>threshold&&(!ink||data[4*v]<=70)){seen[v]=1;todo.push(v);}}sizes.push(n);}return sizes.sort((a,b)=>b-a);}
for(const frame of meta.frames){
 const side=frame.side,im=await loadImage(dir+frame.src),c=createCanvas(66,72);c.getContext('2d').drawImage(im,0,0);const data=pixels(c),root=createCanvas(66,72),contour=createCanvas(66,72),rear=createCanvas(66,72),front=createCanvas(66,72);
 const rd=root.getContext('2d').createImageData(66,72),cd=contour.getContext('2d').createImageData(66,72),bd=rear.getContext('2d').createImageData(66,72),fd=front.getContext('2d').createImageData(66,72);
 const [a,b]=frame.worldOpenCut,mid=frame.visibleProximalCutCenter,tip=frame.observedContactBoundary,dx=tip[0]-mid[0],dy=tip[1]-mid[1],len=Math.hypot(dx,dy);let rootCells=[],backCells=[];
 for(let y=0;y<72;y++)for(let x=0;x<66;x++){const j=(y*66+x)*4;if(!data[j+3])continue;const boundary=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([a,b])=>a<0||a>=66||b<0||b>=72||!data[(b*66+a)*4+3]);if(boundary){cd.data.set([0,174,255,255],j);if(pointSegment([x+.5,y+.5],a,b)<=1.1){rd.data.set(data.slice(j,j+4),j);rootCells.push([x,y]);}}
 const axial=((x+.5-mid[0])*dx+(y+.5-mid[1])*dy)/len;
 if(axial<=2){bd.data.set(data.slice(j,j+4),j);backCells.push([x,y]);}else fd.data.set(data.slice(j,j+4),j);
 }
 root.getContext('2d').putImageData(rd,0,0);contour.getContext('2d').putImageData(cd,0,0);rear.getContext('2d').putImageData(bd,0,0);front.getContext('2d').putImageData(fd,0,0);
 plans[side]={frame,im,root,contour,rear,front};diagnostics[side]={sha256:hash(fs.readFileSync(dir+frame.src)),components4:components(data,66,72),inkComponents4:components(data,66,72,127,true),inkComponents8:components(data,66,72,127,true,true),rootBoundaryCells:rootCells,splitRearCells:backCells,splitUnionByteIdentical:[...data].every((v,k)=>v===Math.max(bd.data[k],fd.data[k]))};
}
function resolve(p,key='preferred-sip-audit',a=action,view='front'){const art=artist.resolveArtwork({action:a,motion:a?.motion||'idle',view,progress:p,elapsedMs:p*(a?.duration||1),channel:'pet',actionInstanceKey:key});if(['sip-front-short-v1','sip-front-v2'].includes(art.sourceContactPose))throw Error('Original baseline unexpectedly activated a sip source selector.');return art;}
function variant(old,kind='preferred'){
 const cup=old.contact?.tools.find(t=>t.key==='cup');if(!cup)return old;const delta=[cup.x-23,cup.y-43];
 return {...old,limbPainter:{paint(ctx,{hand,layer,covered}){const plan=plans[hand.side];if(!plan)return false;let im=null;if(kind==='split'){if(layer==='back')im=plan.rear;if(layer==='front'&&!covered)im=plan.front;}else if(layer==='front'&&!covered)im=kind==='root'?plan.root:kind==='contour'?plan.contour:plan.im;if(im){ctx.save();ctx.imageSmoothingEnabled=false;ctx.globalAlpha*=hand.opacity??1;ctx.drawImage(im,...delta);ctx.restore();}return true;}},contact:{...old.contact,hands:old.contact.hands.map(h=>({...h,limb:true}))}};
}
function stage(ctx,p,scale,tx=0,ty=0,a=action){ctx.translate(tx,ty);ctx.scale(scale,scale);artist.applyMotionTransform(ctx,a?.motion||'idle',p,{action:a,bodySize:66,size:146,translate:(x,y)=>ctx.translate(x,y)});const off=artist.motionOffset(a?.motion||'idle',p,false,{action:a});ctx.translate(40+off.x,40+off.y);return ctx.getTransform();}
function render(p,dpr,old,part='full',kind='preferred',a=action){const size=Math.ceil(146*1.5*dpr),c=createCanvas(size,size),ctx=c.getContext('2d'),matrix=stage(ctx,p,1.5*dpr,0,0,a);let art=variant(old,kind);const opts={action:a,artwork:art,palette:PALETTES.pink,view:art.view,progress:p};
 if(part==='body')artist.body(ctx,PALETTES.pink,art.view,{...art,contact:{...art.contact,hands:[]}});
 else if(part==='face')artist.face(ctx,PALETTES.pink,{},false,art.view,null,art);
 else if(part==='full'){artist.action(ctx,{...opts,layer:'back'});artist.body(ctx,PALETTES.pink,art.view,art);artist.face(ctx,PALETTES.pink,{},false,art.view,null,art);artist.action(ctx,{...opts,layer:'front'});}
 else{art={...art,hiddenParts:['ear-left','ear-right','foot-left','foot-right'],contact:{...art.contact,hands:part==='left'||part==='right'?art.contact.hands.filter(h=>h.side===part):[],tools:part==='cup'?art.contact.tools.filter(t=>t.key==='cup'):[],details:[]}};artist.action(ctx,{...opts,artwork:art,layer:'back'});artist.action(ctx,{...opts,artwork:art,layer:'front'});}
 return{c,data:pixels(c),matrix,w:size,h:size};}
function at(m,q){return[m.a*q[0]+m.c*q[1]+m.e,m.b*q[0]+m.d*q[1]+m.f];}
function gap(hand,cup,target){const center=at(hand.matrix,target),r=4*Math.hypot(hand.matrix.a,hand.matrix.b),hs=[],cs=[];for(let y=Math.max(0,Math.floor(center[1]-r));y<Math.min(hand.h,Math.ceil(center[1]+r));y++)for(let x=Math.max(0,Math.floor(center[0]-r));x<Math.min(hand.w,Math.ceil(center[0]+r));x++){const j=(y*hand.w+x)*4;if(hand.data[j+3]>127)hs.push([x,y]);if(cup.data[j+3]>127)cs.push([x,y]);}let box=Infinity,centers=Infinity,overlap=0;for(const a of hs)for(const b of cs){const dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);if(!dx&&!dy)overlap++;box=Math.min(box,Math.hypot(Math.max(0,dx-1),Math.max(0,dy-1)));centers=Math.min(centers,Math.hypot(dx,dy));}return{boxGapDevicePx:box,centerDistanceDevicePx:centers,overlapDevicePixels:overlap,handNeighborhoodPixels:hs.length,cupNeighborhoodPixels:cs.length};}
function measure(p,dpr,old,a=action){const body=render(p,dpr,old,'body','preferred',a),face=render(p,dpr,old,'face','preferred',a),cup=render(p,dpr,old,'cup','preferred',a),cupPose=old.contact.tools.find(t=>t.key==='cup'),delta=[cupPose.x-23,cupPose.y-43];const rec={p,dpr,cup:cupPose,delta,sides:{}};for(const side of ['left','right']){const hand=render(p,dpr,old,side,'preferred',a),root=render(p,dpr,old,side,'root',a);let faceOverlap=0,rootOpaque=0,rootOutside=0,rootBelow240=0,rootMinBodyAlpha=255,rootMaxResidual=0,rootInsideVisible=0,bodyOverlap=0;for(let i=3;i<hand.data.length;i+=4){if(hand.data[i]&&face.data[i])faceOverlap++;if(hand.data[i]&&body.data[i])bodyOverlap++;if(root.data[i]){rootOpaque++;if(!body.data[i])rootOutside++;if(body.data[i]<240)rootBelow240++;if(body.data[i]===255)rootInsideVisible++;rootMinBodyAlpha=Math.min(rootMinBodyAlpha,body.data[i]);rootMaxResidual=Math.max(rootMaxResidual,root.data[i]*(1-body.data[i]/255));}}
 const target=plans[side].frame.observedContactBoundary.map((x,k)=>x+delta[k]);rec.sides[side]={contact:gap(hand,cup,target),faceOverlapPixels:faceOverlap,handBodyOverlapPixels:bodyOverlap,rootPixels:rootOpaque,rootOutsideBodyPixels:rootOutside,rootBodyAlphaBelow240Pixels:rootBelow240,rootMinBodyAlpha,rootMaxResidualIfBehind:rootMaxResidual,rootVisibleInFrontInsideOpaqueBodyPixels:rootInsideVisible,alphaComponents4:components(hand.data,hand.w,hand.h),inkComponents4:components(hand.data,hand.w,hand.h,127,true)};
 for(const v of [hand,root])v.c.width=1;
 }for(const v of [body,face,cup])v.c.width=1;return rec;}
function compose(ctx,p,old,x,y,scale,kind,a=action){ctx.save();stage(ctx,p,scale,x,y,a);const art=variant(old,kind),opts={action:a,artwork:art,palette:PALETTES.pink,view:art.view,progress:p};artist.action(ctx,{...opts,layer:'back'});artist.body(ctx,PALETTES.pink,art.view,art);artist.face(ctx,PALETTES.pink,{},false,art.view,null,art);artist.action(ctx,{...opts,layer:'front'});ctx.restore();}
function indicators(ctx,p,old,x,y,scale){ctx.save();stage(ctx,p,scale,x,y);const cup=old.contact.tools.find(t=>t.key==='cup'),dx=cup.x-23,dy=cup.y-43;for(const {frame,contour} of Object.values(plans)){ctx.save();ctx.globalAlpha=.52;ctx.imageSmoothingEnabled=false;ctx.drawImage(contour,dx,dy);ctx.restore();ctx.strokeStyle='#ffcc00';ctx.lineWidth=.6;ctx.beginPath();frame.worldOpenCut.forEach((q,i)=>i?ctx.lineTo(q[0]+dx,q[1]+dy):ctx.moveTo(q[0]+dx,q[1]+dy));ctx.stroke();ctx.fillStyle='#22e28c';ctx.beginPath();ctx.arc(frame.observedContactBoundary[0]+dx,frame.observedContactBoundary[1]+dy,.75,0,Math.PI*2);ctx.fill();}ctx.restore();}
function sheet(phases,name){const c=createCanvas(1100,phases.length*480),ctx=c.getContext('2d');ctx.fillStyle='#ede9e2';ctx.fillRect(0,0,c.width,c.height);for(const [i,p]of phases.entries()){const old=resolve(p),y=i*480;for(const [j,kind]of ['preferred','split'].entries()){const x=j*400;ctx.fillStyle='#222';ctx.font='14px sans-serif';ctx.fillText(`${kind==='preferred'?'Preferred: unchanged middle-column painter':'Diagnostic: proximal 2 art units behind body'} | p=${p}`,x+12,y+22);compose(ctx,p,old,x+70,y+25,1.5,kind);ctx.fillStyle='#24272e';ctx.fillRect(x,y+218,400,262);compose(ctx,p,old,x-20,y+167,3,kind);}ctx.fillStyle='#222';ctx.font='12px sans-serif';ctx.fillText('Source contour cyan; true cut yellow;',811,y+22);ctx.fillText('contact green. Diagnostics only.',811,y+39);compose(ctx,p,old,770,y+94,3,'preferred');indicators(ctx,p,old,770,y+94,3);ctx.fillText('99 / 198 CSS px body design width',811,y+444);ctx.fillText('Offscreen actual artist, not native host',811,y+464);}fs.writeFileSync(out+name,c.toBuffer('image/png'));c.width=1;}
if(process.argv.includes('--split-check')) {
 const rows=[];
 for(const p of [0,.5])for(const dpr of [1,1.25,1.5,2]){const old=resolve(p),a=render(p,dpr,old,'full','preferred'),b=render(p,dpr,old,'full','split'),body=render(p,dpr,old,'body');let changedPixels=0,maxChannelDelta=0;for(let k=0;k<a.data.length;k+=4){if([0,1,2,3].some(j=>a.data[k+j]!==b.data[k+j]))changedPixels++;maxChannelDelta=Math.max(maxChannelDelta,...[0,1,2].map(j=>Math.abs(a.data[k+j]-b.data[k+j])));}const cup=old.contact.tools.find(t=>t.key==='cup'),delta=[cup.x-23,cup.y-43],sides={};for(const [side,plan]of Object.entries(plans)){const data=pixels(plan.front),frontier=[];for(let y=0;y<72;y++)for(let x=0;x<66;x++){const k=(y*66+x)*4;if(!data[k+3])continue;const rear=pixels(plan.rear),neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];if(!neighbors.some(([xx,yy])=>xx>=0&&xx<66&&yy>=0&&yy<72&&rear[(yy*66+xx)*4+3]))continue;const q=at(b.matrix,[x+.5+delta[0],y+.5+delta[1]]),j=(Math.floor(q[1])*b.w+Math.floor(q[0]))*4;frontier.push({sourceCell:[x,y],sourceInk:data[k]<70,bodyAlpha:body.data[j+3],rgbDistanceToBody:Math.hypot(...[0,1,2].map(z=>b.data[j+z]-body.data[j+z]))});}const colored=frontier.filter(v=>!v.sourceInk);sides[side]={coloredFrontierCells:colored.length,coloredNonzeroBoundaryCells:colored.filter(v=>v.rgbDistanceToBody>0).length,maxColoredRgbDistanceToBody:Math.max(...colored.map(v=>v.rgbDistanceToBody)),frontierSourceCells:frontier.length,nonzeroColorBoundaryCells:frontier.filter(v=>v.rgbDistanceToBody>0).length,maxRgbDistanceToBody:Math.max(...frontier.map(v=>v.rgbDistanceToBody)),minBodyAlpha:Math.min(...frontier.map(v=>v.bodyAlpha)),frontier};}rows.push({p,dpr,changedPixels,maxChannelDelta,sides});for(const v of [a,b,body])v.c.width=1;if(global.gc)global.gc();}
 fs.writeFileSync(out+'split-static-report.json',JSON.stringify({status:'One complementary split only; changed composite pixels and new source-frontier color steps, not a perceptual naturalness score',rows},null,2));console.log(JSON.stringify(rows.map(({p,dpr,changedPixels,sides})=>({p,dpr,changedPixels,sides:Object.fromEntries(Object.entries(sides).map(([k,v])=>[k,{frontierSourceCells:v.frontierSourceCells,nonzeroColorBoundaryCells:v.nonzeroColorBoundaryCells,maxRgbDistanceToBody:v.maxRgbDistanceToBody}]))}))));artist.dispose();process.exit(0);
}
if(process.argv.includes('--outline')) {
 const rows=[];
 for(let i=0;i<=256;i++){const p=i/256,old=resolve(p);for(const dpr of [1,1.25,1.5,2]){const cup=render(p,dpr,old,'cup');for(const side of ['left','right']){const h=render(p,dpr,old,side),union=new Uint8ClampedArray(h.data.length);for(let k=0;k<union.length;k++)union[k]=Math.max(h.data[k],cup.data[k]);rows.push({p,dpr,side,sourceInkComponents8:diagnostics[side].inkComponents8,rasterInkComponents8:components(h.data,h.w,h.h,127,true,true),handCupAlphaComponents4:components(union,h.w,h.h)});h.c.width=1;}cup.c.width=1;}if(global.gc)global.gc();}
 const summary={samples:rows.length,maxInkComponents8:Math.max(...rows.map(r=>r.rasterInkComponents8.length)),maxHandCupAlphaComponents4:Math.max(...rows.map(r=>r.handCupAlphaComponents4.length)),inkComponentCounts:[...new Set(rows.map(r=>r.rasterInkComponents8.length))]};fs.writeFileSync(out+'outline-report.json',JSON.stringify({status:'Both original source outlines contain two separate 8-connected ink arcs by design; alpha silhouettes and hand-cup composites checked separately',summary,rows},null,2));console.log(JSON.stringify(summary));artist.dispose();process.exit(0);
}
if(process.argv.includes('--handoff-sheet')) {
 const c=createCanvas(920,580),ctx=c.getContext('2d');ctx.fillStyle='#ede9e2';ctx.fillRect(0,0,c.width,c.height);
 for(const [i,t]of [.5,.7,.85,1].entries()){const p=.86+.14*t,z=Math.max(0,Math.min(1,(t-.15)/.55)),a={...action,handoffRecovery:t,propOpacity:1-z*z*(3-2*z)},old=resolve(p,'handoff-sheet',a),x=i*230;
 ctx.fillStyle='#222';ctx.font='13px sans-serif';ctx.fillText(`recovery t=${t} | p=${p.toFixed(3)}`,x+8,22);ctx.fillText(`cup alpha=${a.propOpacity.toFixed(2)}`,x+8,42);ctx.fillText(`hand alpha=${(old.contact.hands[0].opacity??1).toFixed(2)}`,x+8,61);
 compose(ctx,p,old,x-12,57,1.5,'preferred',a);
 const geom={...old,contact:{...old.contact,hands:old.contact.hands.map(h=>({...h,opacity:1}))}};ctx.fillStyle='#24272e';ctx.fillRect(x,293,230,287);ctx.fillStyle='#ddd';ctx.fillText('Unfaded geometry audit below',x+8,314);compose(ctx,p,geom,x-125,257,3,'preferred',{...a,propOpacity:1});
 }
 fs.writeFileSync(out+'handoff-extremes-comparison.png',c.toBuffer('image/png'));artist.dispose();process.exit(0);
}
if(process.argv.includes('--recovery')) {
 const smooth=t=>{const v=Math.max(0,Math.min(1,t));return v*v*(3-2*v);};
 const start=Number(process.env.AUDIT_START??0),end=Number(process.env.AUDIT_END??256);
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>256||start>end)throw Error('Expected integer recovery bounds 0 <= start <= end <= 256.');
 if(process.argv.includes('--full')&&end-start>31)throw Error('Use bounded recovery batches of at most32 phases; see run-recovery.py.');
 const values=process.argv.includes('--full')?Array.from({length:end-start+1},(_,i)=>(start+i)/256):[0,1e-8,.15,.5,.6,.7,.85,1];
 const rows=[];
 for(const t of values){const p=.86+.14*t,a={...action,handoffRecovery:t,propOpacity:1-smooth((t-.15)/.55)},old=resolve(p,'handoff-audit',a);
  const geom={...old,contact:{...old.contact,hands:old.contact.hands.map(h=>({...h,opacity:1})),tools:old.contact.tools.map(v=>({...v,opacity:1}))}};
  for(const dpr of [1,1.25,1.5,2])rows.push({t,p,dpr,propOpacity:a.propOpacity,handOpacity:old.contact.hands.map(h=>({side:h.side,opacity:h.opacity??1})),actual:measure(p,dpr,old,a),unfadedGeometry:measure(p,dpr,geom,{...a,propOpacity:1})});
  if(global.gc)global.gc();
 }
 const flat=rows.flatMap(r=>Object.entries(r.unfadedGeometry.sides).map(([side,m])=>({...m,t:r.t,dpr:r.dpr,side}))),summary={recoverySamples:values.length,rasterSamples:rows.length,maxUnfadedContactGap:Math.max(...flat.map(m=>m.contact.boxGapDevicePx)),rootOutsideBodyPixels:flat.reduce((s,m)=>s+m.rootOutsideBodyPixels,0),rootBelow240Pixels:flat.reduce((s,m)=>s+m.rootBodyAlphaBelow240Pixels,0),faceOverlapPixels:flat.reduce((s,m)=>s+m.faceOverlapPixels,0),failingRootSamples:flat.filter(m=>m.rootOutsideBodyPixels>0).map(m=>({t:m.t,dpr:m.dpr,side:m.side,pixels:m.rootOutsideBodyPixels}))};
 fs.writeFileSync(out+(process.argv.includes('--full')?`recovery-batch-${start}-${end}.json`:'recovery-extremes-report.json'),JSON.stringify({status:'Exact unchanged source forced through genuine handoffRecovery cup drop; unfaded geometry separately measured so fading cannot hide cut exposure',summary,rows},null,2));console.log(JSON.stringify(summary));artist.dispose();process.exit(0);
}
const full=process.argv.includes('--full'),indices=full?Array.from({length:257},(_,i)=>i):[0,128];const rows=[];for(const i of indices){const p=i/256,old=resolve(p);for(const dpr of [1,1.25,1.5,2])rows.push(measure(p,dpr,old));if(i%32===0)console.log(JSON.stringify({phase:i,of:256}));if(global.gc)global.gc();}
const flat=rows.flatMap(r=>Object.entries(r.sides).map(([side,x])=>({...x,p:r.p,dpr:r.dpr,side})));const summary={phaseCount:indices.length,dprs:[1,1.25,1.5,2],samples:rows.length,sideSamples:flat.length,maxHandCupBoxGapDevicePx:Math.max(...flat.map(r=>r.contact.boxGapDevicePx)),maxHandCupCenterDistanceDevicePx:Math.max(...flat.map(r=>r.contact.centerDistanceDevicePx)),rootOutsideBodyPixels:flat.reduce((s,r)=>s+r.rootOutsideBodyPixels,0),rootBodyAlphaBelow240Pixels:flat.reduce((s,r)=>s+r.rootBodyAlphaBelow240Pixels,0),minRootBodyAlpha:Math.min(...flat.map(r=>r.rootMinBodyAlpha)),faceOverlapPixels:flat.reduce((s,r)=>s+r.faceOverlapPixels,0),maxAlphaComponents4:Math.max(...flat.map(r=>r.alphaComponents4.length)),maxInkComponents4:Math.max(...flat.map(r=>r.inkComponents4.length)),rootForegroundInternalSeamPresent:flat.some(r=>r.rootVisibleInFrontInsideOpaqueBodyPixels>0)};
const report={status:'Read-only QA of exact preferred middle-column oldDiagnostic; no production/gate/asset changes',backend:'@napi-rs/canvas offscreen actual repository artist, including stage transform; not native host',rootDefinition:'Original source-alpha boundary cells whose centers are within 1.1 art units of authored worldOpenCut segment. Original outer contour elsewhere is not a root. Exposed means actual body alpha is zero; below-240 is separately reported. Foreground roots remain visible over body, so geometric containment is not visual burial.',contactDefinition:'Minimum distance between closed device-pixel squares in a 4-art-unit radius about registered target, alpha>127. Zero means touching or overlapping, reported alongside overlap and center distance.',splitDiagnostic:'Original fixed 66x72 RGBA partition only: cell center axial distance <=2 art units from authored cut center goes behind body; complement stays foreground. No deleted/source-painted/rescaled cells. This is one unapproved static depth experiment, not a recommended solution.',baselineGates,inputHashes,diagnostics,summary,rows};
fs.writeFileSync(out+(full?'full-report.json':'two-phase-report.json'),JSON.stringify(report,null,2)+'\n');if(values.sheet)sheet([0,.5],full?'two-phase-comparison-final.png':'two-phase-comparison.png');console.log(JSON.stringify(summary));artist.dispose();
