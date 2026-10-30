/** Replay saved actual render failures without rerunning or trusting a solver. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [root,input,output]=process.argv.slice(2);assert(root&&input&&output&&!fs.existsSync(output));
const load=relative=>import(pathToFileURL(path.join(root,relative)).href);
const [T,{MeshBVH},{loadGLB,disposeAsset,hybrid},{createTeaObstacles},{createTeaClearanceCandidate}]=await Promise.all([
  load('node_modules/three/build/three.module.js'),load('node_modules/three-mesh-bvh/src/index.js'),
  load('animation-foundation-v1/integration/asset-fixtures.mjs'),load('animation-foundation-v1/secondary-motion/cloth-probe/tea-obstacles.mjs'),
  load('animation-foundation-v1/contact/tea-clearance-candidate.mjs')]);
const prior=JSON.parse(fs.readFileSync(path.join(input,'endpoint-cloth.json'))),vertices=JSON.parse(fs.readFileSync(path.join(input,'failed-rendered.json')));
const sourceName='animation-foundation-v1/integration/diagnostics/contact-contract-20261019/frozen-cape.json',source=fs.readFileSync(path.join(root,sourceName));
assert.equal(createHash('sha256').update(source).digest('hex'),prior.inputHashes[sourceName]);
const frozen=JSON.parse(source),deformable=frozen.parts.filter(p=>p.name!=='cape_clasp');
assert.equal(vertices.length,deformable.reduce((sum,p)=>sum+p.positions.length,0));assert(vertices.every(Number.isFinite));
let offset=0,minimum=Infinity,maximum=0,minimumWitness,maximumWitness;
const parts=[],owned=[];
for(const part of frozen.parts){
  const moved=part.name==='cape_clasp'?part.positions:vertices.slice(offset,offset+part.positions.length),start=offset/3;
  if(part.name!=='cape_clasp')for(let i=0;i<part.indices.length;i+=3)for(let j=0;j<3;j++){
    const a=part.indices[i+j]*3,b=part.indices[i+(j+1)%3]*3;
    const length=Math.hypot(...[0,1,2].map(k=>part.positions[a+k]-part.positions[b+k]));if(length<1e-8)continue;
    const ratio=Math.hypot(...[0,1,2].map(k=>moved[a+k]-moved[b+k]))/length,witness={part:part.name,a:start+a/3,b:start+b/3,restLength:length,ratio};
    if(ratio<minimum){minimum=ratio;minimumWitness=witness;}if(ratio>maximum){maximum=ratio;maximumWitness=witness;}
  }
  const geometry=new T.BufferGeometry();owned.push(geometry);geometry.setAttribute('position',new T.Float32BufferAttribute(moved,3));geometry.setIndex(part.indices);
  parts.push({name:part.name,geometry,bvh:new MeshBVH(geometry,{indirect:true})});if(part.name!=='cape_clasp')offset+=part.positions.length;
}
const last=prior.rows.at(-1);assert(Math.abs(minimum-last.renderStrain.min)<1e-9);assert(Math.abs(maximum-last.renderStrain.max)<1e-9);
let asset,obstacles;const result={status:'running',accepted:false,scope:'Independent saved actual render geometry replay; no realtime or full-trajectory claim',time:prior.stoppedAt.time,
  sourceHash:createHash('sha256').update(source).digest('hex'),savedRenderHash:createHash('sha256').update(fs.readFileSync(path.join(input,'failed-rendered.json'))).digest('hex'),
  limits:{minimumStrain:.8,maximumStrain:1.2,pinError:1e-5},strain:{minimum,maximum,minimumWitness,maximumWitness}};
try{
  asset=await loadGLB(hybrid);obstacles=createTeaObstacles(asset);
  const inputs=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([key,name])=>[key,JSON.parse(fs.readFileSync(path.join(root,`original-parts-hybrid-v1/tea/inputs/${name}.json`)))]));
  const controller=createTeaClearanceCandidate(inputs);obstacles.apply(controller.sample(result.time));
  const identity=new T.Matrix4();result.contacts=[];
  for(const part of parts)for(const obstacle of obstacles.entries){if(obstacle.visible===false)continue;
    if(part.bvh.bvhcast(obstacle.bvh,identity,{intersectsTriangles:(a,b)=>a.intersectsTriangle(b)}))result.contacts.push(`${part.name}/${obstacle.name}`);
  }
  assert.deepEqual(result.contacts.toSorted(),last.contacts.toSorted());
  if(prior.renderPinWitnesses){
    result.renderPinError=Math.max(...prior.renderPinWitnesses.map(w=>Math.hypot(...[0,1,2].map(k=>vertices[w.vertex*3+k]-w.position[k]))));
    assert(Math.abs(result.renderPinError-last.renderPinError)<1e-9);
  }
  result.failureReproduced=minimum<.8||maximum>1.2||result.contacts.length>0||(result.renderPinError??0)>1e-5;
  assert(result.failureReproduced);result.status='completed';
}finally{obstacles?.dispose();for(const geometry of owned)geometry.dispose();if(asset)disposeAsset(asset);fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});}
console.log({status:result.status,time:result.time,strain:result.strain,contacts:result.contacts,renderPinError:result.renderPinError,failureReproduced:result.failureReproduced});
