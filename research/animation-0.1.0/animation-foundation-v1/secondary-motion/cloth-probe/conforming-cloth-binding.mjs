import assert from 'node:assert/strict';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';

/** Build a separate private render binding. Boundary vertices use their exact
 * simulation particle; free surface vertices keep bounded, local rest detail. */
export function createConformingClothBinding(surface,source) {
  const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(surface.positions,3));
  geometry.setIndex(surface.indices);
  const parameterGeometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(surface.parameters.flatMap(([u,v])=>[u,v,0]),3));
  parameterGeometry.setIndex(surface.indices);
  try{
    const bvh=new MeshBVH(parameterGeometry,{indirect:true}),records=[],faces=new Map(),
      triangle=new T.Triangle(),point=new T.Vector3(),weights=new T.Vector3(),offset=new T.Vector3(),
      tangent=new T.Vector3(),bitangent=new T.Vector3(),normal=new T.Vector3(),hit={},uv=new T.Vector3(),uvTriangle=new T.Triangle();
    for(let i=0;i<surface.indices.length;i++)if(!faces.has(surface.indices[i]))faces.set(surface.indices[i],Math.floor(i/3));
    let maximumOffset=0,minimumDoubleArea=Infinity;
    for(let vertex=0;vertex<source.count;vertex++){
      point.fromBufferAttribute(source,vertex);
      const particle=surface.renderedParticles.get(vertex);
      let face;
      if(particle!==undefined){
        face=faces.get(particle);const ids=surface.indices.slice(face*3,face*3+3);
        weights.set(ids[0]===particle?1:0,ids[1]===particle?1:0,ids[2]===particle?1:0);
      }else{
        // Corresponding UVs preserve adjacent rendered vertices across a
        // refined seam. Nearest 3D points can jump to a neighbouring curved
        // panel and give a different displacement field at its boundary.
        uv.set(Math.floor(vertex/19)/160,(vertex%19)/18,0);
        assert(bvh.closestPointToPoint(uv,hit)&&hit.distance<1e-7);face=hit.faceIndex;
        const ids=surface.indices.slice(face*3,face*3+3);
        [uvTriangle.a,uvTriangle.b,uvTriangle.c].forEach((p,i)=>p.fromBufferAttribute(parameterGeometry.attributes.position,ids[i]));
        uvTriangle.getBarycoord(hit.point,weights);
      }
      const ids=surface.indices.slice(face*3,face*3+3);
      [triangle.a,triangle.b,triangle.c].forEach((p,i)=>p.fromBufferAttribute(geometry.attributes.position,ids[i]));
      tangent.subVectors(triangle.b,triangle.a).normalize();triangle.getNormal(normal);bitangent.crossVectors(normal,tangent).normalize();
      minimumDoubleArea=Math.min(minimumDoubleArea,triangle.getArea()*2);
      assert(weights.toArray().every(w=>w>=-1e-6&&w<=1+1e-6));
      const expected=Math.min(63,Math.floor(Math.floor(vertex/19)*64/160));
      assert(Math.abs(surface.triangleColumns[face]-expected)<=1,'Binding crossed an angular panel');
      offset.copy(point).addScaledVector(triangle.a,-weights.x).addScaledVector(triangle.b,-weights.y).addScaledVector(triangle.c,-weights.z);
      maximumOffset=Math.max(maximumOffset,offset.length());
      records.push(face,weights.x,weights.y,weights.z,offset.dot(tangent),offset.dot(bitangent),offset.dot(normal));
    }
    assert(maximumOffset<=.08&&minimumDoubleArea>=1e-8,'Existing thin-mapping bounds must hold');
    return {records,certificate:{vertices:source.count,correspondence:'authored angular/radial UVs',exactBoundaryParticleBindings:surface.boundaryParticles.size,exactSeamNeighbourBindings:surface.renderedParticles.size-surface.boundaryParticles.size,maximumOffset,minimumDoubleArea}};
  }finally{geometry.dispose();parameterGeometry.dispose();}
}
