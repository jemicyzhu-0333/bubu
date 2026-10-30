import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createConformingSeamSurface} from './conforming-seam-surface.mjs';
import {createConformingClothBinding} from './conforming-cloth-binding.mjs';
import {createThinSurfaceMapper} from './thin-surface-mapper.mjs';
const coarse=JSON.parse(fs.readFileSync(new URL('./cape-coarse.json',import.meta.url))),
  source=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url))).parts.find(p=>p.name==='cape_cloth');
for(const options of [{centroidFans:true,seamNeighbours:true},{centroidFans:false,seamNeighbours:false}])
test(`private refinement preserves supports and connected authored borders: ${JSON.stringify(options)}`,()=>{
  const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(source.positions,3));let mapper;
  try{
    const surface=createConformingSeamSurface(coarse,geometry,options),binding=createConformingClothBinding(surface,geometry.attributes.position);
    assert.deepEqual(surface.positions.slice(0,coarse.positions.length),coarse.positions);
    assert.deepEqual(surface.pins,coarse.pins);assert.equal(surface.boundaryParticles.size,356);
    assert.equal(surface.positions.length/3,options.centroidFans?1180:732);
    assert.equal(surface.indices.length/3,options.centroidFans?1938:1042);
    const used=new Set(surface.indices);for(const id of surface.boundaryParticles.values())assert(used.has(id));
    for(let i=0;i<surface.indices.length;i+=3){
      const [a,b,c]=surface.indices.slice(i,i+3).map(id=>surface.parameters[id]);
      assert(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>1e-14);
    }
    assert(surface.positions.length/3+360<=2048&&surface.indices.length/3<=4096);
    const edges=new Map();for(let i=0;i<surface.indices.length;i+=3)for(let j=0;j<3;j++){
      const a=surface.indices[i+j],b=surface.indices[i+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');edges.set(key,(edges.get(key)??0)+1);
    }
    assert([...edges.values()].every(n=>n===1||n===2));
    assert.equal(surface.positions.length/3-edges.size+surface.indices.length/3,1,'Refined topology remains a connected disk without extra holes');
    const target=geometry.attributes.position.clone();
    mapper=createThinSurfaceMapper({indices:surface.indices,vertexCount:surface.positions.length/3,restPositions:Float64Array.from(surface.positions)});
    mapper.bind(binding.records,target);mapper.prepare(Float32Array.from(surface.positions));mapper.apply();
    assert(Math.max(...target.array.map((v,i)=>Math.abs(v-source.positions[i])))<1e-7);
    const moved=Float32Array.from(surface.positions),vertex=26*19+18,particle=surface.boundaryParticles.get(vertex);moved[particle*3]+=.01;
    mapper.prepare(moved);mapper.apply();
    assert(Math.abs((target.getX(vertex)-source.positions[vertex*3])-.01)<1e-7,'Actual border must follow its own simulation particle');
    const affine=Float32Array.from(surface.positions);
    for(let i=0;i<surface.parameters.length;i++)affine[i*3]+=.01*surface.parameters[i][0]+.02*surface.parameters[i][1];
    mapper.prepare(affine);mapper.apply();
    for(let v=0;v<target.count;v++)assert(Math.abs(target.getX(v)-source.positions[v*3]-(.01*Math.floor(v/19)/160+.02*(v%19)/18))<2e-7,'One continuous displacement field must reach both border and free cloth');
    assert.deepEqual(Array.from(geometry.attributes.position.array),source.positions);
  }finally{mapper?.dispose();geometry.dispose();}
});
