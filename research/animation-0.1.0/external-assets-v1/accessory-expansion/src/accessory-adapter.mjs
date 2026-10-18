import * as T from 'three';
export const SPECS=Object.freeze( {
  halo: {
    id:'milestone.halo',exclusiveGroup:'head-aura',minLevel:12
  }
  ,boots: {
    id:'milestone.boots',exclusiveGroup:'footwear',minLevel:15
  }
  ,cape: {
    id:'milestone.cape',exclusiveGroup:'backwear',minLevel:20
  }
}
);
const leases=new WeakMap();
const footOwners=new WeakMap();
function lease(asset) {
  let state=leases.get(asset);
  if(!state) {
    state= {
      references:0,disposed:false
    }
    ;
    leases.set(asset,state);
  }
  if(state.disposed)throw new Error('Asset already released');
  return state;
}
function checkMatrix(matrix) {
  if(!matrix.elements.every(Number.isFinite)||Math.abs(matrix.determinant())<1e-10)throw new Error('Non-finite or singular host transform');
}
/** Research host adapter. No persistence, clock, actor geometry or source-material writes.
 * A source asset is borrowed by every actor. Release it explicitly after the last adapter.
 */
export class AccessoryAdapter  {
  constructor( {
    kind,sourceSkin,parent,asset,assertSourceCurrent,occludedFeet=[]
  }
  )  {
    if(!SPECS[kind]||!sourceSkin?.isSkinnedMesh||!parent||!asset||typeof assertSourceCurrent!=='function')throw new TypeError('Validated actor, parent, asset and ownership guard required');
    assertSourceCurrent();
    const state=lease(asset);
    parent.updateWorldMatrix(true,false);
    sourceSkin.updateWorldMatrix(true,false);
    checkMatrix(parent.matrixWorld);
    checkMatrix(sourceSkin.matrixWorld);
    if(kind==='boots') {
      let count=0;
      asset.traverse(o=> {
        o.updateMatrix();
        if(!o.matrix.equals(new T.Matrix4()))throw new Error('Shoe assets require identity node transforms');
        if(!o.isMesh)return;
        count++;
        if(!['boots_left','boots_right'].includes(o.name))throw new Error('Unknown shoe mesh');
        for(const key of ['skinIndex','skinWeight'])if(!o.geometry.attributes[key])throw new Error('Missing shoe native binding');
      }
      );
      if(count!==2)throw new Error('Exactly two shoe meshes required');
      if(occludedFeet.length!==2||new Set(occludedFeet).size!==2||new Set(occludedFeet.map(m=>m.name)).size!==2||occludedFeet.some(m=>!m.isSkinnedMesh||m.skeleton!==sourceSkin.skeleton||!['Bubu_foot-left','Bubu_foot-right'].includes(m.name)||footOwners.has(m)))throw new Error('Two unowned native hybrid feet from this actor required');
    }
    this.kind=kind;
    this.skin=sourceSkin;
    this.guard=assertSourceCurrent;
    this.skeleton=sourceSkin.skeleton;
    this.bindMatrix=sourceSkin.bindMatrix.clone();
    this.bindMode=sourceSkin.bindMode;
    this.parent=parent;
    this.disposed=false;
    this.asset=asset;
    this.lease=state;
    this.leased=false;
    this.root=new T.Group();
    this.root.name='Accessory_'+kind;
    this.root.matrixAutoUpdate=false;
    this.geometry=sourceSkin.geometry;
    this.parts=[];
    this.feet=occludedFeet.map(mesh=>( {
      mesh,visible:mesh.visible
    }
    ));
    try {
      if(kind==='boots')asset.traverse(o=> {
        if(!o.isMesh)return;
        const m=new T.SkinnedMesh(o.geometry,o.material);
        m.name=o.name;
        m.bindMode=sourceSkin.bindMode;
        m.bind(this.skeleton,sourceSkin.bindMatrix);
        m.frustumCulled=false;
        this.root.add(m);
        this.parts.push(m);
      }
      );
      else this.root.add(asset.clone(true));
      for(const f of this.feet)footOwners.set(f.mesh,this);
      parent.add(this.root);
      state.references++;
      this.leased=true;
      this.update();
    }
    catch(e) {
      this.dispose();
      throw e;
    }
  }
  update( {
    enabled=true
  }
  = {
  }
  )  {
    if(this.disposed)throw new Error('Accessory disposed');
    try {
      this.guard();
      if(this.skin.geometry!==this.geometry||this.skin.skeleton!==this.skeleton||!this.skin.bindMatrix.equals(this.bindMatrix)||this.skin.bindMode!==this.bindMode)throw new Error('Actor identity changed');
      this.skin.updateWorldMatrix(true,false);
      this.parent.updateWorldMatrix(true,false);
      checkMatrix(this.parent.matrixWorld);
      checkMatrix(this.skin.matrixWorld);
      this.root.matrix.copy(this.parent.matrixWorld).invert().multiply(this.skin.matrixWorld);
      this.root.visible=enabled;
      for(const f of this.feet)f.mesh.visible=enabled?false:f.visible;
      this.root.updateMatrixWorld(true);
      return this;
    }
    catch(e) {
      this.dispose();
      throw e;
    }
  }
  dispose() {
    if(this.disposed)return;
    this.root.removeFromParent();
    this.root.clear();
    this.parts=[];
    for(const f of this.feet??[]) {
      if(footOwners.get(f.mesh)===this) {
        f.mesh.visible=f.visible;
        footOwners.delete(f.mesh);
      }
    }
    if(this.leased) {
      this.lease.references--;
      this.leased=false;
    }
    this.disposed=true;
  }
}
export function disposeAsset(asset) {
  const state=lease(asset);
  if(state.references)throw new Error('Asset still borrowed by '+state.references+' actors');
  const gs=new Set(),ms=new Set(),ts=new Set();
  asset.traverse(o=> {
    if(o.geometry)gs.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) {
      ms.add(m);
      for(const v of Object.values(m))if(v?.isTexture)ts.add(v);
    }
  }
  );
  for(const t of ts)t.dispose();
  for(const m of ms)m.dispose();
  for(const g of gs)g.dispose();
  state.disposed=true;
  return {
    geometries:gs.size,materials:ms.size,textures:ts.size
  }
  ;
}
