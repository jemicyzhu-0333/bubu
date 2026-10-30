import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import { validateCollisionSkin } from './collision-skin.mjs';
import { createRegionalCollisionSkin } from './regional-collision-skin.mjs';
import { resolveCapeAttachment } from './attachment-profile.mjs';

for(const [profile,expectedWitnesses]of [['legacy-local-55-v1',29],['tea-swept-51-v1',25]])
test(`actual regional cage preserves source geometry, bounded ownership and unloaded rest pose: ${profile}`,async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bubu-regional-skin-')),parts=[];let world,region;
  try{
    const output=path.join(temporary,'skin.json');
    await promisify(execFile)('python3',[fileURLToPath(new URL('./author-collision-skin.py',import.meta.url)),'--attachment-profile',profile,'--refine-boundary','--cloth-region','--output',output],
      {timeout:30000,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1'}});
    const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url)));
    const coarse=read('./cape-coarse.json'),binding=read('./cape-binding.json'),frozen=read('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json');
    for(const p of frozen.parts){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(p.positions,3));geometry.setIndex(p.indices);parts.push({name:p.name,geometry});}
    const before=parts.map(p=>Array.from(p.geometry.attributes.position.array)),coarseBytes=fs.readFileSync(new URL('./cape-coarse.json',import.meta.url));
    const pins=[...resolveCapeAttachment(coarseBytes,profile).pins],authored=JSON.parse(fs.readFileSync(output));
    assert.equal(authored.attachmentProfile,profile);
    const other=profile==='legacy-local-55-v1'?'tea-swept-51-v1':'legacy-local-55-v1';
    assert.throws(()=>validateCollisionSkin(authored,parts.filter(p=>p.name==='cape_cloth'),coarse,[...resolveCapeAttachment(coarseBytes,other).pins]),'Cages cannot borrow another profile\'s pin contract');
    const skin=validateCollisionSkin(authored,parts.filter(p=>p.name==='cape_cloth'),coarse,pins);
    await R.init();world=new R.World({x:0,y:0,z:0});
    region=createRegionalCollisionSkin(R,world,skin,parts,coarse,binding,pins,{meshScaledMaterial:true,additionalPgsIterations:12});
    assert(region.skin.certificate.particleCount<=2048);assert(region.skin.certificate.cellCount<=4096);assert(region.skin.certificate.crossSectionClusters<=194);
    assert.equal(region.skin.certificate.renderCount,7739);
    assert.equal(region.cloth.numMeshes(),6);assert.equal(region.cloth.meshCollisionEnabled(0),false);
    assert(Math.max(...region.readRendered().map((v,i)=>Math.abs(v-region.skin.skinPositions[i])))<1e-5);
    for(let i=0;i<3;i++)world.step();
    assert(Math.max(...region.readRendered().map((v,i)=>Math.abs(v-region.skin.skinPositions[i])))<1e-4);
    world.gravity={x:0,y:-9.81,z:0};for(let i=0;i<3;i++)world.step();
    const displayed=region.readRendered();let witnesses=0;
    for(const pin of pins)for(let i=0;i<skin.skinPositions.length;i+=3){
      if(Math.hypot(...[0,1,2].map(k=>skin.skinPositions[i+k]-coarse.positions[pin*3+k]))>1e-6)continue;
      witnesses++;assert(Math.hypot(...[0,1,2].map(k=>displayed[i+k]-skin.skinPositions[i+k]))<1e-5,'Actual visible fixed point must remain fixed under gravity');
    }
    assert.equal(witnesses,expectedWitnesses);
    assert.deepEqual(parts.map(p=>Array.from(p.geometry.attributes.position.array)),before);
    assert(Math.abs(region.skin.masses.reduce((s,v)=>s+v,0)-.444)<1e-6);
    region.dispose();region.dispose();assert.throws(()=>region.readRendered(),/disposed/);world.free();world=null;
    const thinInput=path.join(temporary,'original-skin.json');
    await promisify(execFile)('python3',[fileURLToPath(new URL('./author-collision-skin.py',import.meta.url)),'--attachment-profile',profile,'--output',thinInput],
      {timeout:30000,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1'}});
    const thinSkin=validateCollisionSkin(JSON.parse(fs.readFileSync(thinInput)),parts,coarse,pins);
    world=new R.World({x:0,y:0,z:0});region=createRegionalCollisionSkin(R,world,thinSkin,parts,coarse,binding,pins,{thinCloth:true,meshScaledMaterial:true});
    assert(region.cloth.meshCollisionEnabled(0)&&!region.cloth.isMeshSkinned(0));
    assert.deepEqual(region.cloth.meshIndices(0),Uint32Array.from(coarse.indices));
    assert.deepEqual(region.cloth.meshVertices(0).slice(0,coarse.positions.length),Float32Array.from(coarse.positions));
    assert.equal(region.skin.certificate.collisionSurface,'original coarse cloth triangles plus actual detailed piping');
    assert(Math.max(...region.readRendered().map((v,i)=>Math.abs(v-region.skin.skinPositions[i])))<1e-5);
    assert.deepEqual(parts.map(p=>Array.from(p.geometry.attributes.position.array)),before);
    region.dispose();world.free();world=new R.World({x:0,y:0,z:0});
    region=createRegionalCollisionSkin(R,world,thinSkin,parts,coarse,binding,pins,{thinCloth:true,meshScaledMaterial:true,bodyFrameDetail:true,closedPiping:true,coupledSeams:true,additionalPgsIterations:12});
    assert.equal(region.skin.certificate.particleCount,1812);
    assert.deepEqual(Array.from(region.skin.pins),pins,'No intermediate authored boundary point is silently pinned');
    assert.equal(region.skin.certificate.coupledSeams.boundarySurface.clothParticles,732);
    assert.equal(region.skin.certificate.coupledSeams.jointCount,360);
    assert.equal(region.cloth.meshIndices(0).length/3,1042);
    const coupledRest=region.readRendered().slice();
    world.timestep=1/240;for(let i=0;i<4;i++)world.step();
    assert(region.cloth.particlePositions().every(Number.isFinite));
    assert(Math.max(...region.readRendered().map((v,i)=>Math.abs(v-coupledRest[i])))<1e-6,'Bilateral material-point seams must retain the unforced rest pose');
    assert.deepEqual(parts.map(p=>Array.from(p.geometry.attributes.position.array)),before);
  }finally{region?.dispose();world?.free();for(const p of parts)p.geometry.dispose();fs.rmSync(temporary,{recursive:true,force:true});}
});

