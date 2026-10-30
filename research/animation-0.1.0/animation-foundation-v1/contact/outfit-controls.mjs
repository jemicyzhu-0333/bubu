/** Same actor pose, separately owned rest-geometry controls. Not a quality
 * reduction, runtime mode, or contact acceptance. Canonical input runs once. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {FoundationPool} from '../integration/foundation-host.mjs';
import {createCompleteOutfit} from '../configuration/fixtures/complete-outfit.mjs';
import {createSurfaceProbe} from './surface-probe.mjs';
import {sha256} from '../integration/asset-fixtures.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),output=process.argv[2];
if(!output||!path.isAbsolute(output)||fs.existsSync(output))throw Error('New external output directory required');
const out=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));if(out.startsWith(root))throw Error('External evidence required');fs.mkdirSync(out);
const report={status:'running',productionAccepted:false,samples:0,variants:{dynamic:{},restSecondary:{}},bodyBone0Scale:{minimum:[Infinity,Infinity,Infinity],maximum:[-Infinity,-Infinity,-Infinity]},sourceHashes:{},limitations:['Rest-secondary control removes garment motion only; canonical body/input pose remains identical.','Neither control establishes continuous contact, containment, cloth or intended attachment masks.']};
const measuredPairs=[['body/Bubu_body','cape/cape_edge_0'],['body/Bubu_body','satchel/satchel_continuous_strap'],['satchel/satchel_continuous_strap','cape/cape_edge_0'],['satchel/satchel_continuous_strap','cape/cape_cloth']];
report.restMinimumGaps={};report.displacementCoefficients={};
const pool=new FoundationPool(),geometries=[],controls=new Map();let dynamicProbe,restProbe;
try{
  const actor=await pool.create(),outfit=createCompleteOutfit();await actor.equip(outfit);actor.step(0);
  const dynamic=new Map([['body',actor.f.h.body.root],...[...actor.mounts].map(([id,item])=>[id,item.root])]);
  if(actor.tail?.root)dynamic.set('tail',actor.tail.root);
  const rest=new Map(dynamic);
  for(const [id,item] of actor.mounts){
    if(!item.secondary)continue;const group=new T.Group();group.matrixAutoUpdate=false;
    const descriptor=JSON.parse(fs.readFileSync(new URL(`../secondary-motion/descriptors/${id}.json`,import.meta.url))),ancestors=[[]];
    for(const chain of descriptor.profile.chains)for(let i=0;i<chain.length;i++)ancestors.push(chain.slice(0,i+1).map(p=>new T.Vector3(...p)));
    report.displacementCoefficients[id]={};
    for(const part of item.secondary.parts){
      let maximum=0;const p=new T.Vector3();
      for(let i=0;i<part.rest.length/3;i++){
        p.fromArray(part.rest,i*3);let bound=0;
        for(let slot=0;slot<4;slot++){const index=i*4+slot,w=part.weights[index];if(w)bound+=w*ancestors[part.indices[index]].reduce((s,pivot)=>s+p.distanceTo(pivot),0);}
        maximum=Math.max(maximum,bound);
      }
      report.displacementCoefficients[id][part.mesh.name]=maximum;
    }
    for(const part of item.secondary.parts){const geometry=part.mesh.geometry.clone();geometry.attributes.position.array.set(part.rest);geometry.attributes.normal.array.set(part.restNormals);geometries.push(geometry);const mesh=new T.Mesh(geometry,part.mesh.material);mesh.name=part.mesh.name;group.add(mesh);}
    controls.set(id,{group,source:item.root});rest.set(id,group);
  }
  dynamicProbe=createSurfaceProbe(dynamic);restProbe=createSurfaceProbe(rest);
  const point=actor.f.point(0,1.4),scale=new T.Vector3(),position=new T.Vector3(),rotation=new T.Quaternion();
  for(let frame=0;frame<=480;frame++){
    const time=frame/60;
    if(frame===60||frame===180)actor.f.emit('pointerdown',time,point);
    if(frame===150||frame===270)actor.f.emit('pointerup',time,point);
    if(frame>180&&frame<270)actor.f.emit('pointermove',time,{clientX:point.clientX+(frame-180)*.6,clientY:point.clientY-(frame-180)*.45});
    actor.step(time);const phase=actor.f.h.state.mode;
    for(const {group,source} of controls.values()){group.matrix.copy(source.matrixWorld);group.updateMatrixWorld(true);}
    new T.Matrix4().fromArray(actor.f.h.body.skin.skeleton.boneMatrices,0).decompose(position,rotation,scale);
    scale.toArray().forEach((value,i)=>{report.bodyBone0Scale.minimum[i]=Math.min(report.bodyBone0Scale.minimum[i],value);report.bodyBone0Scale.maximum[i]=Math.max(report.bodyBone0Scale.maximum[i],value);});
    for(const [name,probe] of [['dynamic',dynamicProbe],['restSecondary',restProbe]])for(const contact of probe.sample()){
      const key=contact.pair.join(' <> '),row=report.variants[name][key]??={samples:0,phases:[],firstTime:time,lastTime:time,witness:contact.witness};row.samples++;row.lastTime=time;if(!row.phases.includes(phase))row.phases.push(phase);
    }
    for(const row of restProbe.distances(measuredPairs)){const key=row.pair.join(' <> ');if(!report.restMinimumGaps[key]||row.distance<report.restMinimumGaps[key].distance)report.restMinimumGaps[key]={distance:row.distance,time,phase};}
    report.samples++;if(frame%120===0)console.log({frame,phase});
  }
  report.secondaryDiagnostics=Object.fromEntries([...actor.mounts].filter(([,m])=>m.secondary).map(([id,m])=>[id,m.secondary.diagnostics()]));
  for(const name of ['animation-foundation-v1/contact/outfit-controls.mjs','animation-foundation-v1/contact/surface-probe.mjs','animation-foundation-v1/configuration/fixtures/complete-outfit.mjs','animation-foundation-v1/secondary-motion/index.mjs','animation-foundation-v1/secondary-motion/descriptors/cape.json','animation-foundation-v1/secondary-motion/descriptors/satchel.json','runtime-facepath05/fixtures/face-d2/asset.glb','original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'])report.sourceHashes[name]=sha256(path.join(root,name));
  report.status='completed';
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{dynamicProbe?.dispose();restProbe?.dispose();for(const g of geometries)g.dispose();pool.dispose();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
