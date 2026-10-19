import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {registerHooks} from 'node:module';
import {performance,PerformanceObserver} from 'node:perf_hooks';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
const warmCount=Number(process.env.WARM_COUNT??0);
const args = process.argv.slice(2);
const option = name => {const i=args.indexOf(name);return i < 0 ? undefined : args[i+1];};
const root = path.resolve(option('--research-root') ?? fileURLToPath(new URL('../../../../', import.meta.url))) + '/';
const output = option('--output');
if (!output) throw new Error('Required: --output FILE; optional: --research-root RESEARCH_DIRECTORY');
if (!fs.existsSync(root + 'animation-foundation-v1')) throw new Error('Research root does not contain animation-foundation-v1; pass --research-root');
const target=pathToFileURL(root+'animation-foundation-v1/body-runtime/surface-query.mjs').href;
const hook=registerHooks({load(url,context,next){const result=next(url,context);if(url!==target)return result;const source=String(result.source),needle='    prepare();\n  } catch (error) {';assert.equal(source.split(needle).length,2);return {...result,source:source.replace(needle,'    prepare();\n    globalThis.__refitExperiment(bvh, skin, geometry);\n  } catch (error) {')};}});
const hashBuffer=a=>crypto.createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
function snapshot(skin,geometry){return JSON.stringify({source:Object.fromEntries(Object.entries(skin.geometry.attributes).map(([k,a])=>[k,hashBuffer(a.array)])),index:hashBuffer(skin.geometry.index.array),posed:hashBuffer(geometry.attributes.position.array),bind:skin.bindMatrix.toArray(),inverse:skin.bindMatrixInverse.toArray(),morph:skin.morphTargetInfluences,bones:skin.skeleton.bones.map(b=>[b.position.toArray(),b.quaternion.toArray(),b.scale.toArray(),b.matrix.toArray(),b.matrixWorld.toArray()])});}
let initialization;
globalThis.__refitExperiment=(bvh,skin,geometry)=>{const before=snapshot(skin,geometry),memoryBefore=process.memoryUsage();let peakHeap=memoryBefore.heapUsed;const begin=performance.now(),times=[];for(let i=0;i<warmCount;i++){const start=performance.now();bvh.refit();times.push(performance.now()-start);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);}const duration=performance.now()-begin,memoryAfter=process.memoryUsage();assert.equal(snapshot(skin,geometry),before,'Warm-up changed pose or source/posed geometry');initialization={count:warmCount,duration,times,memoryBefore,memoryAfter,peakHeap,poseAndGeometryUnchanged:true};};
const imp=p=>import(pathToFileURL(root+p));
const T=await imp('node_modules/three/build/three.module.js');
const {MeshBVH}=await imp('node_modules/three-mesh-bvh/src/index.js');
let refitTimes=[];const originalRefit=MeshBVH.prototype.refit;MeshBVH.prototype.refit=function(...args){const start=performance.now();try{return originalRefit.apply(this,args);}finally{refitTimes.push(performance.now()-start);}};
const {FoundationPool}=await imp('animation-foundation-v1/integration/foundation-host.mjs');
const {FIXTURES}=await imp('animation-foundation-v1/configuration/fixtures/index.mjs');
const gc=[];const observer=new PerformanceObserver(list=>gc.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration,kind:e.detail.kind}))));observer.observe({entryTypes:['gc']});
const pool=new FoundationPool(),initStart=performance.now(),actor=await pool.create();const initTotal=performance.now()-initStart;assert.equal(actor.time,0);
const rows=[],stateHash=crypto.createHash('sha256');
function hit(){const p=actor.f.h.body.skin.localToWorld(new T.Vector3(-.2,1.4,0)).project(actor.f.camera);return {clientX:(p.x+1)*192,clientY:(1-p.y)*192};}
for(const config of FIXTURES){await actor.equip(config);const start=actor.time;let p=hit();for(let i=1;i<=180;i++){const t=start+i/60;if(i===3)actor.f.emit('pointerdown',t,p);if(i>20&&i<90){p={clientX:p.clientX+Math.sin(i)*3,clientY:p.clientY-1};actor.f.emit('pointermove',t,p);}if(i===90)actor.f.emit('pointerup',t,p);const before={...actor.f.h.diagnostics.surface};refitTimes=[];const begin=performance.now();const state=actor.step(t);const duration=performance.now()-begin;stateHash.update(JSON.stringify(state));rows.push({fixture:config.id,frame:i,begin,duration,mode:state.mode,queries:actor.f.h.diagnostics.surface.queries-before.queries,refits:actor.f.h.diagnostics.surface.refits-before.refits,refitTimes});}await new Promise(r=>setImmediate(r));}
const finalSurface={...actor.f.h.diagnostics.surface};pool.dispose();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));observer.disconnect();hook.deregister();delete globalThis.__refitExperiment;
for(const row of rows)row.gcOverlap=gc.filter(g=>g.start<row.begin+row.duration&&g.start+g.duration>row.begin);
const report={warmCount,initTotal,initialization,initialActorTime:0,stateDigest:stateHash.digest('hex'),finalSurface,rows,gc};fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({warmCount,initTotal,warmMs:initialization.duration,stateDigest:report.stateDigest,queries:rows.filter(r=>r.queries),slow:rows.filter(r=>r.duration>16.667)},null,2));
