import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {loadGLB,disposeAsset,hybrid,sha256} from '../integration/asset-fixtures.mjs';
import {createRigidTeaController} from '../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs';
import {createTeaClearanceCandidate} from './tea-clearance-candidate.mjs';
import {teaHandMotionBounds} from './tea-hand-motion-bound.mjs';
import {resolveCapeAttachment} from '../secondary-motion/cloth-probe/attachment-profile.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),requested=process.argv[2];
if(!requested||!path.isAbsolute(requested)||fs.existsSync(requested))throw Error('New absolute evidence directory required');
const out=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
if(out===root||out.startsWith(root))throw Error('External evidence required');fs.mkdirSync(out);
const sources={},read=name=>{sources[name]=sha256(path.join(root,name));return fs.readFileSync(path.join(root,name));};
const coarseBytes=read('animation-foundation-v1/secondary-motion/cloth-probe/cape-coarse.json'),coarse=JSON.parse(coarseBytes);
const profiles=Object.fromEntries(['original-65-v1','legacy-local-55-v1','tea-swept-51-v1'].map(name=>[name,resolveCapeAttachment(coarseBytes,name)]));
const inputs=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([k,v])=>[k,JSON.parse(read(`original-parts-hybrid-v1/tea/inputs/${v}.json`))]));
const identities={
  'original-parts-hybrid-v1/tea/src/rigid-tea.mjs':'b19b9f68f796cad766bc653ca174123f0b2e95e78680e03264639b7d4573a642',
  'original-parts-hybrid-v1/tea/src/timeline.mjs':'b53f198d6e3a464be3abd505758712094d083352ac8fe587051719a1fe2b11fa',
  'animation-foundation-v1/contact/tea-clearance-candidate.mjs':'c524e680214686772d75c5474122f7a8ebb3e9f516c972a8f0aa2c8b6971e745',
  'animation-foundation-v1/integration/tea-sample-boundary.mjs':'1891b86356aadd5c832b04926c1137896d250757ced21248544269a6b1bde166',
};
for(const [name,expected]of Object.entries(identities)){read(name);assert.equal(sources[name],expected,'Motion formula changed; review interval bounds');}
for(const name of ['contact/cape-pin-sweep.mjs','contact/tea-hand-motion-bound.mjs','secondary-motion/cloth-probe/attachment-profile.mjs','secondary-motion/cloth-probe/attachment-profiles.json','secondary-motion/cloth-probe/cape-binding.json'])read('animation-foundation-v1/'+name);
for(const [name,expected]of Object.entries({
  'original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb':'52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67',
  'wearable-approved-round5/accessory-expansion/models/07-cape.glb':'e29010956b989a60e196472b2206e6c397b34f12f3b7092d67f53f189c128e21',
})){read(name);assert.equal(sources[name],expected,'Frozen geometry identity changed');}
read('package-lock.json');
const report={status:'running',productionAccepted:false,scope:'Fixed material-support points versus actual closed hands; not cloth-triangle contact',sourceHashes:sources,profiles,variants:{},
  fixedPointRadius:.003,margin:1e-6,numericalAllowance:1e-9,
  limitations:['Does not certify free cloth, finite attachment patches, body/cup contact, seams, self-contact or full wardrobe.',
    'A released support has a real inside-hand witness; this does not prove a whole collision-free cloth solution exists.',
    'The two parameter branches cover the normal trajectory and every cancellation hand path of the pinned timeline, including reduced-motion rest. No interpolation of captured vertices is used.']};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');save();
