import {REVISION} from 'three';

const skinBase=`#ifdef USE_SKINNING
mat4 boneMatX = mat4(0.0);
mat4 boneMatY = mat4(0.0);
mat4 boneMatZ = mat4(0.0);
mat4 boneMatW = mat4(0.0);
if (skinWeight.x != 0.0) boneMatX = getBoneMatrix(skinIndex.x);
if (skinWeight.y != 0.0) {
  if (skinWeight.x != 0.0 && skinIndex.y == skinIndex.x) boneMatY = boneMatX;
  else boneMatY = getBoneMatrix(skinIndex.y);
}
if (skinWeight.z != 0.0) {
  if (skinWeight.x != 0.0 && skinIndex.z == skinIndex.x) boneMatZ = boneMatX;
  else if (skinWeight.y != 0.0 && skinIndex.z == skinIndex.y) boneMatZ = boneMatY;
  else boneMatZ = getBoneMatrix(skinIndex.z);
}
if (skinWeight.w != 0.0) {
  if (skinWeight.x != 0.0 && skinIndex.w == skinIndex.x) boneMatW = boneMatX;
  else if (skinWeight.y != 0.0 && skinIndex.w == skinIndex.y) boneMatW = boneMatY;
  else if (skinWeight.z != 0.0 && skinIndex.w == skinIndex.z) boneMatW = boneMatZ;
  else boneMatW = getBoneMatrix(skinIndex.w);
}
#endif`;

/** Experimental renderer-only clone lease. Source geometry, weights, bones and
 * materials stay unchanged. Zero-weight matrix terms cannot contribute for the
 * admitted finite matrices; the original weighted arithmetic order is retained. */
export function createSparseSkinningLease(meshes){
  if(REVISION!=='186')throw Error('Unverified Three revision');
  const entries=[];let disposed=false;
  function dispose(){if(disposed)return;disposed=true;for(const {mesh,source,material} of entries){mesh.material=source;material.dispose();}entries.length=0;}
  try{
    for(const mesh of meshes){
      if(!mesh.isSkinnedMesh||Array.isArray(mesh.material))throw Error('Single-material skinned mesh required');
      const source=mesh.material,material=source.clone(),compile=source.onBeforeCompile,key=source.customProgramCacheKey();
      material.onBeforeCompile=(shader,renderer)=>{
        compile.call(source,shader,renderer);
        const token='#include <skinbase_vertex>';
        if(shader.vertexShader.split(token).length!==2)throw Error('Pinned skinning shader chunk mismatch');
        shader.vertexShader=shader.vertexShader.replace(token,skinBase);
      };
      material.customProgramCacheKey=()=>`bubu-zero-weight-skinning-three186-v1:${key}`;
      entries.push({mesh,source,material});mesh.material=material;
    }
    return {dispose};
  }catch(error){dispose();throw error;}
}
