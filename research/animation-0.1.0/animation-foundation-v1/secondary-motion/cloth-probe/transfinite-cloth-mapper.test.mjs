import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createTransfiniteClothMapper} from './transfinite-cloth-mapper.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url))),coarse=read('./cape-coarse.json'),binding=read('./cape-binding.json'),frozen=read('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json');
test('four-boundary displacement retains the source at rest and commutes with a proper rigid body transform',()=>{
  const source=frozen.parts.find(p=>p.name==='cape_cloth'),attribute=new T.Float32BufferAttribute(source.positions,3),mapper=createTransfiniteClothMapper(coarse,binding,attribute);
  const piping=new Map(frozen.parts.filter(p=>!['cape_cloth','cape_clasp'].includes(p.name)).map(p=>[p.name,Float32Array.from(p.positions)]));
  try{
    const rest=mapper.map(Float32Array.from(coarse.positions),piping).slice();
    assert(Math.max(...rest.map((v,i)=>Math.abs(v-source.positions[i])))<1e-7);
    const rotation=new T.Quaternion().setFromEuler(new T.Euler(.4,-.3,.2)),offset=new T.Vector3(.2,-.1,.1),p=new T.Vector3();
    const transform=values=>{const result=Float32Array.from(values);for(let i=0;i<values.length;i+=3)p.fromArray(values,i).applyQuaternion(rotation).add(offset).toArray(result,i);return result;};
    const rotated=mapper.map(transform(coarse.positions),new Map([...piping].map(([name,values])=>[name,transform(values)])),rotation.toArray()),expected=transform(rest);
    assert(Math.max(...rotated.map((v,i)=>Math.abs(v-expected[i])))<5e-7);
    assert.deepEqual(Array.from(attribute.array),source.positions);
    const bad=new Map(piping);bad.set('cape_hem',new Float32Array(3));assert.throws(()=>mapper.map(Float32Array.from(coarse.positions),bad),/Exact finite/);
    mapper.dispose();mapper.dispose();assert.throws(()=>mapper.map(Float32Array.from(coarse.positions),piping),/disposed/);
  }finally{mapper.dispose();}
});
