import * as T from 'three';
export const SPECS=Object.freeze({forest:{id:'skin.forest-leaf',exclusiveGroup:'head-accent'},sakura:{id:'skin.sakura-flower',exclusiveGroup:'head-accent'},moon:{id:'skin.moon-crescent',exclusiveGroup:'head-accent'},flame:{id:'skin.flame-tip',exclusiveGroup:'headwear'},crown:{id:'skin.crown',exclusiveGroup:'headwear'},antenna:{id:'skin.robot-antenna',exclusiveGroup:'headwear'},pumpkin:{id:'seasonal.pumpkin-beret',exclusiveGroup:'headwear'}});
/** Research host only. Assets borrowed; source actor is never mutated. No clock or new pose. */
export class AccessoryAdapter {
 constructor({kind,sourceSkin,parent,asset,assertSourceCurrent}) {
  if(!SPECS[kind]||!sourceSkin?.isSkinnedMesh||!parent||!asset||typeof assertSourceCurrent!=='function')throw new TypeError('Validated actor, parent, asset and ownership guard required');
  assertSourceCurrent();this.kind=kind;this.skin=sourceSkin;this.guard=assertSourceCurrent;this.skeleton=sourceSkin.skeleton;this.parent=parent;this.disposed=false;this.root=new T.Group();this.root.name='Accessory_'+kind;this.root.matrixAutoUpdate=false;
  this.geometry=sourceSkin.geometry;this.parts=[];
  this.root.add(asset.clone(true));
  parent.add(this.root);this.update();
 }
 update({enabled=true}={}) {
  if(this.disposed)throw new Error('Accessory disposed');
  try{this.guard();if(this.skin.geometry!==this.geometry||this.skin.skeleton!==this.skeleton)throw new Error('Actor identity changed');}catch(e){this.dispose();throw e;}
  this.skin.updateWorldMatrix(true,false);this.parent.updateWorldMatrix(true,false);
  this.root.matrix.copy(this.parent.matrixWorld).invert().multiply(this.skin.matrixWorld);
  this.root.visible=enabled;this.root.updateMatrixWorld(true);return this;
 }
 dispose(){if(this.disposed)return;this.root.removeFromParent();this.root.clear();this.parts=[];this.disposed=true;}
}
export function disposeAsset(asset){const gs=new Set(),ms=new Set(),ts=new Set();asset.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});for(const t of ts)t.dispose();for(const m of ms)m.dispose();for(const g of gs)g.dispose();return{geometries:gs.size,materials:ms.size,textures:ts.size};}
