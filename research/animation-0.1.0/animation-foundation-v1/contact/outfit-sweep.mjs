import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {FoundationPool} from '../integration/foundation-host.mjs';
import {createCompleteOutfit} from '../configuration/fixtures/complete-outfit.mjs';
import {createSurfaceProbe} from './surface-probe.mjs';
import {createRigidFitSnapshot} from './rigid-fit-snapshot.mjs';
import {createRigidMountDomain} from './rigid-mount-domain.mjs';
import {DEFINITIONS} from '../anchors/definitions.mjs';
import * as T from 'three';

const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),output=process.argv[2];
const options=process.argv.slice(3),reference=options.length===1&&options[0]==='--reference';
const fit=options.length===2&&options[0]==='--fit'?options[1]:null;
const angleCap=options.length===2&&options[0]==='--angle-cap'?Number(options[1]):null;
if(options.length&&!reference&&!fit&&angleCap===null)throw Error('Use --reference, --fit REPORT or --angle-cap RADIANS');
if(angleCap!==null&&!(Number.isFinite(angleCap)&&angleCap>0&&angleCap<=.25))throw Error('Bounded positive angle required');
if(!output||!path.isAbsolute(output)||fs.existsSync(output))throw Error('New absolute output directory required');
const resolved=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
if(resolved===root||resolved.startsWith(root+path.sep))throw Error('Evidence must be external');
fs.mkdirSync(resolved);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={status:'running',productionAccepted:false,scope:'Sampled rendered surfaces of the existing five-mount outfit; no tea, no cloth simulation',hz:60,samples:0,framesWithContacts:0,byPhase:{},pairs:{},limitations:['Discrete 60 Hz samples do not establish continuous-time separation.','Surface crossing only; containment, thickness, same-garment self-contact and intended attachment contact classification are not established.','Foundation cape identity is distinct from the frozen round5 cape. No acceptance registry entries are created.'],sourceHashes:{}};
for(const name of ['contact/outfit-sweep.mjs','contact/rigid-mount-domain.mjs','contact/rigid-fit-snapshot.mjs','anchors/definitions.mjs','anchors/weighted-frame.mjs','contact/surface-probe.mjs','integration/foundation-runtime.mjs','integration/binding-provider.mjs','integration/sakura-part-fit.mjs','integration/satchel-part-fit.mjs','integration/wearable-calibration-fit.mjs','integration/asset-resources.mjs','configuration/fixtures/index.mjs','configuration/fixtures/complete-outfit.mjs'])report.sourceHashes[name]=hash(path.join(root,'animation-foundation-v1',name));
const pool=new FoundationPool();let actor,probe,rigidDomain;
try{
  actor=await pool.create();const outfit=createCompleteOutfit();
  if(angleCap!==null)for(const secondary of outfit.secondaryMotion)secondary.maxAngleRad=angleCap;
  if(reference)for(const id of ['halo','sakura','leaf','cape','satchel'])outfit.mounts.find(m=>m.id===id).offset=[0,0,0];
  if(fit){
    if(fs.statSync(fit).size>262144)throw Error('Fit report exceeds budget');
    const candidate=JSON.parse(fs.readFileSync(fit));
    if(candidate.status!=='completed'||!candidate.best?.offsets)throw Error('Incomplete fit report');
    const ids=outfit.mounts.map(m=>m.id);
    if(Object.keys(candidate.best.offsets).length!==ids.length||Object.keys(candidate.best.offsets).some(id=>!ids.includes(id)))throw Error('Exact outfit fit required');
    for(const mount of outfit.mounts)mount.offset=candidate.best.offsets[mount.id];
    report.fitReportSHA256=hash(fit);
  }
  report.reference=reference;
  await actor.equip(outfit);actor.step(0);
  report.configuration=outfit;report.garments=[...actor.mounts.values()].map(m=>m.contact);
  report.modelHashes={source:hash(path.join(root,'runtime-facepath05/fixtures/face-d2/asset.glb')),parts:hash(path.join(root,'original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'))};
  const groups=new Map([['body',actor.f.h.body.root],...[...actor.mounts].map(([id,m])=>[id,m.root])]);
  if(actor.tail?.root)groups.set('tail',actor.tail.root);
  probe=createSurfaceProbe(groups);report.roster=probe.roster();
  if(!reference)rigidDomain=createRigidMountDomain({
    mounts:new Map([...actor.mounts].filter(([id])=>['sakura','leaf','halo'].includes(id))),
    body:actor.f.h.body.root.getObjectByName('Bubu_body'),definitions:DEFINITIONS,
  });
  const flora=new Map([...groups].filter(([id])=>['sakura','leaf'].includes(id)));
  const fittedSnapshot=createRigidFitSnapshot(flora);
  try{report.floraMinimumSurfaceGap=fittedSnapshot.minimumDistance();}finally{fittedSnapshot.dispose();}
  const relativeFlora=()=>new T.Matrix4().copy(groups.get('sakura').matrixWorld).invert().multiply(groups.get('leaf').matrixWorld);
  const initialFlora=relativeFlora();report.maximumFloraRelativeMatrixDrift=0;
  const point=actor.f.point(0,1.4);
  report.maximumSecondaryDisplacement={};
  report.minimumPouchBodySurfaceGap=Infinity;
  for(let frame=0;frame<=480;frame++){
    const time=frame/60;
    if(frame===60||frame===180)actor.f.emit('pointerdown',time,point);
    if(frame===150||frame===270)actor.f.emit('pointerup',time,point);
    if(frame>180&&frame<270)actor.f.emit('pointermove',time,{clientX:point.clientX+(frame-180)*.6,clientY:point.clientY-(frame-180)*.45});
    actor.step(time);const phase=actor.f.h.state.mode,contacts=probe.sample();
    rigidDomain?.assertCurrent();
    // The probe refreshes both deformed BVHs and geometry bounds before distance queries.
    const [pouchGap]=probe.distances([['body/Bubu_body','satchel/satchel_pouch']]);
    report.minimumPouchBodySurfaceGap=Math.min(report.minimumPouchBodySurfaceGap,pouchGap.distance);
    for(const [id,mount] of actor.mounts){
      if(!mount.secondary)continue;
      let maximum=report.maximumSecondaryDisplacement[id]??0;
      for(const part of mount.secondary.parts){const p=part.mesh.geometry.attributes.position.array;for(let i=0;i<p.length;i+=3)maximum=Math.max(maximum,Math.hypot(p[i]-part.rest[i],p[i+1]-part.rest[i+1],p[i+2]-part.rest[i+2]));}
      report.maximumSecondaryDisplacement[id]=maximum;
    }
    const currentFlora=relativeFlora();report.maximumFloraRelativeMatrixDrift=Math.max(report.maximumFloraRelativeMatrixDrift,...initialFlora.elements.map((value,i)=>Math.abs(value-currentFlora.elements[i])));
    report.samples++;if(contacts.length)report.framesWithContacts++;
    report.byPhase[phase]??={samples:0,framesWithContacts:0};report.byPhase[phase].samples++;if(contacts.length)report.byPhase[phase].framesWithContacts++;
    for(const contact of contacts){const key=contact.pair.join(' <> ');let row=report.pairs[key];
      if(!row)report.pairs[key]=row={samples:0,phases:[],firstTime:time,lastTime:time,witness:contact.witness};
      row.samples++;row.lastTime=time;if(!row.phases.includes(phase))row.phases.push(phase);
    }
    if(frame%60===0)console.log({time,phase,contactPairs:contacts.length});
  }
  report.status='completed';report.surfaceCrossingsObserved=Object.keys(report.pairs).length>0;
  if(!reference&&report.pairs['body/Bubu_body <> satchel/satchel_pouch'])
    throw Error('Pouch/body rigid assembly fit regressed at sampled poses');
  if(!reference&&!fit&&angleCap===null&&Object.keys(report.pairs).length)
    throw Error('Default complete outfit sampled surface separation regressed');
  if(!reference&&!(report.minimumPouchBodySurfaceGap>1e-6))
    throw Error('Pouch/body rigid assembly fit lacks measurable surface clearance');
  report.secondaryDiagnostics=Object.fromEntries([...actor.mounts].filter(([,m])=>m.secondary).map(([id,m])=>[id,m.secondary.diagnostics()]));
  report.haloContactPairs=Object.keys(report.pairs).filter(key=>key.includes('halo/'));
  report.floraContactPairs=Object.keys(report.pairs).filter(key=>key.includes('sakura/')&&key.includes(' <> leaf/'));
  if(['idle','pending','petting','drag','landing'].some(phase=>!report.byPhase[phase]?.samples))
    throw Error('Incomplete outfit motion coverage');
  if(reference&&!report.haloContactPairs.some(key=>key.includes('sakura/')))
    throw Error('Reference failed to reproduce the known halo/flower crossing');
  if(!reference&&report.haloContactPairs.length)
    throw Error('Composition halo fit regressed at sampled poses');
  if(reference&&report.floraContactPairs.length!==2)
    throw Error('Reference failed to reproduce both flower/leaf crossings');
  if(!reference&&report.floraContactPairs.length)
    throw Error('Composition flower/leaf fit regressed at sampled poses');
  if(!reference&&!(report.floraMinimumSurfaceGap?.distance>1e-6))
    throw Error('Flower/leaf fit lacks measurable surface clearance');
  if(report.maximumFloraRelativeMatrixDrift>1e-10)
    throw Error('Flower/leaf rigid-relative transform changed');
  const dynamicPairs=[
    'body/Bubu_body <> cape/cape_edge_0',
    'body/Bubu_body <> satchel/satchel_continuous_strap',
    'satchel/satchel_continuous_strap <> cape/cape_edge_0',
    'satchel/satchel_continuous_strap <> cape/cape_cloth',
  ];
  report.dynamicContactPairs=dynamicPairs.filter(pair=>report.pairs[pair]);
  if(!reference&&!fit&&report.dynamicContactPairs.length)
    throw Error('Complete-outfit dynamic clearance regressed');
  const flowerPairs=['sakura_petal_1','sakura_petal_2','sakura_leaf_-019']
    .map(name=>`body/Bubu_body <> sakura/${name}`);
  report.flowerBodyContactPairs=flowerPairs.filter(pair=>report.pairs[pair]);
  if(!reference&&!fit&&report.flowerBodyContactPairs.length)
    throw Error('Private flower-part fit regressed against the body');
}catch(error){
  report.status='failed';report.failure=error.message;throw error;
}finally{
  if(rigidDomain)report.rigidMountContinuousDomain=rigidDomain.report();
  probe?.dispose();pool.dispose();fs.writeFileSync(path.join(resolved,'report.json'),JSON.stringify(report,null,2)+'\n');
}
