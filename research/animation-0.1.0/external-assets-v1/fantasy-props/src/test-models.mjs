import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {
  GLTFLoader
} from 'three/addons/loaders/GLTFLoader.js';
import {
  factories
} from './prop-models.mjs';
for(const [id,f] of Object.entries(factories)){
  test(`${id}: finite actual geometry, sockets and owned disposal`,()=>{
    const r=f(),gs=new Set(),ms=new Set();
    r.root.traverse(o=>{
      if(o.isMesh){
        const p=o.geometry.attributes.position;
        for(const v of p.array)assert.ok(Number.isFinite(v));
        gs.add(o.geometry);
        ms.add(o.material);
      }
    });
    assert.ok(gs.size);
    for(const s of Object.values(r.sockets))assert.ok(s.toArray().every(Number.isFinite));
    let gd=0,md=0;
    gs.forEach(g=>g.addEventListener('dispose',()=>gd++));
    ms.forEach(m=>m.addEventListener('dispose',()=>md++));
    const scene=new T.Scene();
    scene.add(r.root);
    r.dispose();
    r.dispose();
    assert.equal(gd,gs.size);
    assert.equal(md,ms.size);
    assert.equal(r.root.children.length,0);
    assert.equal(scene.children.length,0);
  });
  test(`${id}: GLB cold-load round trip, material and socket preservation`,async()=>{
    const file=fs.readFileSync(new URL('../models/'+id+'.glb',import.meta.url));
    const ab=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);
    const gltf=await new GLTFLoader().parseAsync(ab,'');
    let meshCount=0;
    gltf.scene.traverse(o=>{
      if(o.isMesh){
        meshCount++;
        assert.ok(o.material.isMeshStandardMaterial);
        assert.ok(o.geometry.attributes.position.count>0);
      }
    });
    assert.ok(meshCount);
    const ref=f();
    for(const [k,v] of Object.entries(ref.sockets)){
      const node=gltf.scene.getObjectByName('socket_'+k);
      assert.ok(node,k);
      assert.ok(node.position.distanceTo(v)<1e-7);
    }ref.dispose();
    const gs=new Set(),ms=new Set();
    gltf.scene.traverse(o=>{
      if(o.isMesh){
        gs.add(o.geometry);
        ms.add(o.material);
      }
    });
    gs.forEach(g=>g.dispose());
    ms.forEach(m=>m.dispose());
    gltf.scene.clear();
    assert.equal(gltf.scene.children.length,0);
  });
  test(`${id}: rigid socket matrix round trip, math only, no action compatibility claim`,()=>{
    const r=f();
    const rest=Object.fromEntries(Object.entries(r.sockets).map(([k,p])=>[k,p.clone()]));
    for(let i=0;
    i<=40;
    i++){
      const root=new T.Matrix4().compose(new T.Vector3(i*.01,.15*Math.sin(i/40*Math.PI),-.03*i),new T.Quaternion().setFromEuler(new T.Euler(0,i*.02,i*.008)),new T.Vector3(1,1,1));
      const inverse=root.clone().invert();
      for(const [k,p] of Object.entries(rest)){
        assert.ok(p.clone().applyMatrix4(root).applyMatrix4(inverse).distanceTo(p)<1e-10,k);
      }
    }r.dispose();
  });
} test('failure does not produce an admitted prop',async()=>{
  await assert.rejects(new GLTFLoader().parseAsync(new Uint8Array([1,2,3]).buffer,''));
});
for(const [id,f] of Object.entries(factories))test(`${id}: bounded geometry, vertex budget and manifest bounds`,()=>{
  const r=f();
  r.root.updateMatrixWorld(true);
  const b=new T.Box3().setFromObject(r.root,true),size=b.getSize(new T.Vector3());
  assert.ok(size.toArray().every(v=>v>0&&v<2.38));
  assert.ok(b.min.y>=(id==='ground-hole'?-.35:-.02),'ground penetration');
  let n=0;
  r.root.traverse(o=>{
    if(o.isMesh)n+=o.geometry.attributes.position.count;
  });
  assert.ok(n<20000);
  const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url)));
  const m=manifest.items.find(i=>i.id===id);
  assert.equal(m.vertices,n);
  assert.ok(new T.Vector3(...m.bounds.min).distanceTo(b.min)<1e-6);
  r.dispose();
});
import {
  createPropPool
} from './prop-pool.mjs';
for(const id of Object.keys(factories))test(`${id}: two instances share resources and release last-owner only`,()=>{
  const pool=createPropPool(),a=pool.acquire(id),b=pool.acquire(id);
  let am,bm;
  a.root.traverse(o=>{
    if(o.isMesh&&!am)am=o;
  });
  b.root.traverse(o=>{
    if(o.isMesh&&!bm)bm=o;
  });
  assert.equal(am.geometry,bm.geometry);
  assert.equal(am.material,bm.material);
  assert.notEqual(a.root,b.root);
  let disposed=0;
  am.geometry.addEventListener('dispose',()=>disposed++);
  a.root.position.x=2;
  assert.equal(b.root.position.x,0);
  a.release();
  a.release();
  assert.equal(disposed,0);
  assert.ok(b.root.children.length);
  assert.throws(()=>pool.close());
  b.release();
  assert.equal(disposed,1);
  assert.equal(pool.liveAssetCount,0);
  pool.close();
  assert.throws(()=>pool.acquire(id));
});
test('paired needle nodes share geometry, remain independent transforms',()=>{
  const r=factories['knitting-needle']();
  const a=r.root.getObjectByName('Needle_shaft_left'),b=r.root.getObjectByName('Needle_shaft_right');
  assert.equal(a.geometry,b.geometry);
  assert.equal(a.material,b.material);
  assert.notEqual(a.parent,b.parent);
  r.dispose();
});
test('environment hole has no grip and retains clipping contract',()=>{
  const r=factories['ground-hole']();
  assert.equal(r.root.userData.portable,false);
  assert.ok(r.root.getObjectByName('Hole_surrounding_ground'));
  assert.equal(r.sockets.grip,undefined);
  assert.ok(r.sockets.clipPlane);
  r.dispose();
});
import {
  insideOpening,clipActorFragment
} from './ground-hole-contract.mjs';
test('environment clipping mask is finite, local, bounded, and below-ground only',()=>{
  assert.equal(insideOpening([0,0,0]),true);
  assert.equal(clipActorFragment([0,.1,0]),false);
  assert.equal(clipActorFragment([0,-.1,0]),true);
  assert.equal(clipActorFragment([.6,-.1,0]),false);
  assert.throws(()=>insideOpening([NaN,0,0]));
});
