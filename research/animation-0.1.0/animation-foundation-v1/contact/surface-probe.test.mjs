import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createSurfaceProbe} from './surface-probe.mjs';
test('surface probe handles transformed local triangles and borrowed geometry',()=>{
  const geometry=new T.BoxGeometry(1,1,1),a=new T.Mesh(geometry),b=new T.Mesh(geometry);a.name='a';b.name='b';
  a.position.set(4,3,2);b.position.set(4.4,3.2,2);a.updateMatrixWorld();b.updateMatrixWorld();
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  const probe=createSurfaceProbe(new Map([['body',a],['wearable',b]]));
  const contacts=probe.sample();assert.equal(contacts.length,1);assert(contacts[0].witness.a.every(v=>v[0]>3));
  b.position.x=8;b.updateMatrixWorld();assert.equal(probe.sample().length,0);
  probe.dispose();assert.equal(disposed,0);
});
test('surface probe does not claim containment or same-garment contact',()=>{
  const root=new T.Group(),outer=new T.Mesh(new T.BoxGeometry(2,2,2)),inner=new T.Mesh(new T.BoxGeometry(.2,.2,.2));root.add(outer);root.updateMatrixWorld();inner.updateMatrixWorld();
  const probe=createSurfaceProbe(new Map([['a',root],['b',inner]]));assert.equal(probe.sample().length,0);probe.dispose();
});
test('surface visibility follows the sampled scene rather than admission-time visibility',()=>{
  const a=new T.Mesh(new T.BoxGeometry(1,1,1)),b=new T.Mesh(new T.BoxGeometry(1,1,1));
  b.position.x=.4;b.visible=false;a.updateMatrixWorld();b.updateMatrixWorld();
  const probe=createSurfaceProbe(new Map([['a',a],['b',b]]));assert.equal(probe.sample().length,0);
  b.visible=true;assert.equal(probe.sample().length,1);b.visible=false;assert.equal(probe.sample().length,0);probe.dispose();
});
test('distance follows posed surfaces in a rigid frame and rejects scaled frames',()=>{
  const a=new T.Mesh(new T.BoxGeometry(1,1,1)),b=new T.Mesh(new T.BoxGeometry(1,1,1));
  a.name='a';b.name='b';a.position.set(3,2,1);b.position.set(5,2,1);a.updateMatrixWorld();b.updateMatrixWorld();
  const probe=createSurfaceProbe(new Map([['body',a],['wearable',b]])),pairs=[['body/a','wearable/b']];
  try{
    assert(Math.abs(probe.distances(pairs)[0].distance-1)<1e-12);
    b.position.x=3.5;b.updateMatrixWorld();assert(probe.distances(pairs)[0].distance<1e-12);
    b.visible=false;assert.throws(()=>probe.distances(pairs),/Visible/);b.visible=true;
    a.scale.set(2,.5,1);a.updateMatrixWorld();assert.throws(()=>probe.distances(pairs),/Rigid/);
  }finally{probe.dispose();a.geometry.dispose();b.geometry.dispose();}
});
