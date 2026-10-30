import * as T from 'three';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {MeshBVH} from 'three-mesh-bvh';

/** Offline/static research collision proxy. Support planes certify containment
 * of every original vertex, hence every original triangle. Convexity bounds the
 * outer-to-exact-hull distance by its maximum at the proxy vertices.
 * Render geometry is never changed. Caller owns the returned geometry. */
export function createConservativeHull(array,{maxError=.01,maxDirections=1024}={}) {
  if(array.length%3||array.length<12||array.length>300000||!array.every(Number.isFinite))throw Error('Bounded finite source vertices required');
  if(!(maxError>0&&maxError<=.02)||![64,128,256,512,1024].includes(maxDirections))throw Error('Bounded hull quality required');
  const points=Array.from({length:array.length/3},(_,i)=>new T.Vector3().fromArray(array,i*3));
  const exact=new ConvexGeometry(points),bvh=new MeshBVH(exact),box=new T.Box3().setFromPoints(points),center=box.getCenter(new T.Vector3());
  const normal=new T.Vector3(),edge=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  let owned;
  try {
    for(let count=64;count<=maxDirections;count*=2){
      const selected=new Set();
      for(let i=0;i<count;i++){
        const z=1-2*(i+.5)/count,theta=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-z*z),direction=new T.Vector3(r*Math.cos(theta),r*Math.sin(theta),z);
        let index=0,maximum=-Infinity;for(let j=0;j<points.length;j++){const d=points[j].dot(direction);if(d>maximum){maximum=d;index=j;}}
        selected.add(index);
      }
      owned=new ConvexGeometry([...selected].map(i=>points[i]));
      const position=owned.attributes.position;let factor=1;
      for(let i=0;i<position.count;i+=3){
        a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);
        normal.crossVectors(b.sub(a),edge.copy(c).sub(a)).normalize();
        const support=normal.dot(a.sub(center));if(!(support>1e-10))throw Error('Hull center must be strictly interior');
        let maximum=-Infinity;for(const point of points)maximum=Math.max(maximum,normal.dot(edge.copy(point).sub(center)));
        factor=Math.max(factor,maximum/support);
      }
      factor+=1e-6;
      for(let i=0;i<position.count;i++){a.fromBufferAttribute(position,i).sub(center).multiplyScalar(factor).add(center);position.setXYZ(i,a.x,a.y,a.z);}
      let maximumPlaneViolation=-Infinity,maximumOuterDistance=0;
      for(let i=0;i<position.count;i+=3){
        a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);
        normal.crossVectors(b.sub(a),edge.copy(c).sub(a)).normalize();const support=normal.dot(a);
        for(const point of points)maximumPlaneViolation=Math.max(maximumPlaneViolation,normal.dot(point)-support);
      }
      // ConvexGeometry uses Float32. Enforce the actual returned geometry's
      // containment, rather than trusting a pre-rounding scale calculation.
      if(maximumPlaneViolation > -1e-8){owned.dispose();owned=null;continue;}
      for(let i=0;i<position.count;i++)maximumOuterDistance=Math.max(maximumOuterDistance,bvh.closestPointToPoint(a.fromBufferAttribute(position,i)).distance);
      if(maximumOuterDistance<=maxError){
        const geometry=owned;owned=null;geometry.computeVertexNormals();geometry.computeBoundingBox();
        return {geometry,certificate:{directions:count,selectedSourceVertices:selected.size,sourceVertices:points.length,triangles:position.count/3,scaleFactor:factor,maximumPlaneViolation,maximumOuterDistance,maxError,requiredInwardMargin:1e-8}};
      }
      owned.dispose();owned=null;
    }
    throw Error('No conservative hull met the declared approximation budget');
  }finally{owned?.dispose();exact.dispose();}
}
