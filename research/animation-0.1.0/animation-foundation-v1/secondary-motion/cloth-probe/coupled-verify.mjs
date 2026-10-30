/** Independent actual-surface check of the opt-in coupled solver's f32 output. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {loadGLB,disposeAsset,hybrid} from '../../integration/asset-fixtures.mjs';
import {createTeaObstacles} from './tea-obstacles.mjs';
import {createTeaClearanceCandidate} from '../../contact/tea-clearance-candidate.mjs';
import {createEdgeStrainMeasure} from './edge-strain.mjs';
import {measureCapeSeams} from './piping-section-mapper.mjs';
import {resolveCapeAttachment} from './attachment-profile.mjs';
import {createRenderPinMeasure} from './render-pin-witnesses.mjs';

const args=process.argv.slice(2);
assert.equal(args.length,2,'Usage: coupled-verify.mjs INPUT_JSON RUN_DIRECTORY');
const [inputFile,runDirectory]=args.map(p=>path.resolve(p));
const research=fs.realpathSync(fileURLToPath(new URL('../../../',import.meta.url)));
assert(!fs.realpathSync(runDirectory).startsWith(research+path.sep),'Evidence must stay outside research sources');
const input=JSON.parse(fs.readFileSync(inputFile));
const run=JSON.parse(fs.readFileSync(path.join(runDirectory,'coupled-cloth.json')));
const hash=filename=>createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
assert(Object.values(run.sourceHashes).includes(hash(inputFile)),'Trajectory input differs from the solved input');
for(const [name,expected]of Object.entries(input.sourceHashes)){
  const filename=path.resolve(research,name);
  assert(filename.startsWith(research+path.sep));
  assert.equal(hash(filename),expected,`Changed trajectory dependency: ${name}`);
}
const frozen=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url)));
assert.deepEqual(input.parts,frozen.parts,'Original surface topology/vertices must remain identical');
assert.equal(input.sourceModelSHA256,frozen.sha256);
const sourceFile=new URL('../../../wearable-approved-round5/accessory-expansion/models/07-cape.glb',import.meta.url);
assert.equal(createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'),frozen.sha256);
const sourceInput=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([key,name])=>[
  key,JSON.parse(fs.readFileSync(new URL(`../../../original-parts-hybrid-v1/tea/inputs/${name}.json`,import.meta.url))),
]));
const controller=createTeaClearanceCandidate(sourceInput);
const coarseFile=fileURLToPath(new URL('./cape-coarse.json',import.meta.url));
const coarseBytes=fs.readFileSync(coarseFile),attachment=resolveCapeAttachment(coarseBytes);
const sourceCloth=new Float32Array(input.parts.find(p=>p.name==='cape_cloth').positions);
const pins=createRenderPinMeasure(JSON.parse(coarseBytes),attachment.pins,sourceCloth);
const report={status:'running',productionAccepted:false,path:run.path,frames:run.rows.length,
  sourceHashes:{verifier:hash(fileURLToPath(import.meta.url)),input:hash(inputFile),rendered:hash(path.join(runDirectory,'rendered.f32')),
    coarse:hash(coarseFile),attachments:hash(fileURLToPath(new URL('./attachment-profiles.json',import.meta.url))),
    pinMeasure:hash(fileURLToPath(new URL('./render-pin-witnesses.mjs',import.meta.url)))},
  renderPins:{profile:attachment.profile,witnesses:pins.witnesses,unmatched:pins.unmatched,limit:1e-5},
  sourceModelSHA256:frozen.sha256,scope:'Exact original meshes against actual f32 rendered triangles at every saved step',
  rows:[],pairs:{},framesWithContacts:0,limitations:['Discrete samples; no general continuous/self-contact/containment acceptance','Rendered pins cover matching source vertices only, not finite attachment patches','Not a native GPU performance measurement']};
const destination=path.join(runDirectory,'actual-contact.json');
assert(!fs.existsSync(destination),'Choose an unverified run; never overwrite prior evidence');
const asset=await loadGLB(hybrid),moving=createTeaObstacles(asset),identity=new T.Matrix4(),parts=[];
let descriptor;
try{
  let count=0;
  for(const part of input.parts){
    const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(part.positions,3));
    geometry.setIndex(part.indices);
    const entry={name:part.name,geometry,bvh:new MeshBVH(geometry,{indirect:true}),start:count,
      strain:createEdgeStrainMeasure(part.positions,part.indices,3)};
    if(part.name!=='cape_clasp')count+=part.positions.length/3;
    parts.push(entry);
  }
  const bytes=Buffer.alloc(count*3*4),file=path.join(runDirectory,'rendered.f32');
  assert.equal(fs.statSync(file).size,bytes.length*run.rows.length);
  descriptor=fs.openSync(file,'r');
  for(const [i,row]of run.rows.entries()){
    const begin=performance.now();
    assert.equal(fs.readSync(descriptor,bytes,0,bytes.length,i*bytes.length),bytes.length);
    const values=new Float32Array(bytes.buffer,bytes.byteOffset,count*3);
    assert(values.every(Number.isFinite));
    for(const part of parts){
      if(part.name!=='cape_clasp')part.geometry.attributes.position.array.set(values.subarray(part.start*3,part.start*3+part.geometry.attributes.position.array.length));
      part.bvh.refit();
    }
    moving.apply(controller.sample(row.time,run.path==='cancel02'?{cancelAt:.2}:{}));
    const contacts=[];
    for(const part of parts)for(const obstacle of moving.entries){
      if(obstacle.visible!==false&&part.bvh.bvhcast(obstacle.bvh,identity,{intersectsTriangles:(a,b)=>a.intersectsTriangle(b)})){
        const pair=`${part.name}/${obstacle.name}`;contacts.push(pair);report.pairs[pair]=(report.pairs[pair]??0)+1;
      }
    }
    const strains=parts.filter(p=>p.name!=='cape_clasp').map(p=>p.strain(p.geometry.attributes.position.array));
    const strain=[Math.min(...strains.map(s=>s.min)),Math.max(...strains.map(s=>s.max))],seam=measureCapeSeams(parts).maximum;
    const renderPinError=pins.measure(parts.find(p=>p.name==='cape_cloth').geometry.attributes.position.array);
    if(contacts.length){
      report.framesWithContacts++;
      if(!report.firstContact){report.firstContact={frame:i,time:row.time,contacts};
        fs.writeFileSync(path.join(runDirectory,'first-contact-render-parts.json'),JSON.stringify(parts.map(p=>({name:p.name,positions:Array.from(p.geometry.attributes.position.array),indices:Array.from(p.geometry.index.array)}))));}
    }
    report.rows.push({frame:i,time:row.time,contacts,strain,seam,renderPinError,verificationMs:performance.now()-begin,
      totalWithSolveAndVerificationMs:row.totalWithMeasurementsMs+performance.now()-begin});
    if(i%60===0)console.log({frame:i,contacts});
  }
  report.status='completed';
  report.contactSamplesClear=report.framesWithContacts===0;
  report.strainSamplesClear=report.rows.every(r=>r.strain[0]>=.8&&r.strain[1]<=1.2);
  report.seamSamplesClear=report.rows.every(r=>r.seam<=1e-5);
  report.renderPinSamplesClear=report.rows.every(r=>r.renderPinError<=1e-5);
  report.reachedActionEndpoint=run.reachedActionEndpoint===true;
}finally{
  if(descriptor!==undefined)fs.closeSync(descriptor);
  moving.dispose();disposeAsset(asset);for(const part of parts)part.geometry.dispose();
  fs.writeFileSync(destination,JSON.stringify(report,null,2));
}
console.log({status:report.status,frames:report.frames,contactFrames:report.framesWithContacts,contact:report.contactSamplesClear,strain:report.strainSamplesClear,seam:report.seamSamplesClear});
