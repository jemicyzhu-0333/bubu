import * as T from 'three';
export const BONE_LIMITS=Object.freeze({Shoulder_L:.20,Shoulder_R:.20,Hip_L:.14,Hip_R:.14});
const axes=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)];
export function deltaQuaternion({x=0,y=0,z=0}={}){if(![x,y,z].every(Number.isFinite))throw new RangeError('Finite pose required');return new T.Quaternion().setFromAxisAngle(axes[2],z).multiply(new T.Quaternion().setFromAxisAngle(axes[1],y)).multiply(new T.Quaternion().setFromAxisAngle(axes[0],x));}
const identity=new T.Quaternion();
const capQuaternion=(q,cap)=>{const angle=q.angleTo(identity);if(angle>cap)q.slerp(identity,1-cap/angle);return q;};
/** Writes exactly four bone quaternion channels and host wrapper transforms.
 * No model translation, scale, geometry, face target or material writes.
 * The matching explicit body-enabled ActorPool is required. */
export class BodyRigAdapter {
 constructor(actorRoot,{pivotY=.9,yawDegrees=52}={}){
  if(!actorRoot||actorRoot.parent)throw new TypeError('Unparented actor root required');
  if(![pivotY,yawDegrees].every(Number.isFinite))throw new RangeError('Finite stage');
  this.actorRoot=actorRoot;this.root=new T.Group();this.root.name='Body_stage';this.pivot=new T.Group();this.pivot.name='Body_pivot';this.pivot.position.y=pivotY;this.offset=new T.Group();this.offset.position.y=-pivotY;this.offset.rotation.y=yawDegrees*Math.PI/180;this.root.add(this.pivot);this.pivot.add(this.offset);this.offset.add(actorRoot);this.bones={};this.rest={};this.disposed=false;
  for(const name of Object.keys(BONE_LIMITS)){const b=actorRoot.getObjectByName(name);if(!b?.isBone)throw Error('Missing bone '+name);this.bones[name]=b;this.rest[name]=b.quaternion.clone();}
  this.skin=actorRoot.getObjectByName('A_mochi_skin');if(!this.skin?.isSkinnedMesh)throw Error('Missing actual skin');this.root.updateMatrixWorld(true);this.initialGround=this.minimumFoot();
 }
 live(){if(this.disposed)throw Error('Body adapter disposed');}
 applyPose({body={},joints={}}={}){this.live();const q=capQuaternion(deltaQuaternion(body),.10);const values=Object.fromEntries(Object.keys(BONE_LIMITS).map(n=>[n,capQuaternion(deltaQuaternion(joints[n]),BONE_LIMITS[n])]));this.pivot.quaternion.copy(q);for(const n of Object.keys(values))this.bones[n].quaternion.copy(values[n]).multiply(this.rest[n]);this.root.updateMatrixWorld(true);}
 place({x=this.root.position.x,y=this.root.position.y,z=this.root.position.z}={}){this.live();if(![x,y,z].every(Number.isFinite))throw RangeError('Finite placement');this.root.position.set(x,y,z);this.root.updateMatrixWorld(true);}
 minimumFoot(){this.live();this.root.updateMatrixWorld(true);let min=Infinity;const p=new T.Vector3();for(let i=0;i<this.skin.geometry.attributes.position.count;i++){this.skin.getVertexPosition(i,p);p.applyMatrix4(this.skin.matrixWorld);min=Math.min(min,p.y);}return min;}
 constrainGround(groundY=this.initialGround){if(!Number.isFinite(groundY))throw RangeError('Finite ground');const dy=Math.max(0,groundY-this.minimumFoot());if(dy)this.place({y:this.root.position.y+dy});return dy;}
 surfaceAnchor(hit){this.live();if(!hit?.face||!hit.object?.isSkinnedMesh)throw TypeError('Actual skinned triangle hit required');const mesh=hit.object,indices=[hit.face.a,hit.face.b,hit.face.c],points=indices.map(i=>mesh.getVertexPosition(i,new T.Vector3()));return {mesh,indices,weights:T.Triangle.getBarycoord(mesh.worldToLocal(hit.point.clone()),...points,new T.Vector3())};}
 surfacePoint(anchor){this.root.updateMatrixWorld(true);const p=new T.Vector3(),v=new T.Vector3();anchor.indices.forEach((n,k)=>p.addScaledVector(anchor.mesh.getVertexPosition(n,v),anchor.weights.getComponent(k)));return anchor.mesh.localToWorld(p);}
 hitRay(x,y){this.root.updateMatrixWorld(true);this.skin.computeBoundingSphere();return new T.Raycaster(new T.Vector3(x,y,8),new T.Vector3(0,0,-1)).intersectObject(this.skin)[0]??null;}
 snapshot(){this.live();return {root:this.root.position.toArray(),pivot:this.pivot.quaternion.toArray(),jointQuaternions:Object.fromEntries(Object.keys(this.bones).map(n=>[n,this.bones[n].quaternion.toArray()])),minimumFootY:this.minimumFoot(),actorMatrix:this.actorRoot.matrixWorld.toArray()};}
 restore(){this.live();this.applyPose();}
 dispose(){if(this.disposed)return;this.restore();this.actorRoot.removeFromParent();this.root.removeFromParent();this.root.clear();this.disposed=true;}
}
