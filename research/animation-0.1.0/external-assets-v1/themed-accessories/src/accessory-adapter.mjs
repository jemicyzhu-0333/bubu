import {SupportedDeformation} from '../../accessory-expansion/src/supported-deformation.mjs';
import * as T from 'three';
export const SPECS=Object.freeze({"cap":{"id":"skin.woodsman-cap","slot":"head","exclusiveGroup":"headwear","exclusivePriority":80,"minLevel":1,"unlockKind":"skin","optInOnly":false,"formId":"dango","skin":"woodsman"},"fin":{"id":"skin.ocean-fin","slot":"back","exclusiveGroup":"backwear","exclusivePriority":100,"minLevel":1,"unlockKind":"skin","optInOnly":false,"formId":"dango","skin":"ocean"},"wings":{"id":"skin.bat-wings","slot":"back","exclusiveGroup":"backwear","exclusivePriority":100,"minLevel":1,"unlockKind":"skin","optInOnly":false,"formId":"dango","skin":"bat"},"plum":{"id":"seasonal.plum-cape","slot":"back","exclusiveGroup":"backwear","exclusivePriority":80,"minLevel":1,"unlockKind":"level","optInOnly":true,"formId":"dango","skin":null}});
const leases=new WeakMap();
function lease(asset){let s=leases.get(asset);if(!s){s={count:0,released:false};leases.set(asset,s);}if(s.released)throw new Error('Asset already released');return s;}
function valid(matrix){if(!matrix.elements.every(Number.isFinite)||Math.abs(matrix.determinant())<1e-10)throw new Error('Invalid host transform');}
/** Research host only. Assets borrowed; source actor is never mutated. No clock or new pose. */
export class AccessoryAdapter {
 constructor({kind,sourceSkin,parent,asset,assertSourceCurrent}) {
  if(!SPECS[kind]||!sourceSkin?.isSkinnedMesh||!parent||!asset||typeof assertSourceCurrent!=='function')throw new TypeError('Validated actor, parent, asset and ownership guard required');
  assertSourceCurrent();this.lease=lease(asset);this.bind=sourceSkin.bindMatrix.clone();this.bindMode=sourceSkin.bindMode;this.kind=kind;this.skin=sourceSkin;this.guard=assertSourceCurrent;this.skeleton=sourceSkin.skeleton;this.parent=parent;this.disposed=false;this.root=new T.Group();this.root.name='Accessory_'+kind;this.root.matrixAutoUpdate=false;
  this.geometry=sourceSkin.geometry;this.parts=[];
  if(kind==='boots')asset.traverse(o=>{if(!o.isMesh)return;for(const key of ['skinIndex','skinWeight'])if(!o.geometry.attributes[key])throw new Error('Missing shoe native binding');const m=new T.SkinnedMesh(o.geometry,o.material);m.name=o.name;m.bindMode=sourceSkin.bindMode;m.bind(this.skeleton,sourceSkin.bindMatrix);m.frustumCulled=false;this.root.add(m);this.parts.push(m);});
  else this.root.add(asset.clone(true));
  this.deformation=new SupportedDeformation(this.root,kind);parent.add(this.root);this.lease.count++;this.leased=true;this.update();
 }
 update({enabled=true,time,reducedMotion=false,calmVisual=false,reset=false}={}) {
  if(this.disposed)throw new Error('Accessory disposed');
  try{this.guard();if(this.skin.geometry!==this.geometry||this.skin.skeleton!==this.skeleton||!this.skin.bindMatrix.equals(this.bind)||this.skin.bindMode!==this.bindMode)throw new Error('Actor identity changed');}catch(e){this.dispose();throw e;}
  this.skin.updateWorldMatrix(true,false);this.parent.updateWorldMatrix(true,false);
  try{valid(this.parent.matrixWorld);valid(this.skin.matrixWorld);}catch(e){this.dispose();throw e;}
  this.root.matrix.copy(this.parent.matrixWorld).invert().multiply(this.skin.matrixWorld);
  this.deformation.update(this.skin.matrixWorld,{time,enabled,reducedMotion:reducedMotion||calmVisual,reset});this.root.visible=enabled;this.root.updateMatrixWorld(true);return this;
 }
 dispose(){if(this.disposed)return;this.deformation?.dispose();this.root.removeFromParent();this.root.clear();this.parts=[];if(this.leased){this.lease.count--;this.leased=false;}this.disposed=true;}
}
export function disposeAsset(asset){const state=lease(asset);if(state.count)throw new Error('Asset still borrowed');state.released=true;const gs=new Set(),ms=new Set(),ts=new Set();asset.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});for(const t of ts)t.dispose();for(const m of ms)m.dispose();for(const g of gs)g.dispose();return{geometries:gs.size,materials:ms.size,textures:ts.size};}

/** Reject same-slot combinations before installation; test exports may compare items separately. */
export function assertCompatible(kinds){
 const used=new Set();
 for(const kind of kinds){const spec=SPECS[kind];if(!spec)throw new Error('Unknown accessory');if(used.has(spec.exclusiveGroup))throw new Error('Conflicting accessory slot: '+spec.exclusiveGroup);used.add(spec.exclusiveGroup);}
 return true;
}