let asset;const hands=[],point=new T.Vector3(),direction=new T.Vector3(.8123,.2317,.5351).normalize();
function auditClosed(g){
  const p=g.attributes.position,lookup=new Map(),remap=[],edges=new Map();
  for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].join(',');if(!lookup.has(key))lookup.set(key,lookup.size);remap.push(lookup.get(key));}
  for(let i=0;i<g.index.count;i+=3){const tri=[0,1,2].map(j=>remap[g.index.getX(i+j)]);assert.equal(new Set(tri).size,3,'Degenerate hand triangle');
    const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,g.index.getX(i+j)));
    assert(new T.Triangle(...vertices).getArea()>1e-14,'Zero-area hand triangle');
    for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`,e=edges.get(key)??{count:0,sign:0};e.count++;e.sign+=a<b?1:-1;edges.set(key,e);}}
  assert([...edges.values()].every(e=>e.count===2&&e.sign===0),'Hand must be closed and consistently oriented');
  return {weldedVertices:lookup.size,triangles:g.index.count/3,closed:true};
}
function winding(p,g){
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),cross=new T.Vector3();let sum=0;
  for(let i=0;i<g.index.count;i+=3){a.fromBufferAttribute(g.attributes.position,g.index.getX(i)).sub(p);b.fromBufferAttribute(g.attributes.position,g.index.getX(i+1)).sub(p);c.fromBufferAttribute(g.attributes.position,g.index.getX(i+2)).sub(p);
    const x=a.length(),y=b.length(),z=c.length();sum+=2*Math.atan2(a.dot(cross.crossVectors(b,c)),x*y*z+a.dot(b)*z+b.dot(c)*x+c.dot(a)*y);}
  return sum/(4*Math.PI);
}
function entryTime(u){
  if(u===0)return 0;if(u===1)return 1.2;
  let lo=0,hi=1;
  for(let i=0;i<54;i++){const m=(lo+hi)/2,s=m*m*m*(10+m*(-15+6*m));if(s<u)lo=m;else hi=m;}
  return (lo+hi)*.6;
}
function sampleParameter(controller,branch,u){return controller.sample(branch==='entry'?entryTime(u):u===0?2:2+entryTime(u)*1.4/1.2);}
try{
  asset=await loadGLB(hybrid);asset.updateMatrixWorld(true);
  for(const [name,meshName]of [['handL','Bubu_hand-left'],['handR','Bubu_hand-right']]){
    const mesh=asset.getObjectByName(meshName),geometry=mesh.geometry.clone();
    geometry.setAttribute('position',new T.BufferAttribute(new Float64Array(mesh.geometry.attributes.position.array),3));geometry.applyMatrix4(mesh.matrixWorld);
    const topology=auditClosed(geometry);hands.push({name,geometry,topology,bvh:new MeshBVH(geometry,{indirect:true})});
  }
  report.hands=hands.map(h=>({name:h.name,topology:h.topology}));
  for(const [variant,controller,forwardOffset]of [['baseline',createRigidTeaController(inputs),0],['candidate',createTeaClearanceCandidate(inputs),.0098]]){
    const result=report.variants[variant]={witnesses:{},profileConflicts:{},bounds:{},continuous:{status:'running',intervals:[],unresolved:[],initialWindingMaximum:0}};
    // Samples find failure witnesses only. Positive results below need bounds.
    for(let frame=0;frame<=540;frame++){
      const time=frame/60,state=controller.sample(time);
      for(const h of hands){const inverse=state.matrices[h.name].clone().invert();
        for(const pin of coarse.pins){point.fromArray(coarse.positions,pin*3).applyMatrix4(inverse);
          const hits=h.bvh.raycast(new T.Ray(point.clone(),direction),T.DoubleSide).sort((a,b)=>a.distance-b.distance);
          if(hits.filter((v,i)=>!i||Math.abs(v.distance-hits[i-1].distance)>1e-9).length%2){
            const w=winding(point,h.geometry);assert(Math.abs(Math.abs(w)-1)<1e-8,'Ambiguous inside witness');
            const depth=h.bvh.closestPointToPoint(point).distance,key=`${pin}/${h.name}`,old=result.witnesses[key];
            if(!old||depth>old.depth)result.witnesses[key]={pin,hand:h.name,time,depth,winding:w,position:coarse.positions.slice(pin*3,pin*3+3)};
          }
        }
      }
    }
    for(const [name,profile]of Object.entries(profiles))result.profileConflicts[name]=Object.values(result.witnesses).filter(w=>profile.pins.includes(w.pin));
    const repaired=profiles['tea-swept-51-v1'];
    assert.deepEqual([...new Set(Object.values(result.witnesses).map(w=>w.pin))].sort((a,b)=>a-b),repaired.releasedPins,'Unexpected support conflict; revisit profile');
    for(const h of hands){
      const bound=teaHandMotionBounds(inputs,h.name,h.geometry.attributes.position.array,{forwardOffset});result.bounds[h.name]={...bound};
      assert(bound.restJoinError<1e-10,'Entry branch is discontinuous at rest');
      const hold=controller.sample(2).matrices[h.name].clone();hold.elements[14]-=forwardOffset;
      const actualGrip=new T.Vector3(...inputs.config.hands[h.name].gripSource).applyMatrix4(hold);
      result.bounds[h.name].liftJoinError=actualGrip.distanceTo(new T.Vector3(...bound.liftGripAtZero));
      assert(result.bounds[h.name].liftJoinError<1e-10,'Lift branch does not join held pose');
    }
    for(const branch of ['entry','lift']){
      const start=sampleParameter(controller,branch,0);
      for(const h of hands)for(const pin of repaired.pins){
        point.fromArray(coarse.positions,pin*3).applyMatrix4(start.matrices[h.name].clone().invert());
        const w=Math.abs(winding(point,h.geometry));result.continuous.initialWindingMaximum=Math.max(result.continuous.initialWindingMaximum,w);assert(w<1e-8,'Retained support starts inside hand');
      }
      const pending=[[0,1,0]];
      while(pending.length){
        const [begin,end,depth]=pending.pop(),middle=(begin+end)/2,state=sampleParameter(controller,branch,middle);
        assert(Math.abs(state[branch==='entry'?'handEntry':'lift']-middle)<1e-12,'Parameter inversion mismatch');
        let gap=Infinity,witness;
        for(const h of hands){const inverse=state.matrices[h.name].clone().invert(),motion=result.bounds[h.name][branch]*(end-begin)/2+report.numericalAllowance;
          for(const pin of repaired.pins){point.fromArray(coarse.positions,pin*3).applyMatrix4(inverse);const distance=h.bvh.closestPointToPoint(point).distance,lower=distance-motion-report.fixedPointRadius;
            if(lower<gap){gap=lower;witness={pin,hand:h.name,distance,motion};}}
        }
        if(gap>report.margin)result.continuous.intervals.push({branch,begin,end,gap,...witness});
        else if(depth<24){pending.push([middle,end,depth+1],[begin,middle,depth+1]);}
        else result.continuous.unresolved.push({branch,begin,end,gap,...witness});
        if(result.continuous.intervals.length+result.continuous.unresolved.length+pending.length>50000)throw Error('Continuous support certificate budget exceeded');
      }
    }
    result.continuous.status=result.continuous.unresolved.length?'unresolved':'certified';save();
    console.log(variant,{insideSupports:Object.keys(result.witnesses).length,retained:repaired.pins.length,continuous:result.continuous.status,intervals:result.continuous.intervals.length});
    assert.equal(result.continuous.status,'certified','Retained-support clearance not established');
  }
  report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{for(const h of hands)h.geometry.dispose();if(asset)disposeAsset(asset);report.resourcesReleased=true;save();}
