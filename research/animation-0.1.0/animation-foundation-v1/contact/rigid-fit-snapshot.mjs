import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';

/** Immutable offline pose snapshot. Translation trials never write the actor.
 * They nominate fits only; the real secondary-motion path must be replayed. */
export function createRigidFitSnapshot(groups) {
  const entries=[],vertex=new T.Vector3(),boxA=new T.Box3(),boxB=new T.Box3();
  const deltaA=new T.Vector3(),deltaB=new T.Vector3(),relative=new T.Matrix4();
  let disposed=false;
  for(const [group,root] of groups)root.traverseVisible(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
    const source=mesh.geometry,geometry=new T.BufferGeometry();
    const positions=new T.BufferAttribute(new Float64Array(source.attributes.position.count*3),3);
    for(let i=0;i<positions.count;i++){
      mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld);
      positions.setXYZ(i,vertex.x,vertex.y,vertex.z);
    }
    geometry.setAttribute('position',positions);
    if(source.index)geometry.setIndex(source.index.clone());
    geometry.computeBoundingBox();
    const bvh=new MeshBVH(geometry,{indirect:true});geometry.boundsTree=bvh;
    entries.push({group,name:mesh.name,geometry,bounds:geometry.boundingBox.clone(),bvh});
  });
  function translation(offsets,group,target){
    const value=offsets[group]??[0,0,0];
    if(!Array.isArray(value)||value.length!==3||value.some(x=>!Number.isFinite(x)))throw Error('Finite translation required');
    return target.fromArray(value);
  }
  return {
    separationPlanes(offsets={}, {fixed,moving}={}) {
      if(disposed)throw Error('Fit snapshot disposed');
      const rows=[],normal=new T.Vector3(),difference=new T.Vector3();
      for(const a of entries)for(const b of entries){
        if(a.group!==fixed||b.group!==moving)continue;
        translation(offsets,a.group,deltaA);translation(offsets,b.group,deltaB);
        relative.makeTranslation(deltaB.x-deltaA.x,deltaB.y-deltaA.y,deltaB.z-deltaA.z);
        a.bvh.bvhcast(b.bvh,relative,{intersectsTriangles:(ta,tb)=>{
          if(!ta.intersectsTriangle(tb))return false;
          ta.getNormal(normal);if(normal.lengthSq()<.99)throw Error('Degenerate contact plane');
          const depth=Math.max(...[tb.a,tb.b,tb.c].map(p=>normal.dot(difference.copy(ta.a).sub(p))));
          rows.push({pair:[`${a.group}/${a.name}`,`${b.group}/${b.name}`],normal:normal.toArray(),lower:depth+normal.dot(deltaB)-normal.dot(deltaA)});
          return false;
        }});
      }
      return rows;
    },
    intersections(offsets={}, {includePair=()=>true}={}) {
      if(disposed)throw Error('Fit snapshot disposed');
      const pairs=[];
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
        const a=entries[i],b=entries[j];if(a.group===b.group||!includePair(a.group,b.group))continue;
        translation(offsets,a.group,deltaA);translation(offsets,b.group,deltaB);
        boxA.copy(a.bounds).translate(deltaA);boxB.copy(b.bounds).translate(deltaB);
        if(!boxA.intersectsBox(boxB))continue;
        relative.makeTranslation(deltaB.x-deltaA.x,deltaB.y-deltaA.y,deltaB.z-deltaA.z);
        if(a.bvh.bvhcast(b.bvh,relative,{intersectsTriangles:(ta,tb)=>ta.intersectsTriangle(tb)}))
          pairs.push([`${a.group}/${a.name}`,`${b.group}/${b.name}`]);
      }
      return pairs;
    },
    minimumDistance(offsets={}, {includePair=()=>true}={}) {
      if(disposed)throw Error('Fit snapshot disposed');
      let minimum=null;
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
        const a=entries[i],b=entries[j];if(a.group===b.group||!includePair(a.group,b.group))continue;
        translation(offsets,a.group,deltaA);translation(offsets,b.group,deltaB);
        relative.makeTranslation(deltaB.x-deltaA.x,deltaB.y-deltaA.y,deltaB.z-deltaA.z);
        const closest=a.bvh.closestPointToGeometry(b.geometry,relative,{},null,1e-14,minimum?.distance??Infinity);
        if(closest&&(!minimum||closest.distance<minimum.distance))minimum={pair:[`${a.group}/${a.name}`,`${b.group}/${b.name}`],distance:closest.distance};
      }
      return minimum;
    },
    dispose(){if(disposed)return;disposed=true;for(const e of entries)e.geometry.dispose();entries.length=0;},
  };
}
