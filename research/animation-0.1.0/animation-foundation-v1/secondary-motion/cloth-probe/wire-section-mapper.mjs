import assert from 'node:assert/strict';
import * as T from 'three';

/** Circular sections follow actual wire particles with parallel-transported
 * frames. Every unchanged source triangle remains inside its corresponding
 * segment capsule because each endpoint ring lies inside an endpoint ball. */
export function createWireSectionMapper(source,restCenters,{restFramePoints=null}={}) {
  const attribute=source.attributes.position,count=restCenters.length/3;
  assert([19,161].includes(count)&&attribute.count===count*13&&source.index,'Authored piping required');
  assert(restCenters.every(Number.isFinite));
  const hint=new T.Vector3().fromBufferAttribute(attribute,1).sub(new T.Vector3().fromArray(restCenters)),
    point=new T.Vector3(),tangent=new T.Vector3(),previousTangent=new T.Vector3(),x=new T.Vector3(),y=new T.Vector3(),rotation=new T.Quaternion();
  function frames(centers,bodyQuaternion,framePoints=null){
    assert(centers.length===count*3&&centers.every(v=>Number.isFinite(v)&&Math.abs(v)<10),'Finite bounded wire snapshot required');
    if(restFramePoints)assert(framePoints?.length===count*6&&framePoints.every(v=>Number.isFinite(v)&&Math.abs(v)<10),'Finite section frame points required');
    const matrices=[];
    for(let i=0;i<count;i++){
      if(restFramePoints){
        point.fromArray(centers,i*3);x.fromArray(framePoints,i*6).sub(point);y.fromArray(framePoints,i*6+3).sub(point);
        assert(x.length()>1e-8&&y.length()>1e-8,'Collapsed section frame');x.normalize();
        tangent.crossVectors(x,y);assert(tangent.length()>1e-8,'Collinear section frame');tangent.normalize();y.crossVectors(tangent,x).normalize();
        matrices.push(new T.Matrix4().makeBasis(x,y,tangent).setPosition(point));continue;
      }
      tangent.fromArray(centers,Math.min(count-1,i+1)*3).sub(point.fromArray(centers,Math.max(0,i-1)*3));
      assert(tangent.length()>1e-8,'Collapsed wire tangent');tangent.normalize();
      if(i===0)x.copy(hint).applyQuaternion(bodyQuaternion);
      else x.applyQuaternion(rotation.setFromUnitVectors(previousTangent,tangent));
      x.addScaledVector(tangent,-x.dot(tangent));assert(x.length()>1e-8,'Degenerate wire frame');x.normalize();
      y.crossVectors(tangent,x).normalize();
      matrices.push(new T.Matrix4().makeBasis(x,y,tangent).setPosition(point.fromArray(centers,i*3)));
      previousTangent.copy(tangent);
    }
    return matrices;
  }
  const restFrames=frames(restCenters,new T.Quaternion(),restFramePoints);
  let local=new Float64Array(attribute.array.length),output=new Float32Array(attribute.array.length),closed=false,radius=0;
  for(let section=0;section<count;section++){
    const inverse=restFrames[section].clone().invert(),center=new T.Vector3().fromArray(restCenters,section*3);
    for(let j=0;j<13;j++){
      point.fromBufferAttribute(attribute,section*13+j);radius=Math.max(radius,point.distanceTo(center));
      point.applyMatrix4(inverse).toArray(local,(section*13+j)*3);
    }
  }
  for(let i=0;i<source.index.count;i+=3){
    const sections=Array.from(source.index.array.slice(i,i+3),id=>Math.floor(id/13));
    assert(Math.max(...sections)-Math.min(...sections)===1,'Every exterior triangle must span one wire segment');
  }
  // Rapier stores radii as f32. Round upwards only as needed to retain the
  // exact enclosure; no fitting parameter or arbitrary radius inflation.
  assert(radius<.08,'Existing bounded rest detail required');
  // A displayed f32 vertex with coordinates below 16 can round by at most
  // 2^-21 on each axis. Include that proven numeric enclosure, not a fit knob.
  const renderRoundingAllowance=Math.sqrt(3)*2**-21;
  const rounded=new Float32Array([radius+renderRoundingAllowance]),bits=new Uint32Array(rounded.buffer);
  if(rounded[0]<radius+renderRoundingAllowance)bits[0]++;
  const collisionRadius=rounded[0];
  return {
    radius:collisionRadius,
    certificate:{sections:count,segments:count-1,maximumSourceRadius:radius,collisionRadius,
      renderRoundingAllowance,roundingExcess:collisionRadius-radius-renderRoundingAllowance,allExteriorTrianglesCovered:true,sectionShape:'unchanged rigid local cross sections',orientation:restFramePoints?'physical section triads':'parallel transported centerline'},
    map(centers,bodyRotation=[0,0,0,1],framePoints=null){
      assert(!closed,'Wire mapper disposed');
      assert(Array.isArray(bodyRotation)&&bodyRotation.length===4&&bodyRotation.every(Number.isFinite)&&Math.abs(Math.hypot(...bodyRotation)-1)<1e-8,'Unit body rotation required');
      const current=frames(centers,new T.Quaternion(...bodyRotation),framePoints);
      for(let section=0;section<count;section++)for(let j=0;j<13;j++)point.fromArray(local,(section*13+j)*3).applyMatrix4(current[section]).toArray(output,(section*13+j)*3);
      return output;
    },
    dispose(){if(closed)return;closed=true;local=null;output=null;},
  };
}
