import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createRigidFitSnapshot} from './rigid-fit-snapshot.mjs';
test('fit trials preserve actor geometry and capture world pose independently',()=>{
  const geometry=new T.BoxGeometry(1,1,1),a=new T.Mesh(geometry),b=new T.Mesh(geometry);a.name='a';b.name='b';
  a.position.set(4,3,2);b.position.set(4.4,3.2,2);a.updateMatrixWorld();b.updateMatrixWorld();
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  const sourcePositions=geometry.attributes.position.array.slice(),snapshot=createRigidFitSnapshot(new Map([['body',a],['bag',b]]));
  assert.equal(snapshot.intersections().length,1);assert.equal(snapshot.intersections({bag:[2,0,0]}).length,0);
  assert.equal(snapshot.intersections({body:[2,0,0],bag:[2,0,0]}).length,1);
  assert.ok(Math.abs(snapshot.minimumDistance({bag:[2,0,0]}).distance-1.4)<1e-12);
  assert.ok(snapshot.minimumDistance().distance<1e-12);
  b.position.x=20;b.updateMatrixWorld();assert.equal(snapshot.intersections().length,1);
  assert.deepEqual(geometry.attributes.position.array,sourcePositions);snapshot.dispose();snapshot.dispose();assert.equal(disposed,0);
  assert.throws(()=>snapshot.intersections(),/disposed/);
});
test('crossing planes express absolute relative translations without mutating the pose',()=>{
  const triangle=(vertices)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));return new T.Mesh(g);};
  const a=triangle([-2,-2,0,2,-2,0,0,2,0]),b=triangle([0,0,-.5,.5,0,.5,0,.5,.5]);
  a.name='plane';b.name='moving';a.updateMatrixWorld();b.updateMatrixWorld();
  const snapshot=createRigidFitSnapshot(new Map([['fixed',a],['moving',b]]));
  try{
    const rows=snapshot.separationPlanes({moving:[0,0,.2]},{fixed:'fixed',moving:'moving'});
    assert.equal(rows.length,1);assert.deepEqual(rows[0].normal,[0,0,1]);assert(Math.abs(rows[0].lower-.5)<1e-12);
    assert.equal(snapshot.intersections({moving:[0,0,.50001]}).length,0);
    assert.equal(snapshot.intersections().length,1);
  }finally{snapshot.dispose();a.geometry.dispose();b.geometry.dispose();}
});
