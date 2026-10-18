import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {paths,sha256} from '../../shared/paths.mjs';
import {createExistingWearableHostClass} from './existing-wearable-host.mjs';
import * as sprout from './local-adapters/sprout-adapter.mjs';
import * as sunhat from './local-adapters/sunhat-adapter.mjs';
import * as satchel from './local-adapters/satchel-adapter.mjs';
import * as scarf from './local-adapters/scarf-adapter.mjs';
const cfg=paths(), P=path.join(cfg.cache,'existing-wearables');
const {fixture}=await import(cfg.research+'/petting-continuous-r2/tools/fixture.mjs');
const {createContractCheckedMixedBindingAdapter}=await import(cfg.pkg+'/runtime/mixed-binding-contract.mjs');
const files=Object.fromEntries(Object.entries({sprout:'01-sprout',sunhat:'02-sunhat',satchel:'03-satchel',scarf:'04-scarf'}).map(([kind,dir])=>[kind,path.join(cfg.repo,'research/animation-0.1.0/accessories-v1',dir,kind+'.glb')]));
const inputs=Object.fromEntries(Object.entries(files).map(([k,p])=>[p,sha256(p)]));
const teaFile=path.join(cfg.reference,'tea/reports/normal-30fps-compact.json');
inputs[teaFile]=sha256(teaFile);
const tea=JSON.parse(fs.readFileSync(teaFile));
async function load(file){
 const loader=new GLTFLoader();loader.register(parser=>({name:'CPUTextureMetadataOnly',async loadTexture(index){const img=parser.json.images[parser.json.textures[index].source];await parser.getDependency('bufferView',img.bufferView);return new T.Texture();}}));
 const buffer=fs.readFileSync(file);return (await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'')).scene;
}
const f=await fixture(),skin=f.h.body.skin;
const owner=createContractCheckedMixedBindingAdapter({THREE:T,sourceSkin:skin,parts:await load(cfg.hybrid),assertSourceCurrent:()=>f.h.owner.assertCurrent(),contract:JSON.parse(fs.readFileSync(cfg.pkg+'/geometry/binding-manifest.json')),admittedSourceSHA256:sha256(cfg.source),candidateSHA256:sha256(cfg.hybrid)});
const {ExistingWearableHost}=createExistingWearableHostClass({sprout,sunhat,satchel,scarf});
const host=new ExistingWearableHost({actorRoot:f.h.owner.root,parent:f.h.body.offset,sourceSkin:skin,hybridOwner:owner,assertSourceCurrent:()=>f.h.owner.assertCurrent(),assertAdmission:()=>{}});
for(const kind of ['sunhat','satchel','scarf'])host.install(kind,await load(files[kind]));
const geometry=path.join(P,'review/tea-geometry');fs.mkdirSync(geometry,{recursive:true});
const point=new T.Vector3(),sharedMeshes={},frames=[];
function positions(mesh){
 if(mesh.positions)return new Float32Array(mesh.positions);
 const buffer=fs.readFileSync(mesh.positionsFile);inputs[mesh.positionsFile]??=sha256(mesh.positionsFile);
 return new Float32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4);
}
for(let frameIndex=0;frameIndex<tea.frames.length;frameIndex++){
 const frame=tea.frames[frameIndex];
 const hands=frame.meshes.filter(m=>m.name.startsWith('Bubu_hand')).map(local=>{
  const m={...tea.sharedMeshes[local.name],...local},p=positions(m),box=new T.Box3();
  for(let i=0;i<p.length;i+=3)box.expandByPoint(point.fromArray(p,i));
  return{center:box.getCenter(new T.Vector3()).toArray(),radii:box.getSize(new T.Vector3()).multiplyScalar(.5).toArray()};
 });
 host.update(frame.time,{contacts:hands});
 const inverse=skin.matrixWorld.clone().invert(),meshes=[];
 for(const {adapter}of host.items.values())adapter.root.traverseVisible(mesh=>{
  if(!mesh.isMesh)return;
  const matrix=inverse.clone().multiply(mesh.matrixWorld),g=mesh.geometry,p=new Float32Array(g.attributes.position.count*3);
  for(let i=0;i<g.attributes.position.count;i++){mesh.getVertexPosition(i,point).applyMatrix4(matrix).toArray(p,i*3);}
  const file=path.join(geometry,frameIndex+'-'+mesh.name+'.f32');fs.writeFileSync(file,Buffer.from(p.buffer));
  sharedMeshes[mesh.name]??={name:mesh.name,indices:Array.from(g.index?.array??Array.from({length:g.attributes.position.count},(_,i)=>i)),materialName:mesh.material.name,materialColor:mesh.material.color?.toArray(),opacity:mesh.material.opacity};
  meshes.push({name:mesh.name,positionsFile:file});
 });
 frames.push({time:frame.time,label:frame.label,meshes});
}
for(const[file,digest]of Object.entries(inputs))if(sha256(file)!==digest)throw Error('Changed source '+file);
const output={sourceGLB:cfg.source,assetGLBs:Object.values(files),scope:'Actual candidate deformation in source coordinates with supplied tea hand contact envelopes; original tea body/face/hand/cup geometry unchanged.',inputs,sharedMeshes,frames};
fs.writeFileSync(path.join(P,'review/tea-wearables.json'),JSON.stringify(output));
host.dispose();owner.dispose();f.h.dispose();console.log(JSON.stringify({frames:frames.length,meshes:Object.keys(sharedMeshes),inputsVerified:true}));
