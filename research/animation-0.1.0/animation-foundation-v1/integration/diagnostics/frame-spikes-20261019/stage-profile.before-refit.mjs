import fs from 'node:fs';
import {performance, PerformanceObserver} from 'node:perf_hooks';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
const args = process.argv.slice(2);
const option = name => {const i=args.indexOf(name);return i < 0 ? undefined : args[i+1];};
const root = path.resolve(option('--research-root') ?? fileURLToPath(new URL('../../../../', import.meta.url))) + '/';
const output = option('--output');
if (!output) throw new Error('Required: --output FILE; optional: --research-root RESEARCH_DIRECTORY');
if (!fs.existsSync(root + 'animation-foundation-v1')) throw new Error('Research root does not contain animation-foundation-v1; pass --research-root');
const imp = p => import(pathToFileURL(root+p));
const T = await imp('node_modules/three/build/three.module.js');
const {FoundationPool} = await imp('animation-foundation-v1/integration/foundation-host.mjs');
const {createFrameOwner} = await imp('animation-foundation-v1/integration/frame-owner.mjs');
const {FIXTURES} = await imp('animation-foundation-v1/configuration/fixtures/index.mjs');
const gc = [], rows = [];
const observer = new PerformanceObserver(list => gc.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration,kind:e.detail.kind}))));
observer.observe({entryTypes:['gc']});
const pool = new FoundationPool(), a = await pool.create();
let stages = {};
const detail = process.env.DETAIL === "1";
const timed = (name, fn) => (...args) => {const s=performance.now();try{return fn(...args);}finally{stages[name]=(stages[name]??0)+performance.now()-s;}};
if(detail) for(const key of ["applyPose", "surfacePoint", "minimumFoot", "snapshot", "place", "constrainGround"]) {const original=a.f.h.body[key].bind(a.f.h.body);a.f.h.body[key]=timed("detail_"+key,original);}
a.frame = createFrameOwner({
  advanceBody:timed('body', t=>a.f.tick(t)),
  finalizeBody:timed('finalize', ()=>{a.owner.update();a.f.h.body.root.updateMatrixWorld(true);a.f.h.body.skin.skeleton.update();}),
  sampleAnchors:timed('anchors', f=>a.anchors.sampleFinalPose(f.revision)),
  updateAttachments:timed('attachments', f=>a.updateAttachments(f)),
  updateEffects:timed('effects', f=>a.effects.tick({dt:Math.max(0,f.dt),poseRevision:f.revision,hidden:f.policy.hidden,reducedMotion:f.policy.reducedMotion})),
  render:timed('sceneMatrices', ()=>a.scene.updateMatrixWorld(true)),
});
function hit(){const p=a.f.h.body.skin.localToWorld(new T.Vector3(-.2,1.4,0)).project(a.f.camera);return {clientX:(p.x+1)*192,clientY:(1-p.y)*192};}
for(let pass=0;pass<3;pass++) for(const config of FIXTURES){
 await a.equip(config);const start=a.time;let p=hit();
 for(let i=1;i<=180;i++){
  const t=start+i/60;
  if(i===3)a.f.emit('pointerdown',t,p);
  if(i>20&&i<90){p={clientX:p.clientX+Math.sin(i)*3,clientY:p.clientY-1};a.f.emit('pointermove',t,p);}
  if(i===90)a.f.emit('pointerup',t,p);
  const q=a.f.h.diagnostics.surface.queries,r=a.f.h.diagnostics.surface.refits;
  stages={};const begin=performance.now();const state=a.step(t);const duration=performance.now()-begin;
  rows.push({pass,fixture:config.id,frame:i,mode:state.mode,begin,duration,queries:a.f.h.diagnostics.surface.queries-q,refits:a.f.h.diagnostics.surface.refits-r,stages});
 }
 await new Promise(r=>setImmediate(r));
}
pool.dispose();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));observer.disconnect();
const stats = xs=>{xs.sort((a,b)=>a-b);return {n:xs.length,median:xs[Math.floor(xs.length*.5)],p95:xs[Math.floor(xs.length*.95)],p99:xs[Math.floor(xs.length*.99)],max:xs.at(-1)};};
for(const row of rows)row.gcOverlap=gc.filter(g=>g.start<row.begin+row.duration&&g.start+g.duration>row.begin);
const summary=Object.fromEntries([0,1,2].map(pass=>[pass,stats(rows.filter(r=>r.pass===pass).map(r=>r.duration))]));
const slow=rows.filter(r=>r.duration>16.667);
const report={scope:'Node stage wall timing, no GPU/native or scheduler attribution. Same ports/order as FoundationActor; no per-frame CPU counter; no assertion traversal between frames. Pass 0 cold, passes 1/2 repeated same actor.',summary,stages:Object.fromEntries(Object.keys(rows[0].stages).map(k=>[k,stats(rows.map(r=>r.stages[k]))])),slow,rows,gc};
fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({summary,stages:report.stages,slow},null,2));
