// Read-only contacts from the real artist. Usage: node probe.mjs /path/to/bubu [action ...]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(process.argv[2]||'.');
const imp=p=>import(pathToFileURL(path.join(root,p)));
const {createCanvas,loadImage}=createRequire(root+'/package.json')('@napi-rs/canvas');
const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs');
const {contactContract,solveLimb,createDangoLimbPainter,pawLayer}=await imp('src/capabilities/companion/presentation/dango-limb-compose.mjs');
const {DANGO_RASTER:manifest}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {DANGO_ACTION_VIEWS:views}=await imp('src/content/companion/dango-action-views.mjs');
const {PET_ACTIONS:actions}=await imp('src/content/behaviors.mjs');
const {createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const source=await loadLimbSource();
if(source.state()!=='ready')throw Error(JSON.stringify(source.errors()));
const artist=createDangoRasterArtist({manifest,limbs:source,loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas});
await artist.ready({all:true});
const painter=createDangoLimbPainter({source,createSurface:createCanvas});
const count=Number(process.env.DENSE)||0;
const phases=count?Array.from({length:count+1},(_,i)=>i/count):[0,.125,.5,.875,1];
const f=n=>Number(n.toFixed(3)), xy=a=>a?.map(f);
function kind(a,h,p){
  if(h.integrated)return 'free-aux/integrated';
  if(a.id==='workout')return 'planted-support';
  if(['type-keyboard','drum-solo','high-five'].includes(a.id))return 'point-touch';
  if(a.id==='take-note')return h.side==='left'?'point-touch':'continuous-grip';
  if(a.id==='read-book')return h.side==='right'&&p>.22&&p<.72?'point-touch':'continuous-grip';
  if(['sing','tiny-chef','snack-picnic','mirror-meet'].includes(a.id))return h.side==='left'?'free-aux':'continuous-grip';
  if(a.id==='paper-plane')return p<=.28?'continuous-grip':'free-aux';
  if(a.id==='paper-return')return p>=.34&&p<.76?'free-aux':'continuous-grip';
  if(a.id==='build-blocks')return p<.64?'continuous-grip':'free-aux';
  if(['hiccup','carry-energy','dig-treasure','sneeze','bubble-blow','look-around','sip-tea','sweep','telescope','plant-water','knit-scarf','umbrella-dance','photo-pose'].includes(a.id))return 'continuous-grip';
  return 'free-aux';
}
function sample(a,view,p){
  const z=artist.resolveArtwork({action:a,motion:a.motion,view,progress:p,elapsedMs:p*a.duration});
  if(!z.ready)throw Error(a.id+' '+view+' not ready '+JSON.stringify(z.missingAssets));
  return {view:z.view,drawnView:z.drawnView,sourcePose:z.sourceContactPose||null,
    tools:z.contact?.tools||[], hands:(z.contact?.hands||[]).map(h=>{
      const ct=contactContract(h,a), target=ct?.target||h.gripPoint||h.points?.at(-1);
      const plan=ct&&solveLimb(source,{view:z.view,side:h.side,target,pose:ct.pose,contract:ct});
      const world=q=>q&&xy(plan.reflectAxis?[plan.reflectAxis-q[0],q[1]]:q);
      return {side:h.side,kind:kind(a,h,p),target:xy(target),role:ct?.role||null,pose:ct?.pose||null,
        normal:ct?.normal||null,opacity:f(h.opacity??1),legacyRoot:xy(h.points?.[0]),S:plan?world(plan.S):null,
        lengths:plan?[f(Math.hypot(...plan.U.tip.map((x,i)=>x-plan.U.root[i]))),f(Math.hypot(...plan.F.tip.map((x,i)=>x-plan.F.root[i])))]:null,
        error:plan?f(plan.error):null,contact:plan?world(plan.contact):null,paw:plan?.paw.src||null,
        E:plan?world(plan.E):null,W:plan?world(plan.W):null,angles:plan?[plan.joint.upperAngle,plan.joint.foreAngle]:null,
        direct:!!painter.plan(z.view,h,a),standard:h.limb===true,
        layer:plan?pawLayer(plan):null,sourceContact:h.sourceContact||null};})};
}
const selected=process.argv.slice(3), result=[];
for(const [id,a]of Object.entries(actions)){
  if(selected.length&&!selected.includes(id))continue;
  for(const view of views[id].allowed)result.push({id,view,prop:a.prop,motion:a.motion,phases,samples:phases.map(p=>sample(a,view,p))});
}
if(count)for(const r of result){
  r.summary=['left','right'].flatMap(side=>{
    const hs=r.samples.flatMap((s,i)=>s.hands.filter(h=>h.side===side).map(h=>({...h,p:phases[i]})));
    if(!hs.length)return [];
    const numeric=hs.filter(h=>h.error!==null), worst=numeric.reduce((a,b)=>a.error>b.error?a:b,{error:-1});
    return {side,kinds:[...new Set(hs.map(h=>h.kind))],n:hs.length,min:numeric.length?Math.min(...numeric.map(h=>h.error)):null,max:worst.error<0?null:worst.error,worstPhase:worst.p??null,worstTarget:worst.target??null,direct:hs.filter(h=>h.direct).length,standard:hs.filter(h=>h.standard).length};
  });delete r.samples;delete r.phases;
}
console.log(JSON.stringify({state:source.state(),extensions:source.manifest().extensions,phases:count?count+1:phases,result}));
artist.dispose();painter.dispose();
