import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {loadGLB,disposeAsset,sha256} from '../integration/asset-fixtures.mjs';
import {bakeAccessory} from '../secondary-motion/asset-admission.mjs';
import {createRigidTeaController} from '../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs';
import {createTeaSceneResources} from '../../original-parts-hybrid-v1/tea/src/scene-resources.mjs';
import {createTeaClearanceCandidate} from './tea-clearance-candidate.mjs';
import {cupMotionBound} from './tea-cup-motion-bound.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),output=process.argv[2];
if(!output||!path.isAbsolute(output)||fs.existsSync(output))throw Error('New absolute evidence directory required');
const out=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
if(out===root||out.startsWith(root))throw Error('External evidence required');
fs.mkdirSync(out);
const sourceHashes={},read=name=>{const file=path.join(root,name);sourceHashes[name]=sha256(file);return JSON.parse(fs.readFileSync(file));};
const inputs=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([key,name])=>[key,read(`original-parts-hybrid-v1/tea/inputs/${name}.json`)]));
const model='wearable-approved-round5/accessory-expansion/models/07-cape.glb';
sourceHashes[model]=sha256(path.join(root,model));
if(sourceHashes[model]!=='e29010956b989a60e196472b2206e6c397b34f12f3b7092d67f53f189c128e21')throw Error('Frozen cape changed');
for(const name of ['animation-foundation-v1/contact/tea-clearance-candidate.mjs','animation-foundation-v1/integration/tea-sample-boundary.mjs','animation-foundation-v1/contact/tea-cup-motion-bound.mjs','animation-foundation-v1/contact/tea-clearance-sweep.mjs','original-parts-hybrid-v1/tea/src/rigid-tea.mjs','original-parts-hybrid-v1/tea/src/timeline.mjs','original-parts-hybrid-v1/tea/src/cup-model.mjs','original-parts-hybrid-v1/tea/src/scene-resources.mjs'])sourceHashes[name]=sha256(path.join(root,name));
const report={status:'running',productionAccepted:false,sourceHashes,hz:60,scope:'Rigid cup assembly versus exact frozen round5 cape; coherent derived motion candidate only',variants:{},limitations:['Discrete surface checks do not establish continuous separation or containment.','Hands, body and cloth deformation remain separate failing gates.','No runtime admission or default tea animation is changed.']};
let raw,cup;const parts=[];
try{
  raw=await loadGLB(path.join(root,model));parts.push(...bakeAccessory(raw));
  const cape=parts.map(p=>({name:p.name,bvh:new MeshBVH(p.geometry,{indirect:true})}));
  cup=createTeaSceneResources();const pieces=[];
  cup.root.traverse(o=>{if(o.isMesh){
    const bvh=new MeshBVH(o.geometry,{indirect:true});o.geometry.boundsTree=bvh;
    pieces.push({mesh:o,bvh});
  }});
  cup.root.updateMatrixWorld(true);let radius=0;const vertex=new T.Vector3(),rootInverse=cup.root.matrixWorld.clone().invert();
  for(const {mesh} of pieces)for(let i=0;i<mesh.geometry.attributes.position.count;i++)radius=Math.max(radius,mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverse).length());
  const normal=Array.from({length:541},(_,i)=>({time:i/60,options:{},trajectory:'normal'}));
  const cancelled=[.6,1.3,1.7,2.7,4.1,5.5,6.8,7.4].flatMap(cancelAt=>Array.from({length:79},(_,i)=>({time:cancelAt+i/60,options:{cancelAt},trajectory:`cancel-${cancelAt}`})));
  for(const [name,controller] of [['baseline',createRigidTeaController(inputs)],['candidate',createTeaClearanceCandidate(inputs)]]){
    const row=report.variants[name]={samples:0,visibleSamples:0,framesWithContacts:0,pairs:{},phases:{},minimumClaspSurfaceGap:null};
    for(const sample of [...normal,...cancelled]){
      const state=controller.sample(sample.time,sample.options);cup.apply(state);cup.root.updateMatrixWorld(true);row.samples++;
      if(row.samples%120===0){console.log(name,{samples:row.samples,framesWithContacts:row.framesWithContacts});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
      row.phases[state.phase]=(row.phases[state.phase]??0)+1;
      if(!cup.root.visible)continue;row.visibleSamples++;let hits=0;
      for(const a of cape)for(const b of pieces){
        const matrix=b.mesh.matrixWorld;
        const intersect=a.bvh.bvhcast(b.bvh,matrix,{intersectsTriangles:(x,y)=>x.intersectsTriangle(y)});
        if(intersect){
          hits++;const key=`${a.name} <> ${b.mesh.name}`,pair=row.pairs[key]??={samples:0,phases:[],first:{time:sample.time,trajectory:sample.trajectory}};
          pair.samples++;if(!pair.phases.includes(state.phase))pair.phases.push(state.phase);
        }
        if(a.name.includes('clasp')&&row.minimumClaspSurfaceGap?.distance!==0){
          // A triangle crossing already proves zero separation. Otherwise use
          // the current global minimum as the BVH search's upper bound.
          const closest=intersect?{distance:0}:a.bvh.closestPointToGeometry(b.mesh.geometry,matrix,{},null,1e-14,row.minimumClaspSurfaceGap?.distance??Infinity);
          if(closest&&(row.minimumClaspSurfaceGap===null||closest.distance<row.minimumClaspSurfaceGap.distance))row.minimumClaspSurfaceGap={distance:closest.distance,time:sample.time,trajectory:sample.trajectory,piece:b.mesh.name};
        }
      }
      if(hits)row.framesWithContacts++;
    }
    console.log(name,{samples:row.samples,framesWithContacts:row.framesWithContacts,pairs:Object.keys(row.pairs),minimumClaspSurfaceGap:row.minimumClaspSurfaceGap});
  }
  if(!Object.keys(report.variants.baseline.pairs).some(k=>k.includes('clasp')))throw Error('Baseline did not reproduce clasp overlap');
  report.sampledCupClaspClear=!Object.keys(report.variants.candidate.pairs).some(k=>k.includes('clasp'));
  // The analytic enclosure below is tied to these exact motion formulas.
  // A controller revision requires reviewing its bound, not reusing this proof.
  for(const [name,expected] of Object.entries({
    'original-parts-hybrid-v1/tea/src/rigid-tea.mjs':'b19b9f68f796cad766bc653ca174123f0b2e95e78680e03264639b7d4573a642',
    'original-parts-hybrid-v1/tea/src/timeline.mjs':'b53f198d6e3a464be3abd505758712094d083352ac8fe587051719a1fe2b11fa',
    'animation-foundation-v1/contact/tea-clearance-candidate.mjs':'c524e680214686772d75c5474122f7a8ebb3e9f516c972a8f0aa2c8b6971e745',
    'animation-foundation-v1/integration/tea-sample-boundary.mjs':'1891b86356aadd5c832b04926c1137896d250757ced21248544269a6b1bde166',
  }))if(sourceHashes[name]!==expected)throw Error('Continuous motion-bound formula identity changed: '+name);
  const controller=createTeaClearanceCandidate(inputs),clasps=cape.filter(p=>p.name.includes('clasp'));
  if(clasps.length!==1)throw Error('Exactly one frozen clasp required');
  const continuous=report.continuousCupClasp={status:'running',margin:1e-6,cupRadius:radius,intervals:[],unresolved:[],scope:'Surface separation from the fixed round5 clasp; exact normal and eight declared cancellation trajectories only'};
  for(const cancelAt of [null,.6,1.3,1.7,2.7,4.1,5.5,6.8,7.4]){
    const options={cancelAt},knots=[0,1.2,1.5,2,3.4,4.8,6.2,6.6,6.9,8.1,9];
    if(cancelAt!==null){const at=controller.sample(cancelAt),fade=at.cupScale>0?.18:0,rewind=at.lift>0?.32:0;knots.push(cancelAt,cancelAt+fade,cancelAt+fade+rewind,cancelAt+fade+rewind+.6);}
    const times=[...new Set(knots.filter(t=>t>=0&&t<=9))].sort((a,b)=>a-b),pending=[];
    for(let i=0;i<times.length-1;i++)pending.push([times[i],times[i+1],0]);
    while(pending.length){
      const [begin,end,depth]=pending.pop(),middle=(begin+end)/2,a=controller.sample(begin,options),b=controller.sample(middle,options),c=controller.sample(end,options);
      if(a.cupScale===0&&b.cupScale===0&&c.cupScale===0)continue;
      cup.apply(b);cup.root.updateMatrixWorld(true);
      let distance=Infinity;
      for(const piece of pieces){const near=clasps[0].bvh.closestPointToGeometry(piece.mesh.geometry,piece.mesh.matrixWorld,{},null,1e-14,distance);if(near)distance=Math.min(distance,near.distance);}
      const bound=cupMotionBound(a,b,c,{...inputs,radius});
      if(distance>bound+continuous.margin)continuous.intervals.push({cancelAt,begin,end,distance,bound,certifiedGap:distance-bound});
      else if(depth<20){pending.push([begin,middle,depth+1],[middle,end,depth+1]);}
      else continuous.unresolved.push({cancelAt,begin,end,distance,bound});
      if(continuous.intervals.length+pending.length>20000)throw Error('Continuous certificate budget exceeded');
    }
  }
  continuous.status=continuous.unresolved.length?'unresolved':'certified';
  console.log('continuous clasp',continuous.status,{intervals:continuous.intervals.length,unresolved:continuous.unresolved.length});
  report.status='completed';
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{
  cup?.dispose();for(const p of parts)p.geometry.dispose();if(raw)disposeAsset(raw);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
