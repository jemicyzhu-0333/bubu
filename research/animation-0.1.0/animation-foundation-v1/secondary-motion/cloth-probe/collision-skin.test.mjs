import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import { validateCollisionSkin } from './collision-skin.mjs';

function fixture() {
  const coarse={positions:[-1,-1,0,1,-1,0,1,1,0,-1,1,0],indices:[0,1,2,0,2,3]};
  const positions=[-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1];
  const cells=[0,1,2,6,0,1,5,6,0,4,5,6,0,2,3,7,0,2,6,7,0,4,6,7];
  for(let i=0;i<cells.length;i+=4){
    const [a,b,c,d]=cells.slice(i,i+4).map(j=>new T.Vector3().fromArray(positions,j*3));
    if(b.sub(a).dot(c.sub(a).cross(d.sub(a)))<0)[cells[i+1],cells[i+2]]=[cells[i+2],cells[i+1]];
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([-.8,-.8,.2,.8,-.8,.2,0,.8,.2],3));geometry.setIndex([0,1,2]);
  const pins=[0,1,2,3],parts=[{name:'cape_cloth',geometry}];
  const data={schema:'bubu-private-shell-proposal/1',positions,cells,baseCount:4,sourcePositions:coarse.positions,sourceTriangles:coarse.indices,
    centerPins:pins,pins:[0,1,2,3,4,5,6,7],skinPositions:Array.from(geometry.attributes.position.array),skinIndices:[0,1,2],parts:[{name:'cape_cloth',start:0,count:3}]};
  return {coarse,parts,pins,data};
}

test('collision skin requires complete unchanged render geometry and independent cell coverage',()=>{
  const f=fixture();
  try{
    const before=JSON.stringify(f.data),accepted=validateCollisionSkin(f.data,f.parts,f.coarse,f.pins);
    assert.equal(accepted.certificate.renderCount,3);assert(accepted.certificate.minimumCellVolume>0);
    assert(Math.abs(accepted.masses.reduce((sum,m)=>sum+m,0)-.004)<1e-9);
    assert(accepted.masses.every(m=>m>0));
    assert.equal(JSON.stringify(f.data),before);
    const changed=structuredClone(f.data);changed.skinPositions[0]+=.001;
    assert.throws(()=>validateCollisionSkin(changed,f.parts,f.coarse,f.pins),/original render vertex/);
    const missing=structuredClone(f.data);missing.skinIndices=[];
    assert.throws(()=>validateCollisionSkin(missing,f.parts,f.coarse,f.pins),/render triangles/);
    const uncovered=structuredClone(f.data);uncovered.positions=uncovered.positions.map((x,i)=>i%3===0?x+4:x);
    assert.throws(()=>validateCollisionSkin(uncovered,f.parts,f.coarse,f.pins),/Uncovered render vertex/);
  }finally{f.parts[0].geometry.dispose();}
});

test('collision skin rejects altered pin ownership, inverted cells and over-budget topology',()=>{
  const f=fixture();
  try{
    for(const mutate of [d=>d.pins.pop(),d=>[d.cells[0],d.cells[1]]=[d.cells[1],d.cells[0]],d=>d.positions.push(NaN),d=>d.cells=new Array(4097*4).fill(0)]){
      const bad=structuredClone(f.data);mutate(bad);assert.throws(()=>validateCollisionSkin(bad,f.parts,f.coarse,f.pins));
    }
  }finally{f.parts[0].geometry.dispose();}
});

test('Rapier collides at the detailed skin plane, with exact rest reconstruction and borrowed buffers unchanged',async()=>{
  await R.init();const f=fixture(),w=new R.World({x:0,y:0,z:-9.81});
  const before=Array.from(f.parts[0].geometry.attributes.position.array);
  try{
    const skin=validateCollisionSkin(f.data,f.parts,f.coarse,f.pins);
    const soft=w.createSoftBody(new R.SoftBodyDesc(skin.positions).setCells(skin.cells).setEdges(skin.edges)
      .setSkin(skin.skinPositions,skin.skinIndices).setSkinCollision(true).setPinnedParticles(skin.pins)
      .setParticleRadius(0).setSelfContacts(false).setOriented(false).setSurfaceCollider(R.ColliderDesc.ball(.001)));
    assert(soft.isMeshSkinned(0)&&soft.meshCollisionEnabled(0));
    assert.deepEqual(soft.meshVertices(0),skin.skinPositions);
    const ball=w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,0,.5));
    w.createCollider(R.ColliderDesc.ball(.05),ball);
    for(let i=0;i<90;i++)w.step();
    assert(ball.translation().z>.245&&ball.translation().z<.255,'Sphere must settle at the actual skin, not the outer cage');
    assert.deepEqual(Array.from(f.parts[0].geometry.attributes.position.array),before);
  }finally{w.free();f.parts[0].geometry.dispose();}
});
