import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from '../../../bubu-asset-physics-revision-20261018/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../../bubu-asset-physics-revision-20261018/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { createBubuD2AnchorRegistry as createAnchorRegistry, createAnchorRegistry as createGenericAnchorRegistry, BUBU_D2_PROFILE } from '../index.mjs';
import { createMixedBindingAdapter } from '../../../bubu-recovery-20261017/delivery-package/runtime/mixed-binding-adapter.mjs';
import { fixture } from '../../../bubu-external-assets-staging-20261018/.cache/clean-a/research/animation-0.1.0/petting-continuous-r2/tools/fixture.mjs';
const base=new URL('../../../',import.meta.url),ref=new URL('bubu-external-assets-staging-20261018/.cache/clean-a/',base);
async function setup(){
 const f=await fixture(), bytes=fs.readFileSync(new URL('bubu-recovery-20261017/delivery-package/geometry/bubu-hybrid-binding.glb',base));
 const parts=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 const skin=f.h.body.skin,owner=createMixedBindingAdapter({THREE:T,sourceSkin:skin,parts,assertSourceCurrent:()=>f.h.owner.assertCurrent()});
 let revision=0;const registry=createAnchorRegistry({THREE:T,sourceSkin:skin,hybridRoot:owner.root,assertSourceCurrent:()=>f.h.owner.assertCurrent(),assertPoseCurrent:r=>assert.equal(r,revision)});
 return {f,skin,owner,registry,setRevision:r=>revision=r};
}
const a=await setup(),b=await setup(),report={tests:{},scenarios:{}};
const movedD2 = structuredClone(BUBU_D2_PROFILE);
movedD2.anchors[0].vertex++;
assert.throws(() => createGenericAnchorRegistry({
 THREE:T, sourceSkin:a.skin, hybridRoot:a.owner.root, profile:movedD2,
 assertSourceCurrent:()=>a.f.h.owner.assertCurrent(), assertPoseCurrent:()=>{}
}), /vertex mismatch/);
report.tests.movedD2VertexIndexRejected=true;
function pose(a,r,revision){a.f.h.body.root.position.fromArray(r.body.root);a.f.h.body.pivot.quaternion.fromArray(r.body.pivot);for(const[n,q]of Object.entries(r.body.jointQuaternions))a.f.h.body.bones[n].quaternion.fromArray(q);a.f.h.body.root.updateMatrixWorld(true);a.owner.update();a.setRevision(revision);a.registry.sampleFinalPose(revision);}
const snapshots=new Map();a.owner.root.traverse(o=>{if(o.isMesh)snapshots.set(o.geometry,Array.from(o.geometry.attributes.position.array));});
let maxError=0;
for(const scenario of ['drag','longpress']){const rows=JSON.parse(fs.readFileSync(new URL(`pointer/${scenario}/trajectory.json`,ref)));for(let i=0;i<rows.length;i++){
 pose(a,rows[i],`${scenario}:${i}`);
 for(const d of a.registry.definitions){const mesh=a.owner.root.getObjectByName(d.part),actual=mesh.getVertexPosition(d.vertex,new T.Vector3()).applyMatrix4(mesh.matrixWorld),matrix=a.registry.getTransform(d.id),pos=new T.Vector3().setFromMatrixPosition(matrix);maxError=Math.max(maxError,actual.distanceTo(pos));assert(actual.distanceTo(pos)<1e-7);assert(matrix.elements.every(Number.isFinite));assert(Math.abs(matrix.determinant()-1)<1e-6);}
}report.scenarios[scenario]={frames:rows.length};}
report.tests.realSurfacePositionMaxError=maxError;
assert(a.skin.skeleton.boneInverses.some(m=>!m.equals(new T.Matrix4())));report.tests.nonidentityInverseBind=true;
b.registry.sampleFinalPose(0);const bm=b.registry.getTransform('crown');a.f.h.body.root.position.x+=.2;a.f.h.body.root.updateMatrixWorld(true);a.owner.update();assert.throws(()=>a.registry.getTransform('crown'),/changed since/);assert.deepEqual(b.registry.getTransform('crown').elements,bm.elements);report.tests.actorIsolationAndPoseFreshness=true;
a.registry.sampleFinalPose('longpress:1890');const one=a.registry.getTransform('crown');one.elements.fill(NaN);assert(a.registry.getTransform('crown').elements.every(Number.isFinite));assert.throws(()=>a.registry.getTransform('missing'));assert.throws(()=>a.registry.getTransform('crown',{offset:[0,0,99]}));report.tests.copyIsolationMissingAndBounds=true;
for(const[g,values]of snapshots)assert.deepEqual(Array.from(g.attributes.position.array),values);report.tests.noGeometryMutation=true;
// Actual rigid tea trajectory uses the approved controller and hand override matrices.
const teaBase=new URL('research/animation-0.1.0/original-parts-hybrid-v1/tea/',ref);
const {createRigidTeaController}=await import(new URL('src/rigid-tea.mjs',teaBase));const read=n=>JSON.parse(fs.readFileSync(new URL('inputs/'+n+'.json',teaBase)));const tea=createRigidTeaController({config:read('rigid-config'),hold:read('hold-fit'),sip:read('sip-fit')});
let teaError=0;for(let i=0;i<=270;i++){const s=tea.sample(i/30);a.owner.update({limbMatrices:{'Bubu_hand-left':s.matrices.handL,'Bubu_hand-right':s.matrices.handR}});a.setRevision('tea:'+i);a.registry.sampleFinalPose('tea:'+i);for(const id of ['palm.gripL','palm.gripR']){const d=a.registry.definitions.find(d=>d.id===id),m=a.owner.root.getObjectByName(d.part),p=m.getVertexPosition(d.vertex,new T.Vector3()).applyMatrix4(m.matrixWorld),q=new T.Vector3().setFromMatrixPosition(a.registry.getTransform(id));teaError=Math.max(teaError,p.distanceTo(q));}}assert(teaError<1e-7);report.scenarios.tea={frames:271,maxPalmError:teaError};
// Reflected and nonuniform parents still produce finite, orthonormal world support frames.
for(const scale of [[1.7,.6,1.2],[-1.7,.6,1.2]]) {
 a.f.h.body.root.scale.fromArray(scale);a.f.h.body.root.updateMatrixWorld(true);a.owner.update();a.setRevision('affine');a.registry.sampleFinalPose('affine');
 for(const d of a.registry.definitions){const m=a.registry.getTransform(d.id),x=new T.Vector3().setFromMatrixColumn(m,0),y=new T.Vector3().setFromMatrixColumn(m,1),z=new T.Vector3().setFromMatrixColumn(m,2);assert(Math.abs(m.determinant()-1)<1e-6);assert(Math.abs(x.dot(y))+Math.abs(y.dot(z))+Math.abs(z.dot(x))<1e-6);}
}
report.tests.reflectedNonuniformFrames=true;
a.f.h.body.root.scale.set(1,1,1);a.f.h.body.root.updateMatrixWorld(true);a.owner.update();a.registry.sampleFinalPose('affine');
const target=new T.Matrix4();assert.equal(a.registry.getTransform('crown',{target}),target);report.tests.callerOwnedTarget=true;
const started=performance.now();for(let i=0;i<500;i++){a.registry.sampleFinalPose('affine');for(const id of a.registry.ids)a.registry.getTransform(id,{target});}report.profile={scope:'CPU Node only, 500 iterations of sampling 25 anchors and reading all 25 into one caller target',milliseconds:performance.now()-started};
a.registry.dispose();assert.throws(()=>a.registry.getTransform('crown'));report.tests.disposedFailsClosed=true;
for(const actor of[a,b]){actor.registry.dispose();actor.owner.dispose();actor.f.h.dispose();}
fs.writeFileSync(new URL('../review/validation.json',import.meta.url),JSON.stringify(report,null,2));console.log(report);
