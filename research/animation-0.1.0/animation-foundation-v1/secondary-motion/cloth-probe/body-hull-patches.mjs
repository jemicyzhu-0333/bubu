/** Exact union decomposition of a closed convex hull. Every boundary triangle
 * and one common interior point form a pyramid. Grouping their vertices into
 * convex patches contains those pyramids and stays inside the original hull;
 * consequently the patch union is exactly the same occupied body volume. */
import assert from 'node:assert/strict';
import * as T from 'three';

export function partitionBodyHull(geometry, patchCount=64) {
  const position=geometry.attributes.position,indices=geometry.index?.array;
  assert(position?.itemSize===3&&position.count>=4&&position.count<=2048&&indices?.length%3===0&&indices.length<=4096*3);
  assert([4,16,64].includes(patchCount)&&indices.length/3>=patchCount);
  assert(position.array.every(Number.isFinite));
  const points=Array.from({length:position.count},(_,i)=>new T.Vector3().fromBufferAttribute(position,i));
  const average=new T.Vector3();for(const p of points)average.add(p);average.multiplyScalar(1/points.length);
  const center=new T.Vector3().fromArray(Float32Array.from(average.toArray())),faces=[],edges=new Map();
  for(let i=0;i<indices.length;i+=3){
    const ids=Array.from(indices.slice(i,i+3));assert(ids.every(v=>Number.isInteger(v)&&v>=0&&v<points.length));
    const [a,b,c]=ids.map(v=>points[v]),normal=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a));
    assert(normal.length()>1e-10);normal.normalize();const support=normal.dot(a);
    assert(normal.dot(center)<support-1e-8,'Common center must be strictly interior');
    assert(points.every(p=>normal.dot(p)<=support+1e-6),'Convex source required');
    faces.push({id:i/3,vertices:ids,center:a.clone().add(b).add(c).multiplyScalar(1/3)});
    for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;const list=edges.get(key)??[];list.push([a,b]);edges.set(key,list);}
  }
  for(const pair of edges.values())assert(pair.length===2&&pair[0][0]===pair[1][1]&&pair[0][1]===pair[1][0],'Closed oriented source required');
  const groups=[faces];
  while(groups.length<patchCount){
    let largest=0;for(let i=1;i<groups.length;i++)if(groups[i].length>groups[largest].length)largest=i;
    const group=groups.splice(largest,1)[0];assert(group.length>=2);
    const size=new T.Box3().setFromPoints(group.map(f=>f.center)).getSize(new T.Vector3());
    const axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
    group.sort((a,b)=>a.center[axis]-b.center[axis]||a.id-b.id);const middle=Math.floor(group.length/2);
    groups.push(group.slice(0,middle),group.slice(middle));
  }
  const covered=new Set(),patches=groups.map(group=>{
    const sourceVertices=[...new Set(group.flatMap(f=>f.vertices))];
    for(const face of group){assert(!covered.has(face.id));covered.add(face.id);}
    return {positions:Float32Array.from([...center.toArray(),...sourceVertices.flatMap(i=>points[i].toArray())]),faces:group.map(f=>f.id),sourceVertices};
  });
  assert.equal(covered.size,faces.length);
  return {patches,certificate:{kind:'same-volume-convex-face-pyramids',patchCount,sourceVertices:points.length,sourceFaces:faces.length,
    coveredFaces:covered.size,minimumPatchVertices:Math.min(...patches.map(p=>p.positions.length/3)),maximumPatchVertices:Math.max(...patches.map(p=>p.positions.length/3)),
    maximumPatchFaces:Math.max(...patches.map(p=>p.faces.length)),center:center.toArray(),uniformInflation:0}};
}
