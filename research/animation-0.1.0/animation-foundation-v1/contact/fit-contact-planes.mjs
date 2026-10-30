import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as T from 'three';
import {FoundationPool} from '../integration/foundation-host.mjs';
import {createCompleteOutfit} from '../configuration/fixtures/complete-outfit.mjs';
import {ANCHOR_DEFINITIONS} from '../anchors/bubu-d2-profile.mjs';
import {createRigidFitSnapshot} from './rigid-fit-snapshot.mjs';
import {sha256} from '../integration/asset-fixtures.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),requested=process.argv[2];
if(!requested||!path.isAbsolute(requested)||fs.existsSync(requested))throw Error('New external directory required');
const out=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));if(out.startsWith(root))throw Error('External evidence required');fs.mkdirSync(out);
const pool=new FoundationPool();let snapshot;
const report={status:'running',productionAccepted:false,scope:'Deterministic local supporting-plane fit for the existing flower mount, within unchanged bounds',declared:{maxIterations:8,clearance:1e-5,solverSeconds:20},iterations:[],limitations:['A failed supporting-plane problem is not a proof of nonlinear infeasibility.','A successful rest fit still needs full motion replay, clearance and actual visual review.']};
try{
 const actor=await pool.create(),configuration=createCompleteOutfit();await actor.equip(configuration);actor.step(0);
 const groups=new Map([['body',actor.f.h.body.root],...[...actor.mounts].map(([id,m])=>[id,m.root])]);snapshot=createRigidFitSnapshot(groups);
 const mount=configuration.mounts.find(m=>m.id==='sakura'),initial=[...mount.offset],basis=new T.Matrix3().setFromMatrix4(actor.anchors.getTransform(mount.anchor,{poseRevision:actor.revision}));
 const bounds=ANCHOR_DEFINITIONS.find(d=>d.id===mount.anchor).offsetBounds;
 const world=delta=>new T.Vector3(...delta).applyMatrix3(basis).toArray();let delta=[0,0,0];
 report.originalPairs=snapshot.intersections();report.bounds=bounds;report.configuration=configuration;
 for(let iteration=0;iteration<8;iteration++){
  const rows=snapshot.separationPlanes({sakura:world(delta)},{fixed:'body',moving:'sakura'});
  const pairs=snapshot.intersections({sakura:world(delta)}),bodyFlower=pairs.filter(([a,b])=>a.startsWith('body/')&&b.startsWith('sakura/'));
  const row={iteration,delta:[...delta],offset:delta.map((x,i)=>x+initial[i]),contactPlanes:rows.length,pairs};report.iterations.push(row);
  if(!bodyFlower.length){report.restBodyFlowerClear=true;break;}
  const coefficients=rows.map(r=>new T.Vector3(...r.normal).applyMatrix3(basis.clone().transpose()).toArray());
  const input={coefficients,lower:rows.map(r=>r.lower+1e-5),bounds:bounds.map(([min,max],i)=>[min-initial[i],max-initial[i]])};
  const result=spawnSync('python3',[fileURLToPath(new URL('./plane-fit.py',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8',timeout:25000,maxBuffer:1048576,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});
  if(result.status!==0)throw Error(result.error?.message||result.stderr||'Solver failed');row.solver=JSON.parse(result.stdout);
  console.log({iteration,planes:rows.length,status:row.solver.status,offset:row.offset});
  if(row.solver.status!=='candidate')break;
  delta=row.solver.delta.map((value,i)=>Math.min(bounds[i][1],Math.max(bounds[i][0],value+initial[i]))-initial[i]);
 }
 const offsets=Object.fromEntries(configuration.mounts.map(m=>[m.id,m.id==='sakura'?delta.map((x,i)=>x+initial[i]):m.offset]));
 report.best={offsets,pairs:snapshot.intersections({sakura:world(delta)})};report.restBodyFlowerClear=!report.best.pairs.some(([a,b])=>a.startsWith('body/')&&b.startsWith('sakura/'));
 report.status='completed';report.sourceHashes=Object.fromEntries(['animation-foundation-v1/contact/fit-contact-planes.mjs','animation-foundation-v1/contact/plane-fit.py','animation-foundation-v1/contact/rigid-fit-snapshot.mjs','animation-foundation-v1/configuration/fixtures/complete-outfit.mjs'].map(name=>[name,sha256(path.join(root,name))]));
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{snapshot?.dispose();pool.dispose();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
