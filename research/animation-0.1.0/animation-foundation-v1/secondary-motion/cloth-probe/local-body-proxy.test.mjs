import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLocalBodyProxy } from './local-body-proxy.mjs';

function fixture(radius=1.001,plane=1.01){
  const points=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])points.push(new T.Vector3(x,y,z));
  const raw=new ConvexGeometry(points.map(p=>p.clone().multiplyScalar(radius)));raw.deleteAttribute('normal');raw.deleteAttribute('uv');
  const hull=mergeVertices(raw);raw.dispose();
  const data={schema:'bubu-local-body-proxy/1',positions:Array.from(hull.attributes.position.array),indices:Array.from(hull.index.array)};hull.dispose();
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([-.5,-.5,plane,.5,-.5,plane,0,.5,plane],3));geometry.setIndex([0,1,2]);
  return {data,body:Float32Array.from(points.flatMap(p=>p.toArray())),parts:[{name:'trim',geometry}]};
}

test('local body proxy independently certifies containment, unchanged error budget and actual garment gap',()=>{
  const f=fixture();let result;
  try{
    const before=JSON.stringify(f.data);result=createLocalBodyProxy(f.data,f.body,f.parts);
    assert(result.certificate.maximumPlaneViolation< -1e-8);
    assert(result.certificate.maximumOuterDistance<.01);
    assert(result.certificate.minimumInitialGarmentGap>.008);
    assert.equal(JSON.stringify(f.data),before);assert.equal(f.parts[0].geometry.boundsTree,undefined);
  }finally{result?.geometry.dispose();f.parts[0].geometry.dispose();}
});

test('conservative containment alone cannot admit an overlapping or excessively inflated body proxy',()=>{
  for(const [radius,plane,reason] of [[.999,1.01,/enclose/],[1.02,1.04,/approximation budget/],[1.002,1.001,/contains/]]){
    const f=fixture(radius,plane);try{assert.throws(()=>createLocalBodyProxy(f.data,f.body,f.parts),reason);}finally{f.parts[0].geometry.dispose();}
  }
});

test('local body proxy rejects an open or non-finite hull before use',()=>{
  const f=fixture();try{
    const open=structuredClone(f.data);open.indices.splice(0,3);assert.throws(()=>createLocalBodyProxy(open,f.body,f.parts),/Closed/);
    const invalid=structuredClone(f.data);invalid.positions[0]=NaN;assert.throws(()=>createLocalBodyProxy(invalid,f.body,f.parts));
  }finally{f.parts[0].geometry.dispose();}
});
