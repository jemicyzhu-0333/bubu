import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,MeshStandardMaterial,BufferGeometry,Float32BufferAttribute} from 'three';
import {bindSparseFaceRendering} from '../src/sparse-face-rendering.mjs';

function fixture(){
  const model=new Group(),source=new MeshStandardMaterial(),geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([0,0,0],3));
  geometry.morphAttributes.position=Array.from({length:144},()=>new Float32BufferAttribute([0,0,0],3));
  for(const name of ['a','b']){const mesh=new Mesh(geometry,source);mesh.name=name;model.add(mesh);}
  return {model,source,geometry,profile:{faceMeshes:['a','b']}};
}
const shader=()=>({vertexShader:'#include <common>\n#include <morphtarget_vertex>\n#include <morphnormal_vertex>',uniforms:{}});
test('per-face active indices preserve ascending sums and exact small nonzero weights',()=>{
  const f=fixture(),[a,b]=f.model.children,rendering=bindSparseFaceRendering(f.model,f.profile);
  a.morphTargetInfluences[130]=.75;a.morphTargetInfluences[129]=.25;
  b.morphTargetInfluences[0]=Number.MIN_VALUE;rendering.update();
  const sa=shader(),sb=shader();a.material.onBeforeCompile(sa);b.material.onBeforeCompile(sb);
  assert.deepEqual(sa.uniforms.bubuFaceIndices.value.toArray(),[129,130]);
  assert.deepEqual(sb.uniforms.bubuFaceIndices.value.toArray(),[0,1]);
  assert.equal(b.morphTargetInfluences[0],Number.MIN_VALUE);
  assert.equal(a.geometry,f.geometry);assert.notEqual(a.material,b.material);
  rendering.dispose();assert.equal(a.material,f.source);assert.equal(b.material,f.source);
});
test('extra or nonfinite knots are rejected without truncating canonical influences',()=>{
  const f=fixture(),a=f.model.children[0],rendering=bindSparseFaceRendering(f.model,f.profile);
  a.morphTargetInfluences.fill(0);a.morphTargetInfluences[2]=.2;a.morphTargetInfluences[6]=.3;a.morphTargetInfluences[8]=.5;
  assert.throws(()=>rendering.update(),/More than two/);assert.equal(a.morphTargetInfluences[8],.5);
  a.morphTargetInfluences.fill(0);a.morphTargetInfluences[5]=NaN;
  assert.throws(()=>rendering.update(),/Nonfinite/);rendering.dispose();
});
test('owns only material clones and rolls partial construction back',()=>{
  const f=fixture();let geometryDisposed=0,sourceDisposed=0,ownedDisposed=0;
  f.geometry.addEventListener('dispose',()=>geometryDisposed++);f.source.addEventListener('dispose',()=>sourceDisposed++);
  const rendering=bindSparseFaceRendering(f.model,f.profile);
  f.model.children.forEach(m=>m.material.addEventListener('dispose',()=>ownedDisposed++));
  rendering.dispose();rendering.dispose();
  assert.equal(ownedDisposed,2);assert.equal(sourceDisposed,0);assert.equal(geometryDisposed,0);
  assert.throws(()=>rendering.update(),/Face rendering/);
  assert.throws(()=>bindSparseFaceRendering(f.model,{faceMeshes:['a','missing']}),/Unsupported/);
  assert.equal(f.model.children[0].material,f.source);
});
test('composes prior material hooks and rejects shader drift',()=>{
  const f=fixture();f.source.onBeforeCompile=s=>{s.uniforms.existing={value:1};};
  const rendering=bindSparseFaceRendering(f.model,f.profile),s=shader();
  f.model.children[0].material.onBeforeCompile(s);assert.equal(s.uniforms.existing.value,1);
  assert.throws(()=>f.model.children[0].material.onBeforeCompile({vertexShader:'',uniforms:{}}),/shader chunk mismatch/);
  rendering.dispose();
});
