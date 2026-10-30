import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createPipingSectionMapper,measureCapeSeams} from './piping-section-mapper.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url)));
function fixture(){return source.parts.filter(p=>p.name!=='cape_cloth'&&p.name!=='cape_clasp').map(p=>({name:p.name,geometry:new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p.positions,3))}));}

test('actual piping rest reconstruction and rigid sections preserve every authored cross-section pair',()=>{
  const parts=fixture(),inputs=new Map(parts.map(p=>[p.name,p.geometry.attributes.position.clone()])),mapper=createPipingSectionMapper(parts,inputs),point=new T.Vector3();
  try{
    assert.equal(mapper.sectionCount,360);mapper.apply();
    for(const part of parts){const rest=source.parts.find(p=>p.name===part.name).positions,values=part.geometry.attributes.position.array;
      assert(Math.max(...values.map((v,i)=>Math.abs(v-rest[i])))<1e-7);
      // Inject the actual defect class: independently mapped points flatten
      // each section, while its center follows a translation.
      const mapped=inputs.get(part.name).array;
      for(let start=0;start<mapped.length;start+=39){const center=new T.Vector3();for(let j=1;j<=12;j++)center.add(point.fromArray(mapped,start+j*3));center.multiplyScalar(1/12);
        for(let j=0;j<13;j++){point.fromArray(mapped,start+j*3).sub(center);point.x*=.7;point.y*=.6;point.add(center).add(new T.Vector3(.02,.03,-.01));mapped.set(point.toArray(),start+j*3);}}
    }
    mapper.apply();
    for(const part of parts){const rest=source.parts.find(p=>p.name===part.name).positions,values=part.geometry.attributes.position.array;
      for(let start=0;start<values.length;start+=39)for(let a=0;a<13;a++)for(let b=a+1;b<13;b++){
        const distance=(v)=>new T.Vector3().fromArray(v,start+a*3).distanceTo(new T.Vector3().fromArray(v,start+b*3));
        assert(Math.abs(distance(values)-distance(rest))<2e-7,'Local section shape changed');
      }
    }
  }finally{mapper.dispose();mapper.dispose();for(const p of parts)p.geometry.dispose();}
  assert.throws(()=>mapper.apply(),/disposed/);
});

test('a collapsed final section rejects atomically without rewriting earlier private parts',()=>{
  const parts=fixture(),inputs=new Map(parts.map(p=>[p.name,p.geometry.attributes.position.clone()])),mapper=createPipingSectionMapper(parts,inputs);
  try{
    const last=inputs.get(parts.at(-1).name).array;last.fill(0,last.length-39);
    const before=parts.map(p=>new Float32Array(p.geometry.attributes.position.array));
    assert.throws(()=>mapper.apply(),/Degenerate/);
    parts.forEach((p,i)=>assert.deepEqual(p.geometry.attributes.position.array,before[i]));
  }finally{mapper.dispose();for(const p of parts)p.geometry.dispose();}
});

test('joined sections retain the authored cloth-border coincidence during different local displacement',()=>{
  const parts=fixture(),p=source.parts.find(p=>p.name==='cape_cloth');
  parts.push({name:p.name,geometry:new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p.positions,3))});
  const cloth=parts.at(-1).geometry.attributes.position,
    inputs=new Map(parts.filter(p=>p.name!=='cape_cloth').map(p=>[p.name,p.geometry.attributes.position.clone()])),
    mapper=createPipingSectionMapper(parts,inputs,{joinClothSeams:true});
  try{
    assert(measureCapeSeams(parts).maximum<1e-7);
    for(let i=0;i<cloth.count;i++)cloth.setZ(i,cloth.getZ(i)+.02*Math.sin(i*.2));
    assert(measureCapeSeams(parts).maximum>.019);
    mapper.apply();assert(measureCapeSeams(parts).maximum<1e-7);
    const before=parts.slice(0,-1).map(p=>p.geometry.attributes.position.array.slice());
    cloth.setX(cloth.count-1,NaN);
    assert.throws(()=>mapper.apply(),/Nonfinite cloth seam/);
    parts.slice(0,-1).forEach((p,i)=>assert.deepEqual(p.geometry.attributes.position.array,before[i]));
  }finally{mapper.dispose();for(const p of parts)p.geometry.dispose();}
});
