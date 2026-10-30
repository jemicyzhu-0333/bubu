import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import {createConformingWireCloth} from './conforming-wire-cloth.mjs';
import {resolveCapeAttachment} from './attachment-profile.mjs';
const coarseBytes=fs.readFileSync(new URL('./cape-coarse.json',import.meta.url)),coarse=JSON.parse(coarseBytes),pins=resolveCapeAttachment(coarseBytes).pins;
const frozen=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url))),proxy=JSON.parse(fs.readFileSync(new URL('./fixtures/wire-local-body-proxy-v2.json',import.meta.url)));
const geometry=data=>{const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(data.positions,3));g.setIndex(data.indices);return g;};
test('coupled cloth starts at equilibrium without pinned-cluster collapse or artificial resting bending impulses',async()=>{
  await R.init();const world=new R.World({x:0,y:0,z:0}),parts=frozen.parts.map(p=>({name:p.name,geometry:geometry(p)})),bodyProxy=geometry(proxy);let coupled;
  try{
    coupled=createConformingWireCloth(R,world,parts,coarse,pins,{bodyProxy});
    const before=coupled.readParticles(),rest=coupled.readRendered().slice();
    assert.deepEqual(rest,coupled.skin.skinPositions);
    assert.equal(coupled.skin.certificate.fixedParticles,pins.length);
    assert.equal(coupled.skin.certificate.jointCount+coupled.skin.certificate.coincidentWirePins,360);
    assert(coupled.skin.certificate.coincidentWirePins>0);
    assert(Math.abs(coupled.skin.certificate.clothMass+coupled.skin.certificate.wireMass-.444)<1e-12);
    for(let i=0;i<4;i++)world.step();
    const after=coupled.readParticles();
    assert(Math.max(...after.map((v,i)=>Math.abs(v-before[i])))<1e-6,'An unforced resting garment must not collapse or relax by millimetres');
    assert(Math.max(...coupled.readRendered().map((v,i)=>Math.abs(v-rest[i])))<1e-6);
    for(let i=0;i<parts.length;i++)assert.deepEqual(Array.from(parts[i].geometry.attributes.position.array),frozen.parts[i].positions);
    coupled.dispose();coupled.dispose();assert.throws(()=>coupled.readParticles(),/disposed/);
  }finally{coupled?.dispose();world.free();bodyProxy.dispose();for(const p of parts)p.geometry.dispose();}
});

test('direct front surfaces render their actual collision particles and preserve exterior topology under motion',async()=>{
  await R.init();const world=new R.World({x:0,y:-9.81,z:0}),parts=frozen.parts.map(p=>({name:p.name,geometry:geometry(p)})),bodyProxy=geometry(proxy);let coupled;
  try{
    const binding=JSON.parse(fs.readFileSync(new URL('./cape-binding.json',import.meta.url)));
    coupled=createConformingWireCloth(R,world,parts,coarse,pins,{bodyProxy,transfiniteBinding:binding,resolvedFronts:true});
    assert.equal(coupled.skin.certificate.particleCount,1996);
    const bodies=[];world.forEachSoftBody(body=>{if(body.numParticles()===247)bodies.push(body);});assert.equal(bodies.length,2);
    const pairs=parts.filter(p=>p.name.startsWith('cape_front_edge')).map(part=>{
      const range=coupled.skin.ranges.find(r=>r.name===part.name),start=coarse.positions.slice((part.name.endsWith('_0')?0:coarse.pins.at(-1))*3,(part.name.endsWith('_0')?0:coarse.pins.at(-1))*3+3);
      const body=bodies.find(b=>Math.hypot(...b.particlePositions().slice(0,3).map((v,i)=>v-start[i]))<1e-7);assert(body);
      return {body,part,range};
    });
    world.timestep=1/240;for(let step=0;step<4;step++){
      world.step();const render=coupled.readRendered();
      for(const {body,part,range}of pairs){
        const actual=body.particlePositions(),collision=body.meshVertices(0);assert.deepEqual(collision,actual);
        assert(body.isMeshOriented(0)&&body.meshCollisionEnabled(0));
        for(let vertex=0;vertex<247;vertex++){
          const section=Math.floor(vertex/13),sample=Math.max(1,vertex%13),physical=sample*19+section;
          for(let k=0;k<3;k++)assert.equal(render[(range.start+vertex)*3+k],collision[physical*3+k]);
        }
        const indices=body.meshIndices(0);
        for(let i=0;i<part.geometry.index.count;i++){
          const vertex=part.geometry.index.array[i],expected=Math.max(1,vertex%13)*19+Math.floor(vertex/13);
          assert.equal(indices[i],expected,'Original exterior faces remain the actual collision faces');
        }
      }
    }
    for(let i=0;i<parts.length;i++)assert.deepEqual(Array.from(parts[i].geometry.attributes.position.array),frozen.parts[i].positions);
  }finally{coupled?.dispose();world.free();bodyProxy.dispose();for(const p of parts)p.geometry.dispose();}
});
