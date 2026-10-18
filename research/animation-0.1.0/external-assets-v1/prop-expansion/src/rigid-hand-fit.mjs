import * as T from 'three';
/** Fit the existing hand as a rigid object. No scale, vertex rewrite or extra limb.
 * Seed must preserve original palm orientation (e.g. the existing carrier's pose).
 * Contact is a real original hand vertex; shoulder cap burial is checked separately against body BVH. */
export function fitRigidHand({seedMatrix,gripSource,contact,pivotRotationX=0}){
 if(!seedMatrix?.isMatrix4||![gripSource,contact].every(v=>v?.isVector3&&v.toArray().every(Number.isFinite))||!Number.isFinite(pivotRotationX)||Math.abs(pivotRotationX)>.65)throw TypeError('Finite bounded rigid fit required');
 const x=new T.Vector3(),y=new T.Vector3(),z=new T.Vector3();seedMatrix.extractBasis(x,y,z);
 if(![x,y,z].every(v=>Math.abs(v.length()-1)<1e-6)||Math.abs(x.dot(y))+Math.abs(x.dot(z))+Math.abs(y.dot(z))>1e-6||Math.abs(seedMatrix.determinant()-1)>1e-6)throw TypeError('Seed must be proper rigid transform');
 const matrix=seedMatrix.clone(),delta=contact.clone().sub(gripSource.clone().applyMatrix4(matrix));matrix.premultiply(new T.Matrix4().makeTranslation(...delta.toArray()));
 const pivot=new T.Matrix4().makeTranslation(...contact.toArray()).multiply(new T.Matrix4().makeRotationX(pivotRotationX)).multiply(new T.Matrix4().makeTranslation(-contact.x,-contact.y,-contact.z));matrix.premultiply(pivot);
 return {matrix,contactError:gripSource.clone().applyMatrix4(matrix).distanceTo(contact),policy:'Validate actual palm contact, outward-facing cap burial, no coplanar body seam, and four real views before acceptance.'};
}
