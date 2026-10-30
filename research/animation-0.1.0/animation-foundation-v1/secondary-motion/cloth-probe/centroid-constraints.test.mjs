import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import {createCentroidConstraints} from './centroid-constraints.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/front-centroid-instability.json', import.meta.url)));
test('real distorted front section stays finite with a particle attachment and preserves its constraints', async () => {
  await R.init();
  for (const particleCentroids of [false, true]) {
    const world = new R.World({x:0,y:0,z:0});
    try {
      world.timestep = 1/60; world.integrationParameters.lengthUnit = 100;
      const {rest, masses, edges, positions, velocities} = fixture;
      const description = new R.SoftBodyDesc(rest.map(v=>v*100)).setEdges(edges).setMasses(masses)
        .setSoftness(30,1).setAdditionalPgsIterations(12).setNoSurfaceCollider().setParticleRadius(0);
      const softness = [];
      for (let i=0;i<edges.length;i+=2) {
        const a=edges[i]*3,b=edges[i+1]*3;
        softness.push({naturalFrequency:30*.08/Math.hypot(...[0,1,2].map(k=>rest[a+k]-rest[b+k])),dampingRatio:1});
      }
      description.setEdgeSoftness(softness.map((_,i)=>i),softness);
      const cloth=world.createSoftBody(description);
      cloth.enableClusterShapeMatching(world.addSoftBodyCluster(cloth,Array.from({length:13},(_,i)=>i)),true);
      const proxy=cloth.clusterProxy(world.addSoftBodyCluster(cloth,Array.from({length:12},(_,i)=>i+1)));
      const centroids=createCentroidConstraints(R,world,cloth,{particleCentroids});
      centroids.connect(proxy,0,{x:rest[0]*100,y:rest[1]*100,z:rest[2]*100},false);
      assert.equal(centroids.certificate().centroidConstraints,1);
      assert.equal(cloth.numEdges(),edges.length/2);
      for(let i=0;i<13;i++) {
        cloth.setParticlePosition(i,{x:positions[i*3]*100,y:positions[i*3+1]*100,z:positions[i*3+2]*100});
        cloth.setParticleVelocity(i,{x:velocities[i*3]*100,y:velocities[i*3+1]*100,z:velocities[i*3+2]*100});
      }
      world.step();
      assert.equal(cloth.particlePositions().every(Number.isFinite),particleCentroids);
      if(particleCentroids)for(let i=1;i<8;i++) {
        world.step();
        assert(cloth.particlePositions().every(Number.isFinite));
        assert(cloth.particleVelocities().every(Number.isFinite));
      }
    } finally { world.free(); }
  }
});

test('a second section retains the first attachment and constrains the second centroid', async () => {
  await R.init();
  const world=new R.World({x:0,y:0,z:0});
  try {
    const rest=[0,0,0, -1,0,0, 1,0,0, 0,-1,0, 0,1,0];
    const cloth=world.createSoftBody(new R.SoftBodyDesc(rest).setParticleMass(1).setNoSurfaceCollider());
    const first=cloth.clusterProxy(world.addSoftBodyCluster(cloth,[1,2]));
    const second=cloth.clusterProxy(world.addSoftBodyCluster(cloth,[3,4]));
    const centroids=createCentroidConstraints(R,world,cloth,{particleCentroids:true});
    centroids.connect(first,0,{x:0,y:0,z:0},false);
    centroids.connect(second,0,{x:0,y:0,z:0},false);
    assert.equal(cloth.numAttachments(),1);
    assert.equal(cloth.attachmentBody(0).handle,first.handle);
    assert.equal(centroids.certificate().centroidConstraints,2);
    assert.equal(centroids.certificate().joints,1);
    cloth.setParticleVelocity(3,{x:0,y:0,z:1});cloth.setParticleVelocity(4,{x:0,y:0,z:1});
    for(let i=0;i<4;i++)world.step();
    const p=cloth.particlePositions();
    assert(p.every(Number.isFinite));
    assert(p[2]>0,'Motion must propagate back to the material center');
    assert(Math.abs(p[2]-(p[5]+p[8])/2)<1e-5);
    assert(Math.abs(p[2]-(p[11]+p[14])/2)<1e-5);
  } finally {world.free();}
});
