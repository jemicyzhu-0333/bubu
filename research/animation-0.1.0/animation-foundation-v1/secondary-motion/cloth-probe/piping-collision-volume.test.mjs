import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createPipingCollisionVolume} from './piping-collision-volume.mjs';
const frozen=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url)));
test('all actual piping exteriors are preserved exactly by closed collision-only tubes',()=>{
  for(const part of frozen.parts.filter(p=>!['cape_cloth','cape_clasp'].includes(p.name))){
    const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);
    try{
      const before=geometry.attributes.position.array.slice(),volume=createPipingCollisionVolume(geometry);
      assert.deepEqual(geometry.attributes.position.array,before);assert.deepEqual(Array.from(geometry.index.array),part.indices);
      assert.equal(volume.certificate.addedEndCapTriangles,24);assert.equal(volume.certificate.radiusInflation,0);
      const render=Float32Array.from({length:before.length},(_,i)=>volume.positions[volume.renderVertexMap[Math.floor(i/3)]*3+i%3]);
      assert.deepEqual(render,before);
      // Every original oriented or unoriented exterior face occurs unchanged.
      const key=(values,ids)=>Array.from(ids,i=>Array.from(values.slice(i*3,i*3+3)).join(',')).sort().join('|');
      const faces=new Set();for(let i=0;i<volume.indices.length;i+=3)faces.add(key(volume.positions,volume.indices.slice(i,i+3)));
      for(let i=0;i<part.indices.length;i+=3)assert(faces.has(key(before,part.indices.slice(i,i+3))));
    }finally{geometry.dispose();}
  }
});
test('approximate seams and missing exterior faces cannot be silently repaired by deleting collisions',()=>{
  const p=frozen.parts.find(p=>p.name==='cape_front_edge_0');
  const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p.positions,3));geometry.setIndex(p.indices);
  try{
    geometry.attributes.position.array[0]+=.00001;
    assert.throws(()=>createPipingCollisionVolume(geometry),/exact seam duplicates/);
    geometry.attributes.position.array.set(p.positions);geometry.setIndex(p.indices.slice(3));
    assert.throws(()=>createPipingCollisionVolume(geometry),/two open end loops|Nonmanifold/);
  }finally{geometry.dispose();}
});
