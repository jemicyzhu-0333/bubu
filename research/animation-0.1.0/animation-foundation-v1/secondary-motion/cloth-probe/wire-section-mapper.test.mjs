import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createWireSectionMapper} from './wire-section-mapper.mjs';
const frozen=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url)));
test('unchanged piping follows its own wire, retains section shape and stays inside the physical capsules',()=>{
  for(const part of frozen.parts.filter(p=>!['cape_cloth','cape_clasp'].includes(p.name))){
    const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);
    const count=part.positions.length/39,centers=new Float32Array(count*3),cloth=frozen.parts.find(p=>p.name==='cape_cloth').positions;
    for(let i=0;i<count;i++){
      const vertex=part.name==='cape_back_edge'?i*19:part.name==='cape_hem'?i*19+18:part.name==='cape_front_edge_0'?i:3040+i;
      centers.set(cloth.slice(vertex*3,vertex*3+3),i*3);
    }
    const mapper=createWireSectionMapper(geometry,centers),point=new T.Vector3(),other=new T.Vector3(),line=new T.Line3();
    try{
      const rest=mapper.map(centers).slice();
      assert(Math.max(...rest.map((v,i)=>Math.abs(v-part.positions[i])))<1e-7);
      const rotation=new T.Quaternion().setFromEuler(new T.Euler(.3,-.5,.2)),offset=new T.Vector3(.1,.2,-.1),moved=centers.slice();
      for(let i=0;i<count;i++)point.fromArray(centers,i*3).applyQuaternion(rotation).add(offset).toArray(moved,i*3);
      const rigid=mapper.map(moved,rotation.toArray()).slice();
      for(let i=0;i<rest.length/3;i++)assert(point.fromArray(rest,i*3).applyQuaternion(rotation).add(offset).distanceTo(other.fromArray(rigid,i*3))<1e-6);
      for(let i=0;i<count;i++)moved[i*3+2]+=.007*Math.sin(i*.13);
      const bent=mapper.map(moved,rotation.toArray());
      for(let s=0;s<count;s++)for(let j=0;j<13;j++){
        const vertex=s*13+j,next=s*13+(j+1)%13;
        const original=point.fromArray(rest,vertex*3).distanceTo(other.fromArray(rest,next*3));
        assert(Math.abs(point.fromArray(bent,vertex*3).distanceTo(other.fromArray(bent,next*3))-original)<2e-7);
        assert(point.fromArray(bent,vertex*3).distanceTo(other.fromArray(moved,s*3))<=mapper.radius);
      }
      for(let i=0;i<part.indices.length;i+=3){
        const ids=part.indices.slice(i,i+3),lo=Math.min(...ids.map(v=>Math.floor(v/13)));
        line.start.fromArray(moved,lo*3);line.end.fromArray(moved,(lo+1)*3);
        // A capsule is convex: enclosing all three vertices encloses the
        // entire unchanged exterior triangle, including its interior.
        for(const id of ids){point.fromArray(bent,id*3);assert(point.distanceTo(line.closestPointToPoint(point,true,other))<=mapper.radius);}
      }
      assert.deepEqual(Array.from(geometry.attributes.position.array),part.positions);
      assert.throws(()=>mapper.map(moved,[0,0,0,2]),/Unit body rotation/);
      const bad=moved.slice();bad[0]=NaN;assert.throws(()=>mapper.map(bad),/Finite bounded/);
    }finally{mapper.dispose();geometry.dispose();}
    assert.throws(()=>mapper.map(centers),/disposed/);
  }
});

test('physical section frames preserve rigid covariance and reject collapsed or nonfinite triads',()=>{
  const part=frozen.parts.find(p=>p.name==='cape_front_edge_0'),geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);
  const centers=new Float32Array(57),frames=new Float32Array(114),cloth=frozen.parts.find(p=>p.name==='cape_cloth').positions;
  for(let s=0;s<19;s++){
    centers.set(cloth.slice(s*3,s*3+3),s*3);
    for(const [j,sample]of [1,4].entries())frames.set(part.positions.slice((s*13+sample)*3,(s*13+sample)*3+3),s*6+j*3);
  }
  const mapper=createWireSectionMapper(geometry,centers,{restFramePoints:frames}),rotation=new T.Quaternion().setFromEuler(new T.Euler(.4,-.2,.7)),offset=new T.Vector3(.03,.02,-.01),point=new T.Vector3();
  try{
    const transform=values=>{const out=values.slice();for(let i=0;i<values.length;i+=3)point.fromArray(values,i).applyQuaternion(rotation).add(offset).toArray(out,i);return out;};
    const actual=mapper.map(transform(centers),rotation.toArray(),transform(frames)),expected=transform(Float32Array.from(part.positions));
    assert(Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])))<2e-7);
    const collapsed=frames.slice();collapsed.set(centers.slice(0,3),0);
    assert.throws(()=>mapper.map(centers,undefined,collapsed),/Collapsed/);
    const invalid=frames.slice();invalid[3]=NaN;assert.throws(()=>mapper.map(centers,undefined,invalid),/Finite section/);
    assert.throws(()=>mapper.map(centers),/Finite section/);
    assert.deepEqual(Array.from(geometry.attributes.position.array),part.positions);
  }finally{mapper.dispose();geometry.dispose();}
});
