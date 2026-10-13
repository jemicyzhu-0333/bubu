// Read-only actual-artist contact regression. No source writes; only one supplied root.
// Usage: node compare.mjs --repo REPO --out OUTPUT_DIR [--steps 1024]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {registeredComparisonSources,cliOptions} from './registration-sources.mjs';
const options=cliOptions(process.argv.slice(2));
const root=path.resolve(options.repo),out=path.resolve(options.out),steps=options.steps;
fs.mkdirSync(out,{recursive:true});
const imp=p=>import(pathToFileURL(path.join(root,p)));
const {createCanvas,loadImage}=createRequire(root+'/package.json')('@napi-rs/canvas');
const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs');
const {contactContract,solveLimb,createDangoLimbPainter,pawLayer,composeLimb,DANGO_LIMB_BOX:box}=await imp('src/capabilities/companion/presentation/dango-limb-compose.mjs');
const {DANGO_RASTER:manifest}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {DANGO_ACTION_VIEWS:views}=await imp('src/content/companion/dango-action-views.mjs');
const {PET_ACTIONS:actions}=await imp('src/content/behaviors.mjs');
const {DANGO_LIMB_RIG:rig}=await imp('src/content/companion/dango-limbs.mjs');
const {createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const source=await loadLimbSource();assert.equal(source.state(),'ready');
const {before,after,inputSnapshot,inputRoot}=registeredComparisonSources(source);
const oldManifest=before.manifest(),nextManifest=after.manifest();
const socket=nextManifest.sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='r');
const variants=await Promise.all([['before',before],['after',after]].map(async([name,src])=>{
  const artist=createDangoRasterArtist({manifest,limbs:src,loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas});
  await artist.ready({all:true});return {name,src,artist,painter:createDangoLimbPainter({source:src,createSurface:createCanvas}),exposure:new Map()};
}));
const round=v=>Math.round(v*1e6)/1e6, distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const stat=()=>({samples:0,visibleSamples:0,unsupported:0,plans:0,direct:0,standard:0,within075:0,within125:0,maxError:null,worst:null,exposedTotal:0,maxExposed:0,upperExposedTotal:0,maxUpperExposed:0,branchChanges:0,largeElbowJumps:0,largeWristJumps:0,maxElbowStep:0,maxWristStep:0});
// Classifications inherited from current-action-contacts/probe.mjs. Count classes separately.
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
function exposure(v,p){
  const key=JSON.stringify([p.view,p.side,p.joint.key,p.paw.src,p.pawMirror]);
  if(v.exposure.has(key))return v.exposure.get(key);
  const c=composeLimb(v.src,p),upper=composeLimb({...v.src,pixels:id=>id===p.F.src?null:v.src.pixels(id)},p);let n=0,u=0;
  for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){
    const i=(y*box.w+x)*4+3;
    if(c.arm.data[i]&&!v.src.bodyAlpha(p.view,x+box.x+.5,y+box.y+.5)&&!(pawLayer(p)==='front'&&c.paw.data[i])){n++;if(upper.arm.data[i])u++;}
  }
  const result={arm:n,upper:u};v.exposure.set(key,result);return result;
}
function sample(v,a,view,p){
  const z=v.artist.resolveArtwork({action:a,motion:a.motion,view,progress:p,elapsedMs:p*a.duration});
  assert.equal(z.ready,true,`${a.id} ${view} unready`);
  const hands=(z.contact?.hands||[]).map(h=>{
    const ct=contactContract(h,a),target=ct?.target||h.gripPoint||h.points?.at(-1),plan=ct&&solveLimb(v.src,{view:z.view,side:h.side,target,pose:ct.pose,contract:ct});
    const world=q=>q&&(plan.reflectAxis?[plan.reflectAxis-q[0],q[1]]:q);
    let rendered=null;
    if(plan){const pp=plan.paw,r=pp.root,g=pp.grip,px=v.src.pixels(pp.src);rendered=world([Math.round(plan.W[0]-(plan.pawMirror?px.width-r[0]:r[0]))+(plan.pawMirror?px.width-g[0]:g[0]),Math.round(plan.W[1]-r[1])+g[1]]);}
    return {side:h.side,kind:kind(a,h,p),opacity:h.opacity??1,target,role:ct?.role||null,pose:ct?.pose||null,normal:ct?.normal||null,standard:h.limb===true,direct:!!v.painter.plan(z.view,h,a),sourceContact:h.sourceContact||null,plan:plan?{S:world(plan.S),E:world(plan.E),W:world(plan.W),contact:plan.contactWorld,renderedContact:rendered,error:plan.error,renderedError:distance(rendered,target),joint:plan.joint.key,angles:[plan.joint.upperAngle,plan.joint.foreAngle],paw:plan.paw.src,exposure:exposure(v,plan),lengths:[distance(plan.S,plan.E),distance(plan.E,plan.W)]}:null};
  });
  const cleanHands=(z.contact?.hands||[]).map(({limb,...h})=>h);
  return {view:z.view,drawnView:z.drawnView,sourcePose:z.sourceContactPose||null,hands,invariant:JSON.stringify({view:z.view,drawnView:z.drawnView,data:z.data,body:z.matrices,anchors:z.anchors,attachmentMatrices:z.attachmentMatrices,sourcePose:z.sourceContactPose||null,tools:z.contact?.tools||[],hands:cleanHands,face:z.face,effects:z.effectOrigins,groundClip:z.groundClip})};
}
function add(s,h,phase,prev){
  s.samples++;if(h.opacity>0)s.visibleSamples++;
  s.direct+=Number(h.direct);s.standard+=Number(h.standard);
  const p=h.plan;if(!p){s.unsupported++;return;}
  s.plans++;s.within075+=Number(p.error<=.75);s.within125+=Number(p.error<=rig.maxContactError);
  if(s.maxError===null||p.error>s.maxError){s.maxError=p.error;s.worst={phase,target:h.target,S:p.S,E:p.E,W:p.W,error:p.error,renderedError:p.renderedError};}
  s.exposedTotal+=p.exposure.arm;s.maxExposed=Math.max(s.maxExposed,p.exposure.arm);s.upperExposedTotal+=p.exposure.upper;s.maxUpperExposed=Math.max(s.maxUpperExposed,p.exposure.upper);
  if(prev?.plan&&prev.kind===h.kind){const q=prev.plan,e=distance(p.E,q.E),w=distance(p.W,q.W),t=distance(h.target,prev.target);s.branchChanges+=Number(p.joint!==q.joint);s.maxElbowStep=Math.max(s.maxElbowStep,e);s.maxWristStep=Math.max(s.maxWristStep,w);s.largeElbowJumps+=Number(e>6&&t<.5);s.largeWristJumps+=Number(w>2&&t<.5);}
}
function comparePhase(a,view,p,rows,byClass,previous,invariants){
  const pair=variants.map(v=>sample(v,a,view,p));
  assert.equal(pair[0].invariant,pair[1].invariant,`target/tool/body change ${a.id}/${view}/${p}`);invariants.sampledArtwork++;
  assert.equal(pair[0].hands.length,pair[1].hands.length);
  for(let vi=0;vi<2;vi++)for(const h of pair[vi].hands){
    const key=`${a.id}/${view}/${h.side}/${h.kind}`,row=rows.get(key)||{id:a.id,view,side:h.side,kind:h.kind,before:stat(),after:stat(),admissionLost:0,admissionGained:0,standardLost:0,standardGained:0,errorIncreased:0,errorDecreased:0,exposureIncreased:0,exposureDecreased:0};rows.set(key,row);
    const c=byClass[h.kind]||=( {before:stat(),after:stat()} );
    add(row[variants[vi].name],h,p,previous[vi].get(`${a.id}/${view}/${h.side}`));add(c[variants[vi].name],h,p,null);
    if(h.plan){assert.ok(h.plan.lengths.every(n=>Math.abs(n-6)<=.5));assert.ok(distance(h.plan.contact,h.plan.renderedContact)<1e-8);invariants.validRenderedMarkers++;}
    if(vi===1){const b=pair[0].hands.find(q=>q.side===h.side);row.admissionLost+=Number(b.direct&&!h.direct);row.admissionGained+=Number(!b.direct&&h.direct);row.standardLost+=Number(b.standard&&!h.standard);row.standardGained+=Number(!b.standard&&h.standard);if(b.plan&&h.plan){row.errorIncreased+=Number(h.plan.error>b.plan.error+1e-9);row.errorDecreased+=Number(h.plan.error<b.plan.error-1e-9);row.exposureIncreased+=Number(h.plan.exposure.arm>b.plan.exposure.arm);row.exposureDecreased+=Number(h.plan.exposure.arm<b.plan.exposure.arm);}
      if(view!=='front'||h.side!=='right')assert.deepEqual(b,h,`unexpected unaffected difference ${key}`);
    }
    previous[vi].set(`${a.id}/${view}/${h.side}`,h);
  }
}
function finish(rows,classes){
 for(const [kind,c]of Object.entries(classes))for(const v of ['before','after']){
  const relevant=[...rows.values()].filter(r=>r.kind===kind);
  for(const k of ['branchChanges','largeElbowJumps','largeWristJumps'])c[v][k]=relevant.reduce((n,r)=>n+r[v][k],0);
  for(const k of ['maxElbowStep','maxWristStep'])c[v][k]=Math.max(0,...relevant.map(r=>r[v][k]));
 }
 const clean=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='number'?round(v):v));return clean({classes,rows:[...rows.values()]});
}
const sparseRows=new Map(), sparseClasses={}, sparsePrevious=[new Map(),new Map()],invariants={sampledArtwork:0,validRenderedMarkers:0};
const phases=[0,.125,.5,.875,1],combos=[];
for(const [id,a]of Object.entries(actions))for(const view of views[id].allowed){combos.push([id,view]);for(const p of phases)comparePhase(a,view,p,sparseRows,sparseClasses,sparsePrevious,invariants);}
const sparse=finish(sparseRows,sparseClasses);fs.writeFileSync(path.join(out,'sparse.json'),JSON.stringify({phases,actionCount:Object.keys(actions).length,combinations:combos.length,...sparse},null,2));
console.log('SPARSE',JSON.stringify({actions:Object.keys(actions).length,combinations:combos.length,artworkSamples:invariants.sampledArtwork,classes:sparse.classes}));
const denseRows=new Map(),denseClasses={},densePrevious=[new Map(),new Map()];
for(const [id,view]of combos.filter(([,v])=>v==='front')){
 for(let i=0;i<=steps;i++)comparePhase(actions[id],view,i/steps,denseRows,denseClasses,densePrevious,invariants);
 console.log('DENSE_ACTION',id);
}
const dense=finish(denseRows,denseClasses),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const evidenceFiles=['src/capabilities/companion/presentation/dango-limb-compose.mjs','src/capabilities/companion/presentation/dango-limb-assets.mjs','src/capabilities/companion/presentation/dango-raster-art.mjs','assets/companion/dango/raster/limbs/limbs.json','src/content/companion/dango-limbs.mjs','assets/companion/dango/raster/dango.raster.mjs'];
const metadata={inputRoot,runtimeReady:source.manifest().extensions.runtimeReady,hostAcceptsContract:rig.hostAcceptsContract,baselineSocket:oldManifest.sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='r'),candidateSocket:socket,coverageRebuiltFromCanonicalAlpha:true,sourceManifestUnmutated:JSON.stringify(source.manifest())===inputSnapshot,invariants,hashes:Object.fromEntries(evidenceFiles.map(p=>[p,hash(p)])),limits:['Actual source loader and production artist, diagnostic explicit acceptContract only.','Marker-distance, range and discrete branch evidence do not establish physical surface grip or visual approval.','Arm exposure excludes canonical body and front palm; props/garments can occlude additional pixels.','Dense sampling is deterministic observation, not continuous interval certification.','A branch jump means E step >6 or W step >2 while target step <0.5, reported separately.']};
assert.equal(metadata.runtimeReady,false);assert.equal(metadata.hostAcceptsContract,null);assert.equal(metadata.sourceManifestUnmutated,true);
fs.writeFileSync(path.join(out,'dense.json'),JSON.stringify({steps,phaseCount:steps+1,actionCombinations:combos.filter(([,v])=>v==='front').length,...dense},null,2));
fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify(metadata,null,2));
console.log('DONE',JSON.stringify({invariants,classes:dense.classes}));for(const v of variants){v.artist.dispose();v.painter.dispose();}
