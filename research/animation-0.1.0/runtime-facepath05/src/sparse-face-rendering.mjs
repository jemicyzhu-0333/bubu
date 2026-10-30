import {Vector2, REVISION} from 'three';
import {fail} from './contracts.mjs';

const KEY='bubu-face-two-knots-three-186-v1';
function replaceOnce(source, token, replacement) {
  if(source.split(token).length!==2)fail('FACE_SHADER','Pinned Three shader chunk mismatch');
  return source.replace(token,replacement);
}
const chunk=(guard,value,offset)=>`#ifdef ${guard}
  ${value} *= morphTargetBaseInfluence;
  for (int slot = 0; slot < 2; slot++) {
    int index = int(bubuFaceIndices[slot]);
    float weight = morphTargetInfluences[index];
    if (weight != 0.0) ${value} += getMorph(gl_VertexID, index, ${offset}).xyz * weight;
  }
#endif`;

/** Rendering belongs to the face owner. Borrow immutable geometry/textures;
 * own only per-actor materials/uniforms. Keep the full original morph texture,
 * original base influence and ascending sum order. Never truncate extra knots. */
export function bindSparseFaceRendering(model,profile) {
  if(REVISION!=='186')fail('FACE_SHADER','Unverified Three revision');
  const entries=[];let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    for(const {mesh,source,material} of entries){mesh.material=source;material.dispose();}
    entries.length=0;
  };
  try {
    for(const name of profile.faceMeshes) {
      const mesh=model.getObjectByName(name), geometry=mesh?.geometry;
      if(!mesh?.isMesh||Array.isArray(mesh.material)||!mesh.morphTargetInfluences||
         !geometry.morphAttributes.position?.length||geometry.morphAttributes.color?.length)
        fail('FACE_SHADER','Unsupported face morph layout');
      const source=mesh.material,material=source.clone(),indices={value:new Vector2()};
      const sourceCompile=source.onBeforeCompile,sourceKey=source.customProgramCacheKey();
      material.onBeforeCompile=function(shader,renderer){
        sourceCompile.call(source,shader,renderer);
        let vertex=replaceOnce(shader.vertexShader,'#include <common>',
          '#include <common>\nuniform vec2 bubuFaceIndices;');
        vertex=replaceOnce(vertex,'#include <morphtarget_vertex>',chunk('USE_MORPHTARGETS','transformed',0));
        vertex=replaceOnce(vertex,'#include <morphnormal_vertex>',chunk('USE_MORPHNORMALS','objectNormal',1));
        shader.vertexShader=vertex;shader.uniforms.bubuFaceIndices=indices;
      };
      material.customProgramCacheKey=()=>KEY+':'+sourceKey;
      entries.push({mesh,source,material,indices});mesh.material=material;
    }
    const update=()=>{
      if(disposed)fail('DISPOSED','Face rendering');
      for(const {mesh,indices} of entries) {
        const weights=mesh.morphTargetInfluences;let first=-1,second=-1;
        for(let i=0;i<weights.length;i++) {
          if(!Number.isFinite(weights[i]))fail('FACE_SHADER','Nonfinite morph influence');
          if(weights[i]===0)continue;
          if(first<0)first=i;
          else if(second<0)second=i;
          else fail('FACE_SHADER','More than two active face knots');
        }
        // With zero/one active knots, select a zero-weight entry as padding.
        let zero=0;while(zero<weights.length&&weights[zero]!==0)zero++;
        if(zero===weights.length&&second<0)fail('FACE_SHADER','Missing zero padding knot');
        indices.value.set(first<0?zero:first,second<0?zero:second);
      }
    };
    update();return {update,dispose};
  }catch(error){dispose();throw error;}
}
