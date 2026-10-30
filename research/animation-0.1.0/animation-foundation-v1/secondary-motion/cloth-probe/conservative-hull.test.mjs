import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createConservativeHull} from './conservative-hull.mjs';
test('conservative proxy encloses borrowed convex surfaces within the declared error',()=>{
  for(const source of [new T.BoxGeometry(1,1.4,.8),new T.IcosahedronGeometry(.7,3)]){
    const data=source.attributes.position.array,before=data.slice(),result=createConservativeHull(data);
    try{
      assert.deepEqual(data,before);assert.ok(result.certificate.maximumOuterDistance<=.01);
      assert.ok(result.certificate.maximumPlaneViolation<=-1e-8);
      const p=result.geometry.attributes.position,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),n=new T.Vector3(),point=new T.Vector3();
      for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);n.crossVectors(b.sub(a),c.sub(a)).normalize();for(let j=0;j<data.length;j+=3)assert.ok(n.dot(point.fromArray(data,j).sub(a))<=-1e-8);}
    }finally{result.geometry.dispose();source.dispose();}
  }
});
test('invalid or unattainable proxy budgets fail instead of returning a looser hull',()=>{
  assert.throws(()=>createConservativeHull(new Float32Array([NaN,0,0])),/source vertices/);
  const source=new T.IcosahedronGeometry(1,3);
  try{assert.throws(()=>createConservativeHull(source.attributes.position.array,{maxError:1e-8,maxDirections:64}),/No conservative hull/);}finally{source.dispose();}
});
