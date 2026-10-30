/** One constrained solve using all observed body/strap crossing planes. The
 * result is only a nomination; altered anchor dynamics require a full replay. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as T from 'three';
import {FoundationPool} from '../integration/foundation-host.mjs';
import {createCompleteOutfit} from '../configuration/fixtures/complete-outfit.mjs';
import {ANCHOR_DEFINITIONS} from '../anchors/bubu-d2-profile.mjs';
import {createRigidFitSnapshot} from './rigid-fit-snapshot.mjs';
import {createSurfaceProbe} from './surface-probe.mjs';
import {sha256} from '../integration/asset-fixtures.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),requested=process.argv[2];
const inputFit=process.argv[3];
if(!requested||!path.isAbsolute(requested)||fs.existsSync(requested))throw Error('New external directory required');
const out=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));if(out.startsWith(root))throw Error('External evidence required');fs.mkdirSync(out);
const report={status:'running',productionAccepted:false,clearance:1e-5,samples:0,contactFrames:[],coefficients:[],lower:[],limitations:['Local plane fit is not global contact acceptance.','All altered dynamics and other pairs require exact replay.']};
const pool=new FoundationPool();let probe;
try{
 const actor=await pool.create(),configuration=createCompleteOutfit();configuration.mounts.find(m=>m.id==='cape').offset=[0,0,.04];configuration.mounts.find(m=>m.id==='satchel').offset=[0,0,0];await actor.equip(configuration);actor.step(0);
 if(inputFit){const fit=JSON.parse(fs.readFileSync(inputFit));if(fit.status!=='completed'||!fit.best?.offsets)throw Error('Completed candidate required');for(const m of configuration.mounts)m.offset=fit.best.offsets[m.id];await actor.equip(configuration);actor.step(0);report.inputFitSHA256=sha256(inputFit);}
 // Use real mesh references in the probe without reparenting them.
 const groups=new Map([['body',actor.f.h.body.root.getObjectByName('Bubu_body')],['satchel',actor.mounts.get('satchel').root.getObjectByName('satchel_continuous_strap')]]);
 if(inputFit)groups.set('cape',actor.mounts.get('cape').root);
 probe=createSurfaceProbe(groups);
 const point=actor.f.point(0,1.4);
 for(let frame=0;frame<=480;frame++){
   const time=frame/60;
   if(frame===60||frame===180)actor.f.emit('pointerdown',time,point);
   if(frame===150||frame===270)actor.f.emit('pointerup',time,point);
   if(frame>180&&frame<270)actor.f.emit('pointermove',time,{clientX:point.clientX+(frame-180)*.6,clientY:point.clientY-(frame-180)*.45});
   actor.step(time);report.samples++;
   const contacts=probe.sample();if(!contacts.length)continue;
   const snapshot=createRigidFitSnapshot(groups);
   try{
     const active=inputFit?['satchel','cape']:['satchel'];
     let total=0;
     for(const [fixed,moving] of inputFit?[['body','satchel'],['body','cape'],['satchel','cape']]:[['body','satchel']]){
       const rows=snapshot.separationPlanes({}, {fixed,moving});total+=rows.length;
       for(const row of rows){
         report.coefficients.push(active.flatMap(id=>{
           if(id!==fixed&&id!==moving)return [0,0,0];
           const m=configuration.mounts.find(m=>m.id===id),basis=new T.Matrix3().setFromMatrix4(actor.anchors.getTransform(m.anchor,{poseRevision:actor.revision})).transpose();
           return new T.Vector3(...row.normal).applyMatrix3(basis).multiplyScalar(id===moving?1:-1).toArray();
         }));report.lower.push(row.lower+report.clearance);
       }
     }
     report.contactFrames.push({frame,time,phase:actor.f.h.state.mode,planes:total});
   }finally{snapshot.dispose();}
 }
 if(!report.coefficients.length)throw Error('Known dynamic strap failure not reproduced');
 const active=inputFit?['satchel','cape']:['satchel'];
 const bounds=active.flatMap(id=>{const m=configuration.mounts.find(m=>m.id===id);return ANCHOR_DEFINITIONS.find(a=>a.id===m.anchor).offsetBounds.map(([lo,hi],i)=>[lo-m.offset[i],hi-m.offset[i]]);});
 const input={coefficients:report.coefficients,lower:report.lower,bounds};
 const result=spawnSync('python3',[fileURLToPath(new URL('./plane-fit.py',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8',timeout:25000,maxBuffer:1048576,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});
 if(result.status!==0)throw Error(result.error?.message||result.stderr||'Solver failed');report.solver=JSON.parse(result.stdout);
 if(report.solver.status==='candidate')report.best={offsets:Object.fromEntries(configuration.mounts.map(m=>[m.id,active.includes(m.id)?m.offset.map((v,i)=>v+report.solver.delta[active.indexOf(m.id)*3+i]):m.offset]))};
 report.configuration=configuration;report.status='completed';
 report.sourceHashes=Object.fromEntries(['contact/fit-dynamic-strap.mjs','contact/plane-fit.py','contact/rigid-fit-snapshot.mjs','contact/surface-probe.mjs','configuration/fixtures/complete-outfit.mjs','integration/foundation-runtime.mjs'].map(name=>[name,sha256(path.join(root,'animation-foundation-v1',name))]));
 console.log({status:report.status,frames:report.contactFrames,solver:report.solver});
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{probe?.dispose();pool.dispose();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
