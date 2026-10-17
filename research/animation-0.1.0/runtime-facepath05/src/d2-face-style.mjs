import {Float32BufferAttribute} from 'three';
import {N3_CAVITY_MASK,N3_CAVITY_DELTA,N3_CAVITY_STRENGTH,n3CavityGate} from './n3-cavity-mask.mjs';
import {geometryBackingBytes} from './geometry-accounting.mjs';
import {fail} from './contracts.mjs';
const ATTRIBUTE='bubuD2CavityMask',UNIFORM='bubuD2CavityGate';
const delta=N3_CAVITY_DELTA.map(x=>x*N3_CAVITY_STRENGTH);
function replaceOnce(source,token,replacement){if(source.split(token).length!==2)fail('STYLE_SHADER','Pinned Three shader chunk mismatch');return source.replace(token,replacement);}
/** Only before cache publication, on this exact D2 source. Deep copy owns every
 * attribute; the original parser geometry is never mutated. Static mask is then
 * shared immutably by this source's actors and disposed by its last cache lease. */
export function prepareD2SourceGeometry(scene){
 const mouth=scene.getObjectByName('A_mouth_ring');
 if(!mouth?.isMesh||mouth.geometry.getAttribute('position').count!==704||mouth.geometry.getAttribute(ATTRIBUTE))fail('STYLE_BINDING','D2 source mouth');
 const original=mouth.geometry,geometry=original.clone();
 try{
  const size=geometryBackingBytes({traverse:f=>f({geometry})});
  if(size!==2471680)fail('STYLE_BINDING','D2 mouth clone byte cost drift');
  geometry.setAttribute(ATTRIBUTE,new Float32BufferAttribute(N3_CAVITY_MASK,1));
  mouth.geometry=geometry;original.dispose();
 }catch(error){geometry.dispose();throw error;}
 return Object.freeze({geometryBackingBytes:geometryBackingBytes(scene),maskBytes:2816,sourceClonePeakExtraBytes:2474496});
}
/** One fixed patch, no shader DSL or public parameter override. Source material
 * remains unchanged (it is also used by the eyes); only this actor owns uniform
 * and cloned mouth material. The face clock is the sole amount source. */
export function bindD2FaceStyle(model){
 const mouth=model.getObjectByName('A_mouth_ring'),attribute=mouth?.geometry.getAttribute(ATTRIBUTE);
 if(!attribute||attribute.count!==704||Array.isArray(mouth.material))fail('STYLE_BINDING','D2 static mask/material');
 const sourceMaterial=mouth.material,material=sourceMaterial.clone(),gate={value:0};let disposed=false;
 const live=()=>{if(disposed)fail('DISPOSED','D2 style');};
 material.onBeforeCompile=shader=>{
  live();
  const vertex=replaceOnce(replaceOnce(shader.vertexShader,'#include <common>','#include <common>\nattribute float '+ATTRIBUTE+';\nvarying float vBubuD2CavityMask;'),'#include <begin_vertex>','#include <begin_vertex>\nvBubuD2CavityMask = '+ATTRIBUTE+';');
  const fragment=replaceOnce(replaceOnce(shader.fragmentShader,'#include <common>','#include <common>\nvarying float vBubuD2CavityMask;\nuniform float '+UNIFORM+';'),'#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb += vec3('+delta.join(',')+') * '+UNIFORM+' * vBubuD2CavityMask;');
  shader.vertexShader=vertex;shader.fragmentShader=fragment;shader.uniforms[UNIFORM]=gate;
 };
 material.customProgramCacheKey=()=> 'bubu-d2-n3-cavity-v1-three-0.186.1';
 mouth.material=material;
 return {
  apply(id,amount){live();const next=n3CavityGate(id,amount),changed=next!==gate.value;gate.value=next;return changed;},
  assertCurrent(id,amount){live();if(mouth.material!==material||gate.value!==n3CavityGate(id,amount))fail('STYLE_INVARIANT','Actor style writer changed');
   for(let i=0;i<704;i++)if(attribute.getX(i)!==N3_CAVITY_MASK[i])fail('STYLE_INVARIANT','Static cavity mask mutated');
   if(material.color.r!==sourceMaterial.color.r||material.color.g!==sourceMaterial.color.g||material.color.b!==sourceMaterial.color.b)fail('STYLE_INVARIANT','Source black material color changed');return true;},
  dispose(){if(disposed)return;disposed=true;gate.value=0;mouth.material=sourceMaterial;material.dispose();}
 };
}
