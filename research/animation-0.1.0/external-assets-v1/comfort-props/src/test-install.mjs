import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';import {StaticPropInstallation,placements} from './static-install.mjs';
const buffer=id=>{const b=fs.readFileSync(new URL('../models/'+id+'.glb',import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
for(const id of Object.keys(placements))test(id+' actual cold install and owned unload',async()=>{const parent=new T.Group(),actor=new T.Group();parent.add(actor);const instance=new StaticPropInstallation(parent);assert.equal(await instance.install(id,buffer(id)),true);assert.equal(instance.status,'ready');assert.equal(parent.children.length,2);const gs=new Set(),ms=new Set();instance.root.traverse(o=>{if(o.isMesh){gs.add(o.geometry);ms.add(o.material);}});let gd=0,md=0;gs.forEach(g=>g.addEventListener('dispose',()=>gd++));ms.forEach(m=>m.addEventListener('dispose',()=>md++));instance.dispose();instance.dispose();assert.equal(gd,gs.size);assert.equal(md,ms.size);assert.deepEqual(parent.children,[actor]);});
test('failed replacement retains existing valid visible prop',async()=>{const parent=new T.Group(),instance=new StaticPropInstallation(parent);await instance.install('mirror',buffer('mirror'));const original=instance.root;await assert.rejects(instance.install('tissue',new Uint8Array([1]).buffer));assert.equal(instance.root,original);assert.equal(parent.children.length,1);instance.dispose();});
test('late cold load after disposal cannot mount',async()=>{let resolve;const parent=new T.Group(),root=new T.Group();const g=new T.BoxGeometry(),m=new T.MeshStandardMaterial();root.add(new T.Mesh(g,m));let disposed=0;g.addEventListener('dispose',()=>disposed++);const instance=new StaticPropInstallation(parent,{parse:()=>new Promise(r=>resolve=r)});const pending=instance.install('mirror',new ArrayBuffer(0));instance.dispose();resolve({scene:root});assert.equal(await pending,false);assert.equal(disposed,1);assert.equal(parent.children.length,0);});
test('empty and unknown assets fail closed',async()=>{const instance=new StaticPropInstallation(new T.Group(),{parse:async()=>({scene:new T.Group()})});await assert.rejects(instance.install('other',new ArrayBuffer(0)));await assert.rejects(instance.install('mirror',new ArrayBuffer(0)));assert.equal(instance.parent.children.length,0);});
const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
const mutations={
 'x overflow':root=>root.traverse(o=>{if(o.isMesh)o.geometry.translate(100,0,0);}),
 'y overflow':root=>root.traverse(o=>{if(o.isMesh)o.geometry.translate(0,100,0);}),
 'z overflow':root=>root.traverse(o=>{if(o.isMesh)o.geometry.translate(0,0,100);}),
 'negative z overflow':root=>root.traverse(o=>{if(o.isMesh)o.geometry.translate(0,0,-100);}),
 'NaN geometry':root=>root.getObjectByProperty('isMesh',true).geometry.attributes.position.setX(0,NaN),
 'infinite position':root=>root.children[0].position.z=Infinity,
 'NaN scale':root=>root.children[0].scale.z=NaN,
 'huge scale':root=>root.children[0].scale.setScalar(100),
 'zero scale':root=>root.children[0].scale.x=0,
 'negative scale':root=>root.children[0].scale.x=-1,
 'root resized':root=>root.scale.setScalar(.5),
 'bad quaternion':root=>root.children[0].quaternion.set(0,0,0,2),
 'NaN quaternion':root=>root.children[0].quaternion.x=NaN,
 'invalid manual matrix':root=>{root.children[0].matrixAutoUpdate=false;root.children[0].matrix.elements[8]=100;},
 'nonfinite manual matrix':root=>{root.children[0].matrixAutoUpdate=false;root.children[0].matrix.elements[0]=NaN;},
};
for(const [name,mutate]of Object.entries(mutations))test(name+' fails closed, releases rejected candidate, preserves prior prop',async()=>{
 const parent=new T.Group();let candidate;let doMutation=false;
 const instance=new StaticPropInstallation(parent,{parse:async bytes=>{const result=await new GLTFLoader().parseAsync(bytes,'');if(doMutation){candidate=result.scene;mutate(candidate);}return result;}});
 await instance.install('tissue',buffer('tissue'));const previous=instance.root;doMutation=true;
 let geometryDisposed=0,materialDisposed=0,geometryCount=0,materialCount=0;
 const parse=instance.parse;instance.parse=async bytes=>{const result=await parse(bytes);const gs=new Set(),ms=new Set();result.scene.traverse(o=>{if(o.isMesh){gs.add(o.geometry);ms.add(o.material);}});geometryCount=gs.size;materialCount=ms.size;gs.forEach(g=>g.addEventListener('dispose',()=>geometryDisposed++));ms.forEach(m=>m.addEventListener('dispose',()=>materialDisposed++));return result;};
 await assert.rejects(instance.install('mirror',buffer('mirror')));assert.equal(instance.status,'failed');assert.equal(instance.root,previous);assert.deepEqual(parent.children,[previous]);assert.equal(candidate.children.length,0);assert.equal(geometryDisposed,geometryCount);assert.equal(materialDisposed,materialCount);instance.dispose();
});
