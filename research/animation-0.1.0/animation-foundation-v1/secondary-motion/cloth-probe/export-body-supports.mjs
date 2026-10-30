/** Offline support directions at unchanged garment vertices, for a local body proxy. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadGLB, hybrid, disposeAsset } from '../../integration/asset-fixtures.mjs';
const output=process.argv[2];assert(output&&!fs.existsSync(output));
const frozen=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url)));
const asset=await loadGLB(hybrid);
try{
  const geometry=asset.getObjectByName('Bubu_body').geometry,tree=new MeshBVH(geometry,{indirect:true});
  const points=[],normals=[],gaps=[];const p=new T.Vector3();
  const add=point=>{
    p.copy(point);points.push(...p.toArray());const nearest=tree.closestPointToPoint(p);
    gaps.push(nearest.distance);normals.push(...p.sub(nearest.point).normalize().toArray());
  };
  for(const part of frozen.parts){
    const v=Array.from({length:part.positions.length/3},(_,i)=>new T.Vector3().fromArray(part.positions,i*3));
    for(const point of v)add(point);
    const edges=new Set();
    for(let i=0;i<part.indices.length;i+=3){
      const ids=part.indices.slice(i,i+3);add(v[ids[0]].clone().add(v[ids[1]]).add(v[ids[2]]).multiplyScalar(1/3));
      for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;
        if(!edges.has(key)){edges.add(key);add(v[a].clone().add(v[b]).multiplyScalar(.5));}
      }
    }
  }
  fs.writeFileSync(output,JSON.stringify({body:Array.from(geometry.attributes.position.array),points,normals,gaps}));
  console.log({bodyVertices:geometry.attributes.position.count,garmentVertices:points.length/3,minimumGap:Math.min(...gaps)});
}finally{disposeAsset(asset);}
