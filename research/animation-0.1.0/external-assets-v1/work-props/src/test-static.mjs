import {candidatePaths} from '../../shared/work-garden-paths.mjs';
const portable=candidatePaths('work-props');
import * as T from 'three';import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
const read=p=>JSON.parse(fs.readFileSync(new URL(p.replace(/^\.\.\//,''),portable.root)));
const base=JSON.parse(fs.readFileSync(portable.baseline)).frames[0].meshes;
const raw=read('../reports/source-hands.json'),placements=read('../reports/static-placements.json');
const audit=read('../reports/static-geometry-audit.json');
for(const id of ['keyboard','laptop','microphone','drum'])test(id+': original body and face untouched; hands rigid; prop clear of body/face',()=>{
 const frame=read('../review/'+id+'-static.json').frames[0];
 for(const source of base.filter(m=>m.name.startsWith('Bubu_')||m.name.startsWith('A_'))){
  const actual=frame.meshes.find(m=>m.name===source.name);assert.ok(actual);assert.deepEqual(actual.indices,source.indices);
  if(source.name.startsWith('Bubu_hand')){
 const transform=placements.find(x=>x.id===id).handTransforms.find(x=>x.mesh===source.name);
 if(!transform){assert.deepEqual(actual,source);continue;}
 const original=raw.find(x=>x.name===source.name),q=new T.Quaternion().setFromEuler(new T.Euler(...transform.rotation)),delta=new T.Vector3(...transform.translation);
 assert.deepEqual(actual.indices,original.indices);assert.deepEqual(transform.scale,[1,1,1]);if(transform.matrix3){const mat=new T.Matrix3().set(...transform.matrix3.flat());assert.ok(Math.abs(mat.determinant()-1)<1e-10);const identity=mat.clone().transpose().multiply(mat);identity.elements.forEach((x,i)=>assert.ok(Math.abs(x-([0,4,8].includes(i)?1:0))<1e-10));}
 for(let i=0;i<original.positions.length;i+=3){const v=new T.Vector3(...original.positions.slice(i,i+3));if(transform.matrix3){const a=transform.matrix3;v.applyMatrix3(new T.Matrix3().set(...a.flat()));}else v.applyQuaternion(q);v.add(delta);for(let a=0;a<3;a++)assert.ok(Math.abs(v.toArray()[a]-actual.positions[i+a])<1e-7);}
 }
  else assert.deepEqual(actual,source);
 }
 const a=audit.find(x=>x.id===id);for(const n of Object.values(a.propBodyBoundaryTriangleIntersections))assert.equal(n,0);for(const n of Object.values(a.propFaceBoundaryTriangleIntersections))assert.equal(n,0);
 const required=id==='microphone'?['Bubu_hand-left']:['Bubu_hand-left','Bubu_hand-right'];
 for(const name of required){assert.ok(a.hands[name].minimumPropSurfaceDistance<.01);assert.ok(a.hands[name].bodyBoundaryTriangleIntersections>0);assert.ok(a.hands[name].rootSignedBodySurfaceDistance<=0);}
});

test('full original cap and incident boundary rings are buried',()=>{for(const h of read('../reports/hand-boundary-audit.json')){assert.ok(h.boundaryVertexCount>180);assert.equal(h.outsideBoundaryCount,0);}});
