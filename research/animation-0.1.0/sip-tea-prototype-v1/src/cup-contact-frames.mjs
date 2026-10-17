import * as T from 'three';
/** Design-space contact frames only: no binding, actor writes, ownership or clock.
 * Socket positions exactly match cup-model. Normals point outward from ceramic.
 * All vectors returned fresh so a caller cannot mutate another cup's metadata. */
export function cupContactFrames({radius=.27,height=.33}={}) {
 if(!Number.isFinite(radius)||!Number.isFinite(height)||radius<.1||radius>.5||height<.15||height>.6)throw RangeError('Bounded cup dimensions required');
 const frame=(position,normal,tangent)=>({position:new T.Vector3(...position),normal:new T.Vector3(...normal),tangent:new T.Vector3(...tangent)});
 return {
  rim:frame([0,height,-radius*.95],[0,0,-1],[1,0,0]),
  handle:frame([radius*1.62,height*.53,0],[1,0,0],[0,1,0]),
  support:frame([-radius*.82,height*.35,0],[-1,0,0],[0,1,0]),
  base:frame([0,0,0],[0,-1,0],[1,0,0])
 };
}
/** Compute world-space frames from the final prop matrix; never writes that matrix. */
export function transformCupFrame(frame,matrix) {
 if(!matrix?.isMatrix4||!matrix.elements.every(Number.isFinite))throw TypeError('Finite matrix required');
 if(Math.abs(matrix.determinant())<1e-12)throw RangeError('Nonsingular contact transform required');
 for(const key of ['position','normal','tangent'])if(!frame?.[key]?.isVector3||!frame[key].toArray().every(Number.isFinite))throw TypeError('Finite contact frame required');
 if(frame.normal.lengthSq()<1e-12||frame.tangent.lengthSq()<1e-12)throw RangeError('Nonzero frame directions required');
 const normalMatrix=new T.Matrix3().getNormalMatrix(matrix);
 return {position:frame.position.clone().applyMatrix4(matrix),normal:frame.normal.clone().applyMatrix3(normalMatrix).normalize(),tangent:frame.tangent.clone().transformDirection(matrix)};
}
