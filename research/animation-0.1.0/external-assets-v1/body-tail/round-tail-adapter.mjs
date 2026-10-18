import * as T from 'three';
const owners=new WeakMap();
/** Anatomical restoration is actor-owned, never wardrobe-owned. Borrowed source
 * geometry/material/skeleton are immutable. Call update after native pose solves. */
export function createRoundTail({sourceSkin,parent,asset,assertSourceCurrent}){
 if(!sourceSkin?.isSkinnedMesh||!parent||!asset||typeof assertSourceCurrent!=='function')throw new TypeError('Native actor, parent, tail asset and ownership guard required');
 assertSourceCurrent();if(owners.has(sourceSkin))throw new Error('Actor already has a round tail');
 const template=asset.getObjectByName('Bubu_round-tail');if(!template?.isMesh)throw new Error('Round-tail geometry missing');
 const geometry=sourceSkin.geometry,skeleton=sourceSkin.skeleton,bind=sourceSkin.bindMatrix.clone(),mode=sourceSkin.bindMode,material=sourceSkin.material;
 for(const key of ['position','normal','skinIndex','skinWeight'])if(!template.geometry.attributes[key])throw new Error('Tail attribute missing: '+key);
 const weights=template.geometry.attributes.skinWeight,joints=template.geometry.attributes.skinIndex;
 for(let i=0;i<weights.count;i++)if(weights.getX(i)!==1||weights.getY(i)!==0||weights.getZ(i)!==0||weights.getW(i)!==0||joints.getX(i)!==0)throw new Error('Tail must bind to native lower-back Body joint');
 if(skeleton.bones[0].name!=='Body')throw new Error('Wrong native skeleton');
 const mesh=new T.SkinnedMesh(template.geometry,material);mesh.name='Bubu_round-tail';mesh.bindMode=mode;mesh.bind(skeleton,bind);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;parent.add(mesh);let disposed=false;owners.set(sourceSkin,mesh);
 function dispose(){if(disposed)return;mesh.removeFromParent();owners.delete(sourceSkin);disposed=true;}
 function update({enabled=true}={}){if(disposed)throw new Error('Tail disposed');try{assertSourceCurrent();if(sourceSkin.geometry!==geometry||sourceSkin.skeleton!==skeleton||sourceSkin.material!==material||sourceSkin.bindMode!==mode||!sourceSkin.bindMatrix.equals(bind))throw new Error('Native actor identity changed');parent.updateWorldMatrix(true,false);sourceSkin.updateWorldMatrix(true,false);if(Math.abs(parent.matrixWorld.determinant())<1e-10)throw new Error('Invalid parent transform');mesh.matrix.copy(parent.matrixWorld).invert().multiply(sourceSkin.matrixWorld);if(!mesh.matrix.elements.every(Number.isFinite))throw new Error('Invalid tail transform');mesh.visible=enabled;mesh.updateMatrixWorld(true);skeleton.update();return mesh;}catch(e){dispose();throw e;}}
 update();return{mesh,update,dispose};
}
