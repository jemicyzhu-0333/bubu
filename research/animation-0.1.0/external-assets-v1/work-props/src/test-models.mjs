import {candidatePaths} from '../../shared/work-garden-paths.mjs';
const portable=candidatePaths('work-props');
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {factories} from './prop-models.mjs';
for(const [id,f] of Object.entries(factories)){
 test(`${id}: finite actual geometry, sockets and owned disposal`,()=>{const r=f(),gs=new Set(),ms=new Set();r.root.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(const v of p.array)assert.ok(Number.isFinite(v));gs.add(o.geometry);ms.add(o.material);}});assert.ok(gs.size);for(const s of Object.values(r.sockets))assert.ok(s.toArray().every(Number.isFinite));let gd=0,md=0;gs.forEach(g=>g.addEventListener('dispose',()=>gd++));ms.forEach(m=>m.addEventListener('dispose',()=>md++));const scene=new T.Scene();scene.add(r.root);r.dispose();r.dispose();assert.equal(gd,gs.size);assert.equal(md,ms.size);assert.equal(r.root.children.length,0);assert.equal(scene.children.length,0);});
 test(`${id}: GLB cold-load round trip, material and socket preservation`,async()=>{const file=fs.readFileSync(new URL('models/'+id+'.glb',portable.root));const ab=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);const gltf=await new GLTFLoader().parseAsync(ab,'');let meshCount=0;gltf.scene.traverse(o=>{if(o.isMesh){meshCount++;assert.ok(o.material.isMeshStandardMaterial);assert.ok(o.geometry.attributes.position.count>0);}});assert.ok(meshCount);const ref=f();for(const [k,v] of Object.entries(ref.sockets)){const node=gltf.scene.getObjectByName('socket_'+k);assert.ok(node,k);assert.ok(node.position.distanceTo(v)<1e-7);}ref.dispose();const gs=new Set(),ms=new Set();gltf.scene.traverse(o=>{if(o.isMesh){gs.add(o.geometry);ms.add(o.material);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());gltf.scene.clear();assert.equal(gltf.scene.children.length,0);});
 test(`${id}: rigid mount contacts survive existing-style root drag and long-press transforms`,()=>{const r=f();const rest=Object.fromEntries(Object.entries(r.sockets).map(([k,p])=>[k,p.clone()]));for(let i=0;i<=40;i++){const root=new T.Matrix4().compose(new T.Vector3(i*.01,.15*Math.sin(i/40*Math.PI),-.03*i),new T.Quaternion().setFromEuler(new T.Euler(0,i*.02,i*.008)),new T.Vector3(1,1,1));const inverse=root.clone().invert();for(const [k,p] of Object.entries(rest)){assert.ok(p.clone().applyMatrix4(root).applyMatrix4(inverse).distanceTo(p)<1e-10,k);}}r.dispose();});
}
test('failure does not produce an admitted prop',async()=>{await assert.rejects(new GLTFLoader().parseAsync(new Uint8Array([1,2,3]).buffer,''));});
test('work props preserve independent keys and inward-only laptop display',()=>{
 const k=factories.keyboard();let names=[];k.root.traverse(o=>{if(o.name.startsWith('Key_'))names.push(o.name);});assert.equal(names.length,19);assert.equal(new Set(names).size,names.length);assert.ok(names.includes('Key_space'));
 const l=factories.laptop(),display=l.root.getObjectByName('Laptop_inward_screen'),cover=l.root.getObjectByName('Laptop_plain_outer_lid');assert.ok(display&&cover);assert.notEqual(display.material,cover.material);assert.ok(display.position.z<cover.position.z);
 k.dispose();l.dispose();
});
test('scale and material constraints match the approved body design-unit contract',()=>{
 const limits={keyboard:[1.3,.18,.62],laptop:[1.3,.85,.95],microphone:[.3,.63,.3],drum:[1.03,.52,1.03]};
 for(const [id,f] of Object.entries(factories)){
  const r=f(),b=new T.Box3().setFromObject(r.root),size=b.getSize(new T.Vector3()).toArray();
  size.forEach((v,i)=>assert.ok(v<=limits[id][i],`${id} dimension ${i}: ${v}`));assert.ok(b.min.y>=-.000001);
  r.root.traverse(o=>{if(o.isMesh){assert.equal(o.material.metalness,0);assert.ok(o.material.roughness>=.6);assert.equal(o.material.map,null);assert.ok(!o.name.toLowerCase().includes('stick'));}});
  r.dispose();
 }
});