test('skinned cluster binding distinguishes overlapping independent cell regions',async()=>{
  await R.init();const world=new R.World({x:0,y:-9.81,z:0});
  try{
    const p=[-1,-1,-1,1,-1,-1,0,1,-1,0,0,1];
    const soft=world.createSoftBody(new R.SoftBodyDesc([...p,...p]).setCells([0,1,2,3,4,5,6,7])
      .setEdges([0,1,0,2,0,3,1,2,1,3,2,3,4,5,4,6,4,7,5,6,5,7,6,7]).setPinnedParticles([0,1,2,3]).setNoSurfaceCollider());
    const indices=[];
    for(const particles of [[0,1,2,3],[4,5,6,7]]){
      const cluster=world.addSoftBodyCluster(soft,particles),proxy=soft.clusterProxy(cluster);
      const inverse=new T.Matrix4().compose(new T.Vector3().copy(proxy.translation()),new T.Quaternion().copy(proxy.rotation()),new T.Vector3(1,1,1)).invert();
      const source=[-.2,-.2,0,.2,-.2,0,0,.2,0],local=new Float32Array(9);
      for(let i=0;i<3;i++)new T.Vector3().fromArray(source,i*3).applyMatrix4(inverse).toArray(local,i*3);
      const collider=world.createDeformableCollider(R.ColliderDesc.trimesh(local,new Uint32Array([0,1,2]),R.TriMeshFlags.DEFORMABLE),R.SoftMeshBinding.skinned(),proxy);
      assert(collider);indices.push(soft.meshOfCollider(collider));
    }
    for(let i=0;i<6;i++)world.step();
    assert(Math.abs(soft.meshVertices(indices[0])[1]+.2)<1e-6);
    assert(soft.meshVertices(indices[1])[1]<-.24);
  }finally{world.free();}
});
