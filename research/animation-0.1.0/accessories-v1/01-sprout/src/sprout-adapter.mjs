import * as T from 'three';
export const SPROUT_SPEC=Object.freeze({id:'milestone.sprout',exclusiveGroup:'headwear',minLevel:3,effect:'sprout-sway',anchor:[0,1.62766,0],maxSway:.06,period:3.2});
/** Accessory-only owner. Parent must be external to the validated actor tree.
 * Call update with the host's monotonic timeline after body pose is applied.
 * The caller owns the loaded asset and disposes it after all adapters release it. */
export class SproutAdapter {
 constructor({actorRoot,parent,asset}){
  if(!actorRoot||!parent||!asset)throw new TypeError('actorRoot, external parent and asset required');
  for(let p=parent;p;p=p.parent)if(p===actorRoot)throw new TypeError('Accessory must be outside validated actor tree');
  this.skin=actorRoot.getObjectByName('A_mochi_skin');if(!this.skin?.isSkinnedMesh)throw new TypeError('Approved skinned body required');
  this.parent=parent;this.root=new T.Group();this.root.name='Accessory_milestone.sprout';this.root.add(asset.clone(true));parent.add(this.root);this.disposed=false;
  const desired=new T.Vector3(...SPROUT_SPEC.anchor);let best=Infinity;this.vertex=-1;const p=new T.Vector3();
  for(let i=0;i<this.skin.geometry.attributes.position.count;i++){this.skin.getVertexPosition(i,p);const d=p.distanceToSquared(desired);if(d<best){best=d;this.vertex=i;}}
  if(Math.sqrt(best)>.04){this.root.removeFromParent();throw new Error('Unexpected approved surface anchor');}
  this.vertexLocal=this.skin.getVertexPosition(this.vertex,new T.Vector3());this.update(0);
 }
 update(time,{reducedMotion=false,enabled=true}={}){
  if(this.disposed)throw new Error('Accessory disposed');if(!Number.isFinite(time))throw new RangeError('Finite host time required');
  this.root.visible=enabled;this.skin.updateWorldMatrix(true,false);this.parent.updateWorldMatrix(true,false);
  const point=this.skin.getVertexPosition(this.vertex,new T.Vector3());this.skin.localToWorld(point);this.root.position.copy(this.parent.worldToLocal(point));
  const relative=new T.Matrix4().copy(this.parent.matrixWorld).invert().multiply(this.skin.matrixWorld);
  const q=new T.Quaternion(),scale=new T.Vector3();relative.decompose(new T.Vector3(),q,scale);this.root.quaternion.copy(q);this.root.scale.copy(scale);
  const sway=reducedMotion?0:SPROUT_SPEC.maxSway*Math.sin(2*Math.PI*time/SPROUT_SPEC.period);
  this.root.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),sway));this.root.updateMatrixWorld(true);return sway;
 }
 dispose(){if(this.disposed)return;this.root.removeFromParent();this.root.clear();this.disposed=true;}
}
