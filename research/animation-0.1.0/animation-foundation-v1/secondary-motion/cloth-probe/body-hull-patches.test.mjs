import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { partitionBodyHull } from './body-hull-patches.mjs';
const cube=()=>{
  const points=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])points.push(new T.Vector3(x,y,z));
  const raw=new ConvexGeometry(points);raw.deleteAttribute('normal');raw.deleteAttribute('uv');const geometry=mergeVertices(raw);raw.dispose();return geometry;
};
test('convex body patches cover each source face once and preserve the occupied volume in Rapier',async()=>{
  await R.init();const geometry=cube(),world=new R.World({x:0,y:0,z:0});
  try{
    const before=Array.from(geometry.attributes.position.array),result=partitionBodyHull(geometry,4);
    assert.equal(result.certificate.coveredFaces,12);assert.equal(result.certificate.uniformInflation,0);
    const colliders=result.patches.map(p=>world.createCollider(R.ColliderDesc.convexHull(p.positions)));
    const compound=world.createCollider(R.ColliderDesc.compound(result.patches.map(p=>R.ColliderDesc.convexHull(p.positions).shape),result.patches.map(()=>({x:0,y:0,z:0})),result.patches.map(()=>({x:0,y:0,z:0,w:1})),R.CompoundFlags.FIX_INTERNAL_EDGES));
    for(const x of [-1.01,-.9,0,.9,1.01])for(const y of [-1.01,-.9,0,.9,1.01])for(const z of [-1.01,-.9,0,.9,1.01]){
      assert.equal(colliders.some(c=>c.containsPoint({x,y,z})),Math.max(Math.abs(x),Math.abs(y),Math.abs(z))<1);
      assert.equal(compound.containsPoint({x,y,z}),Math.max(Math.abs(x),Math.abs(y),Math.abs(z))<1);
    }
    assert.deepEqual(Array.from(geometry.attributes.position.array),before);
  }finally{world.free();geometry.dispose();}
});
test('compound internal-face correction preserves sliding across a decomposition seam',async()=>{
  await R.init();const geometry=cube(),result=partitionBodyHull(geometry,4),worlds=[];
  try{
    const end=[];
    for(const compound of [false,true]){
      const world=new R.World({x:0,y:-9.81,z:0});worlds.push(world);
      const shape=compound?R.ColliderDesc.compound(result.patches.map(p=>R.ColliderDesc.convexHull(p.positions).shape),result.patches.map(()=>({x:0,y:0,z:0})),result.patches.map(()=>({x:0,y:0,z:0,w:1})),R.CompoundFlags.FIX_INTERNAL_EDGES):R.ColliderDesc.cuboid(1,1,1);
      world.createCollider(shape.setFriction(0));
      const body=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(-.75,1.051,0).setLinvel(1,0,0).setCanSleep(false));world.createCollider(R.ColliderDesc.ball(.05).setFriction(0),body);
      for(let i=0;i<60;i++)world.step();end.push(body.translation());
    }
    assert(Math.hypot(end[0].x-end[1].x,end[0].y-end[1].y,end[0].z-end[1].z)<1e-4);
    assert(end[1].x>.24);
  }finally{for(const world of worlds)world.free();geometry.dispose();}
});
test('body patches reject an open hull instead of inventing an occupied volume',()=>{
  const geometry=cube();try{geometry.setIndex(Array.from(geometry.index.array).slice(3));assert.throws(()=>partitionBodyHull(geometry,4),/Closed/);}finally{geometry.dispose();}
});
