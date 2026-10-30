/** Construction-time admission of an independently authored local body hull.
 * Full containment and global error remain mandatory; narrow garment gaps add
 * a separate whole-triangle check. Caller owns the returned geometry. */
import assert from 'node:assert/strict';
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { MeshBVH } from 'three-mesh-bvh';

export function createLocalBodyProxy(data, bodyPositions, garmentParts) {
  assert.equal(data.schema,'bubu-local-body-proxy/1');
  assert(Array.isArray(data.positions)&&data.positions.length>=12&&data.positions.length%3===0&&data.positions.length<=2048*3);
  assert(data.positions.every(v=>Number.isFinite(v)&&Math.abs(v)<10));
  assert(Array.isArray(data.indices)&&data.indices.length>0&&data.indices.length%3===0&&data.indices.length<=4096*3);
  assert(data.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<data.positions.length/3));
  assert(bodyPositions.length>=12&&bodyPositions.length%3===0&&bodyPositions.length<=300000&&bodyPositions.every(Number.isFinite));
  assert(garmentParts.length>0&&garmentParts.length<=16);
  const geometry=new T.BufferGeometry();let exact;
  try{
    geometry.setAttribute('position',new T.Float32BufferAttribute(data.positions,3));geometry.setIndex(data.indices);
    const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3(),point=new T.Vector3();
    const position=geometry.attributes.position,edges=new Map(),planes=[];let maximumPlaneViolation=-Infinity;
    for(let i=0;i<data.indices.length;i+=3){
      const ids=data.indices.slice(i,i+3);a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);
      normal.crossVectors(b.sub(a),c.sub(a));assert(normal.length()>1e-10,'Degenerate proxy face');normal.normalize();const support=normal.dot(a);
      planes.push({normal:normal.clone(),support});
      for(let j=0;j<position.count;j++)assert(normal.dot(point.fromBufferAttribute(position,j))-support<=1e-6,'Convex proxy required');
      for(let j=0;j<bodyPositions.length;j+=3)maximumPlaneViolation=Math.max(maximumPlaneViolation,normal.dot(point.fromArray(bodyPositions,j))-support);
      for(let j=0;j<3;j++){
        const u=ids[j],v=ids[(j+1)%3],key=`${Math.min(u,v)},${Math.max(u,v)}`;
        const prior=edges.get(key)??[];prior.push([u,v]);edges.set(key,prior);
      }
    }
    assert(maximumPlaneViolation<=-1e-8,'Proxy must conservatively enclose the source body');
    for(const pair of edges.values())assert(pair.length===2&&pair[0][0]===pair[1][1]&&pair[0][1]===pair[1][0],'Closed consistently oriented proxy required');
    exact=new ConvexGeometry(Array.from({length:bodyPositions.length/3},(_,i)=>new T.Vector3().fromArray(bodyPositions,i*3)));
    const exactTree=new MeshBVH(exact,{indirect:true});let maximumOuterDistance=0;
    for(let i=0;i<position.count;i++)maximumOuterDistance=Math.max(maximumOuterDistance,exactTree.closestPointToPoint(point.fromBufferAttribute(position,i)).distance);
    assert(maximumOuterDistance<=.01,'Proxy exceeds unchanged global approximation budget');
    geometry.boundsTree=new MeshBVH(geometry,{indirect:true});const identity=new T.Matrix4(),gaps=[];
    for(const part of garmentParts){
      assert(part.geometry.attributes.position.count<=50000);
      for(let i=0;i<part.geometry.attributes.position.count;i++){
        point.fromBufferAttribute(part.geometry.attributes.position,i);
        assert(planes.some(p=>p.normal.dot(point)>p.support+1e-8),`Initial proxy contains ${part.name}`);
      }
      const tree=new MeshBVH(part.geometry,{indirect:true}),near={},other={};
      const crossed=tree.bvhcast(geometry.boundsTree,identity,{intersectsTriangles:(x,y)=>x.intersectsTriangle(y)});
      assert(!crossed,`Initial proxy intersects ${part.name}`);
      tree.closestPointToGeometry(geometry,identity,near,other);
      assert(near.distance>1e-5,`Initial proxy lacks clearance from ${part.name}`);
      gaps.push({part:part.name,distance:near.distance});
    }
    return {geometry,certificate:{sourceVertices:bodyPositions.length/3,vertices:position.count,triangles:data.indices.length/3,
      maximumPlaneViolation,maximumOuterDistance,maxError:.01,minimumInitialGarmentGap:Math.min(...gaps.map(g=>g.distance)),gaps}};
  }catch(error){geometry.dispose();throw error;}finally{exact?.dispose();}
}
