/** Inject the four unchanged adapters from the intended repository. Browser-safe:
 * this module performs no filesystem reads and has no Node-only imports. */
export function createExistingWearableHostClass({sprout,sunhat,satchel,scarf}) {
const {SproutAdapter,SPROUT_SPEC}=sprout;
const {SunhatAdapter,SUNHAT_SPEC}=sunhat;
const {SatchelAdapter,SATCHEL_SPEC}=satchel;
const {ScarfAdapter,SCARF_SPEC}=scarf;
const SPECS={sprout:SPROUT_SPEC,sunhat:SUNHAT_SPEC,satchel:SATCHEL_SPEC,scarf:SCARF_SPEC};
const classes={sprout:SproutAdapter,sunhat:SunhatAdapter,satchel:SatchelAdapter,scarf:ScarfAdapter};
function valid(m){if(!m.elements.every(Number.isFinite)||Math.abs(m.determinant())<1e-10)throw Error('Invalid host transform');}
/** Research installation owner. Owns only group admissions and adapter instances.
 * Actor/source owner remains authoritative; no wardrobe/persistence writes.
 * Eligibility must be supplied by the actual external wardrobe owner.
 */
class ExistingWearableHost {
 constructor({actorRoot,parent,sourceSkin,hybridOwner,assertSourceCurrent,assertAdmission}){
  if(typeof assertSourceCurrent!=='function'||typeof assertAdmission!=='function'||actorRoot?.getObjectByName('A_mochi_skin')!==sourceSkin||!sourceSkin?.isSkinnedMesh||!hybridOwner)throw Error('Same actor and explicit source/admission owners required');
  assertSourceCurrent();
  if(hybridOwner.nativeMeshes?.some(m=>m.skeleton!==sourceSkin.skeleton))throw Error('Foreign hybrid actor');
  for(let p=parent;p;p=p.parent)if(p===actorRoot)throw Error('External accessory parent required');
  this.actorRoot=actorRoot;this.parent=parent;this.skin=sourceSkin;this.hybrid=hybridOwner;this.guard=assertSourceCurrent;this.admit=assertAdmission;
  this.geometry=sourceSkin.geometry;this.skeleton=sourceSkin.skeleton;this.bind=sourceSkin.bindMatrix.clone();this.mode=sourceSkin.bindMode;this.items=new Map();this.disposed=false;
  if(!actorGroups.has(actorRoot))actorGroups.set(actorRoot,new Map());this.groups=actorGroups.get(actorRoot);
  this.assertCurrent();
 }
 assertCurrent(){
  if(this.disposed)throw Error('Host disposed');
  this.guard();
  if(this.actorRoot.getObjectByName('A_mochi_skin')!==this.skin||this.skin.geometry!==this.geometry||this.skin.skeleton!==this.skeleton||!this.bind.equals(this.skin.bindMatrix)||this.mode!==this.skin.bindMode)throw Error('Stale source identity');
  if(this.hybrid.disposed||this.hybrid.nativeMeshes.some(m=>m.skeleton!==this.skeleton))throw Error('Stale hybrid owner');
  this.hybrid.update();this.parent.updateWorldMatrix(true,false);this.skin.updateWorldMatrix(true,false);valid(this.parent.matrixWorld);valid(this.skin.matrixWorld);
 }
 install(kind,asset){
  this.assertCurrent();const spec=SPECS[kind];if(!spec)throw Error('Unknown accessory');
  this.admit(spec);
  if(this.groups.has(spec.exclusiveGroup))throw Error('Occupied exclusive group');
  const lease=state(asset);if(lease.released)throw Error('Released asset');
  const before=new Set(this.parent.children);let adapter;
  try{adapter=new classes[kind]({actorRoot:this.actorRoot,parent:this.parent,asset});this.assertCurrent();this.items.set(kind,{adapter,asset});this.groups.set(spec.exclusiveGroup,this);lease.count++;return adapter;}
  catch(e){adapter?.dispose();for(const child of this.parent.children.slice())if(!before.has(child))child.removeFromParent();throw e;}
 }
 update(time,options={}){
  try{this.assertCurrent();for(const {adapter} of this.items.values())adapter.update(time,options);this.assertCurrent();return this;}
  catch(e){this.dispose();throw e;}
 }
 remove(kind){const item=this.items.get(kind);if(!item)return;item.adapter.dispose();state(item.asset).count--;this.items.delete(kind);if(this.groups.get(SPECS[kind].exclusiveGroup)===this)this.groups.delete(SPECS[kind].exclusiveGroup);}
 dispose(){if(this.disposed)return;for(const kind of [...this.items.keys()])this.remove(kind);this.disposed=true;}
}
return {ExistingWearableHost,SPECS};
}
const leases=new WeakMap();
const actorGroups=new WeakMap();
function state(asset){if(!leases.has(asset))leases.set(asset,{count:0,released:false});return leases.get(asset);}
export function releaseExistingAsset(asset){const lease=state(asset);if(lease.released)return;if(lease.count)throw Error('Asset is borrowed');const resources=new Set();asset.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){resources.add(m);for(const t of Object.values(m))if(t?.isTexture)resources.add(t);}});for(const r of resources)r.dispose();lease.released=true;}
