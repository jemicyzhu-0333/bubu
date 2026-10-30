import assert from 'node:assert/strict';
import {Float32BufferAttribute} from 'three';
import {createThinSurfaceMapper} from './thin-surface-mapper.mjs';

/** A continuous displacement correction across the authored parameter domain.
 * Every boundary comes from actual rendered, collision-enclosed wire sections.
 * This avoids interpolating tiny free render edges through unrelated refined
 * triangle degrees of freedom. It is a mapping, not a collision certificate. */
export function createTransfiniteClothMapper(coarse,binding,source) {
  assert(source.count===161*19);
  const attribute=new Float32BufferAttribute(source.array.slice(),3),
    mapper=createThinSurfaceMapper({indices:coarse.indices,vertexCount:coarse.positions.length/3,restPositions:Float64Array.from(coarse.positions)});
  const records=binding.bindings.find(b=>b.name==='cape_cloth')?.records;
  assert(records);mapper.bind(records,attribute);
  let output=new Float32Array(source.array.length),closed=false;
  const specifications=[['cape_back_edge',161,s=>s*19],['cape_hem',161,s=>s*19+18],['cape_front_edge_0',19,s=>s],['cape_front_edge_1',19,s=>3040+s]];
  return {
    map(particles,piping,bodyRotation=[0,0,0,1]){
      assert(!closed,'Transfinite mapper disposed');
      for(const [name,count]of specifications){const values=piping.get(name);assert(values?.length===count*39&&values.every(v=>Number.isFinite(v)&&Math.abs(v)<10),'Exact finite piping sections required');}
      mapper.prepare(particles,bodyRotation);mapper.apply();const base=attribute.array;
      const borders=specifications.map(([name,count,vertex])=>{
        const positions=piping.get(name),values=new Float64Array(count*3);
        for(let section=0;section<count;section++)for(let k=0;k<3;k++){
          let sum=0;for(let sample=1;sample<=12;sample++)sum+=positions[(section*13+sample)*3+k];
          values[section*3+k]=sum/12-base[vertex(section)*3+k];
        }
        return values;
      });
      const [back,hem,left,right]=borders,corners=new Float64Array(12);
      for(let k=0;k<3;k++){
        corners[k]=(back[k]+left[k])/2;corners[3+k]=(back[480+k]+right[k])/2;
        corners[6+k]=(hem[k]+left[54+k])/2;corners[9+k]=(hem[480+k]+right[54+k])/2;
      }
      // Inconsistent physical corner copies are averaged, never silently
      // certified. The existing actual seam check retains their residual and
      // fails if any individual piping section exceeds the original 1e-5.
      for(let column=0;column<=160;column++)for(let row=0;row<19;row++){
        const u=column/160,v=row/18,vertex=column*19+row;
        for(let k=0;k<3;k++)output[vertex*3+k]=base[vertex*3+k]+(1-v)*back[column*3+k]+v*hem[column*3+k]+(1-u)*left[row*3+k]+u*right[row*3+k]
          -(1-u)*(1-v)*corners[k]-u*(1-v)*corners[3+k]-(1-u)*v*corners[6+k]-u*v*corners[9+k];
      }
      assert(output.every(v=>Number.isFinite(v)&&Math.abs(v)<10),'Invalid transfinite output');return output;
    },
    dispose(){if(closed)return;closed=true;mapper.dispose();output=null;},
  };
}
