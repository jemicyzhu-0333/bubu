import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {FoundationPool} from '../integration/foundation-host.mjs';
import {createCompleteOutfit} from '../configuration/fixtures/complete-outfit.mjs';
import {ANCHOR_DEFINITIONS} from '../anchors/bubu-d2-profile.mjs';
import {createRigidFitSnapshot} from './rigid-fit-snapshot.mjs';

const research=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),requested=process.argv[2];
if(!requested||!path.isAbsolute(requested)||fs.existsSync(requested))throw Error('New absolute output directory required');
const out=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
if(out===research||out.startsWith(research+path.sep))throw Error('External evidence required');
fs.mkdirSync(out);
const report={status:'running',productionAccepted:false,scope:'Bounded mount translations at the actual rest pose; no source-model or pin edits',gridPointsPerAxis:5,iterations:[],independent:[],limitations:['A finite translation grid does not prove infeasibility between grid points.','Surface crossings only; containment and contact clearance are not accepted.','Secondary motion is frozen in this search; nominated offsets must be replayed through actual dynamics.']};
const pool=new FoundationPool();let snapshot;
try {
  const actor=await pool.create(),configuration=createCompleteOutfit();await actor.equip(configuration);actor.step(0);
  report.configuration=configuration;report.garments=[...actor.mounts.values()].map(m=>m.contact);
  const groups=new Map([['body',actor.f.h.body.root],...[...actor.mounts].map(([id,m])=>[id,m.root])]);
  if(actor.tail?.root)groups.set('tail',actor.tail.root);
  snapshot=createRigidFitSnapshot(groups);
  const bases=new Map(),bounds=new Map(),initial={};
  for(const mount of configuration.mounts){
    const matrix=actor.anchors.getTransform(mount.anchor,{poseRevision:actor.revision});
    bases.set(mount.id,new T.Matrix3().setFromMatrix4(matrix));initial[mount.id]=[...mount.offset];
    bounds.set(mount.id,ANCHOR_DEFINITIONS.find(a=>a.id===mount.anchor).offsetBounds);
  }
  const world=offsets=>Object.fromEntries(Object.entries(offsets).map(([id,p])=>[id,new T.Vector3(...p).sub(new T.Vector3(...initial[id])).applyMatrix3(bases.get(id)).toArray()]));
  const candidates=id=>{
    const axes=bounds.get(id).map(([min,max])=>Array.from({length:5},(_,i)=>min+(max-min)*i/4));
    return axes[0].flatMap(x=>axes[1].flatMap(y=>axes[2].map(z=>[x,y,z])));
  };
  const distance=offsets=>Object.entries(offsets).reduce((sum,[id,p])=>sum+p.reduce((s,x,i)=>s+(x-initial[id][i])**2,0),0);
  const evaluate=offsets=>{const pairs=snapshot.intersections(world(offsets));return {offsets:structuredClone(offsets),pairs,count:pairs.length,distance:distance(offsets)};};
  report.baseline=evaluate(initial);
  for(const id of ['sakura','leaf','satchel','cape']){
    const rows=candidates(id).map(offset=>evaluate({...initial,[id]:offset}));
    rows.sort((a,b)=>a.count-b.count||a.distance-b.distance);
    report.independent.push({id,candidates:rows.length,bounds:bounds.get(id),best:rows.slice(0,5)});
    console.log({id,bestPairs:rows[0].count,offset:rows[0].offsets[id]});
  }
  let best=evaluate(initial);
  // Solve the coupled flower/leaf translations exhaustively on the declared
  // grid, caching interactions with fixed groups instead of accepting a local
  // coordinate-descent minimum.
  const flora=['sakura','leaf'],fixed=snapshot.intersections(world(initial),{includePair:(a,b)=>!flora.includes(a)&&!flora.includes(b)});
  const cached=Object.fromEntries(flora.map(id=>[id,candidates(id).map(offset=>{
    const offsets={...initial,[id]:offset};
    return {offset,world:world(offsets)[id],pairs:snapshot.intersections(world(offsets),{includePair:(a,b)=>(a===id&&!flora.includes(b))||(b===id&&!flora.includes(a))})};
  })]));
  let jointTrials=0;
  for(const a of cached.sakura)for(const b of cached.leaf){
    const offsets={...initial,sakura:a.offset,leaf:b.offset};
    const joined=snapshot.intersections({sakura:a.world,leaf:b.world},{includePair:(x,y)=>flora.includes(x)&&flora.includes(y)});
    const pairs=[...fixed,...a.pairs,...b.pairs,...joined],row={offsets:structuredClone(offsets),pairs,count:pairs.length,distance:distance(offsets)};
    if(row.count<best.count||row.count===best.count&&row.distance<best.distance)best=row;
    jointTrials++;
  }
  report.jointFlora={trials:jointTrials,best};
  console.log({jointTrials,bestPairs:best.count,offsets:best.offsets});
  for(let iteration=0;iteration<4;iteration++){
    const previous=JSON.stringify(best.offsets);
    for(const id of ['sakura','leaf','satchel','cape']){
      for(const offset of candidates(id)){
        const row=evaluate({...best.offsets,[id]:offset});
        if(row.count<best.count||row.count===best.count&&row.distance<best.distance)best=row;
      }
    }
    report.iterations.push(best);console.log({iteration,pairs:best.count,offsets:best.offsets});
    if(JSON.stringify(best.offsets)===previous)break;
  }
  report.best=best;report.status='completed';
  report.sourceHashes=Object.fromEntries(['contact/fit-outfit.mjs','contact/rigid-fit-snapshot.mjs','configuration/fixtures/complete-outfit.mjs','integration/binding-provider.mjs'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(research,'animation-foundation-v1',n))).digest('hex')]));
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{snapshot?.dispose();pool.dispose();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
