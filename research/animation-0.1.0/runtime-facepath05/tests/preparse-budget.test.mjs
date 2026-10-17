import test from 'node:test';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {decodedArrayPlan,geometryBackingBytes} from '../src/geometry-accounting.mjs';
import {preflightGLB} from '../src/glb-preflight.mjs';
import {preflightArtGLB} from '../src/art-glb-preflight.mjs';
import {preparePack,preparedAdmission,sha256} from '../src/pack-loader.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {read} from './helpers.mjs';
const encode=o=>new TextEncoder().encode(JSON.stringify(o));
function unpack(bytes) {
  const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true);
  return {doc:JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+n))),bin:bytes.slice(28+n)};
}
function glb(doc,bin) {
  const raw=encode(doc),json=new Uint8Array(Math.ceil(raw.length/4)*4).fill(32);json.set(raw);
  const bytes=new Uint8Array(28+json.length+bin.length),v=new DataView(bytes.buffer);
  [0x46546c67,2,bytes.length,json.length,0x4e4f534a].forEach((x,i)=>v.setUint32(i*4,x,true));
  bytes.set(json,20);v.setUint32(20+json.length,bin.length,true);v.setUint32(24+json.length,0x004e4942,true);bytes.set(bin,28+json.length);return bytes;
}
async function overlap() {
  const {doc,bin:old}=unpack(await read('mechanical-character.glb',8388608));
  // Deliberately small: 16 KiB BIN, fewer than 256 KiB decoded views.
  const bin=new Uint8Array(16384);bin.set(old);const views=doc.bufferViews;
  doc.bufferViews=doc.accessors.map((a,i)=>{
    const v=views[a.bufferView];a.byteOffset=(v.byteOffset??0)+(a.byteOffset??0);a.bufferView=i;
    return {buffer:0,byteOffset:0,byteLength:bin.length,...(v.byteStride?{byteStride:v.byteStride}:{})};
  });
  doc.buffers[0].byteLength=bin.length;
  return {doc,bin,bytes:glb(doc,bin)};
}
async function prepared(bytes) {
  const m=JSON.parse(new TextDecoder().decode(await read('manifest.json',65536))),a=m.assets.find(x=>x.id==='body');
  a.bytes=bytes.length;a.sha256=await sha256(bytes);m.budgets.totalBytes=m.assets.reduce((n,a)=>n+a.bytes,0);
  return preparePack((name,max,signal)=>name==='manifest.json'?encode(m):name===a.path?bytes:read(name,max,signal));
}
function zero(pool) {
  for(const key of ['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','pending','active'])assert.equal(pool.stats[key],0,key);
  assert.equal(pool.stats.cache.live,0);assert.equal(pool.stats.cache.retainedReferences,0);
}
async function inspect(bytes,doc) {
  const loader=new GLTFLoader(),buffers=new Set();let loads=0;
  loader.register(parser=>{
    const view=parser.loadBufferView.bind(parser),accessor=parser.loadAccessor.bind(parser);
    parser.loadBufferView=async i=>{loads++;const b=await view(i);buffers.add(b);return b;};
    parser.loadAccessor=async i=>{const a=await accessor(i);buffers.add((a.isInterleavedBufferAttribute?a.data.array:a.array).buffer);return a;};
    return {name:'budget-test-observer'};
  });
  const result=await loader.parseAsync(bytes.buffer,'');
  const plan=decodedArrayPlan(bytes.length,doc);
  assert.equal(loads,plan.loadedBufferViews);
  assert.equal([...buffers].reduce((n,b)=>n+b.byteLength,0),plan.viewBytes+plan.denseBytes);
  assert(geometryBackingBytes(result.scene)<=plan.viewBytes+plan.denseBytes);
  result.scene.traverse(o=>{o.geometry?.dispose();o.skeleton?.dispose();o.material?.dispose();});
  return plan;
}
test('overlapping views reserve distinct complete slices; reject before GLTFLoader and roll back',async()=>{
  const {bytes,doc}=await overlap();preflightGLB(bytes);
  const pack=await prepared(bytes),cost=preparedAdmission(pack).sources.reduce((n,s)=>n+s.decodedBytes,0);
  const plan=decodedArrayPlan(bytes.length,doc);assert.equal(plan.viewBytes,15*16384);
  const pool=new ActorPool({limits:{decodedArrayBytes:cost-1}}),native=GLTFLoader.prototype.parseAsync;let calls=0;
  GLTFLoader.prototype.parseAsync=function(...args){calls++;return native.apply(this,args);};
  try {await assert.rejects(pool.create(pack),{code:'GLOBAL_BUDGET'});assert.equal(calls,0);assert.equal(pool.stats.cache.loads,0);zero(pool);}
  finally {GLTFLoader.prototype.parseAsync=native;pool.dispose();}
});
test('legal small overlap remains loadable at exact budget; shared actors charge once and release',async()=>{
  const {bytes,doc}=await overlap();await inspect(bytes,doc);
  const pack=await prepared(bytes),cost=preparedAdmission(pack).sources.reduce((n,s)=>n+s.decodedBytes,0),pool=new ActorPool({limits:{decodedArrayBytes:cost}});
  const [a,b]=await Promise.all([pool.create(pack),pool.create(pack)]);
  assert.equal(pool.stats.decodedArrayBytes,cost);assert.equal(pool.stats.cache.loads,2);
  a.dispose();assert.equal(pool.stats.decodedArrayBytes,cost);b.dispose();zero(pool);pool.dispose();
});
test('unused views and unused accessors do not reserve copies; repeated nodes share source arrays',async()=>{
  const {doc,bin}=unpack(await read('mechanical-character.glb',8388608));
  const before=decodedArrayPlan(0,doc);
  const view=doc.bufferViews.push({buffer:0,byteOffset:0,byteLength:bin.length})-1;
  doc.accessors.push({bufferView:view,componentType:5126,type:'SCALAR',count:1});
  doc.nodes.push({name:'RepeatedMeshBudgetTest',mesh:0});doc.scenes[0].nodes.push(doc.nodes.length-1);
  const bytes=glb(doc,bin);preflightGLB(bytes);
  const after=await inspect(bytes,doc);
  assert.equal(after.viewBytes,before.viewBytes);assert.equal(after.denseBytes,before.denseBytes);
});
function tiny({componentType=5123,sparse=false,base=true,interleaved=false}={}) {
  const bin=new Uint8Array(256),v=new DataView(bin.buffer);
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Root',mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:256}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:128,...(interleaved?{byteStride:16}:{})},{buffer:0,byteOffset:128,byteLength:32}],
    accessors:[{componentType:5126,count:3,type:'VEC3',...(base?{bufferView:0}:{}),min:[0,0,0],max:[0,0,0]},
      {bufferView:1,componentType,count:3,type:'SCALAR'}]};
  const size={5121:1,5123:2,5125:4}[componentType];
  for(let i=0;i<3;i++)if(size===1)v.setUint8(128+i,i);else if(size===2)v.setUint16(128+i*2,i,true);else v.setUint32(128+i*4,i,true);
  if(sparse) {
    doc.bufferViews.push({buffer:0,byteOffset:160,byteLength:16},{buffer:0,byteOffset:176,byteLength:64});
    doc.accessors[0].sparse={count:1,indices:{bufferView:2,componentType},values:{bufferView:3}};
  }
  return {doc,bin};
}
for(const componentType of [5121,5123,5125])for(const base of [false,true])test(`sparse ${componentType} ${base?'copied':'zero'} dense base accounting`,async()=>{
  const {doc,bin}=tiny({componentType,sparse:true,base}),bytes=glb(doc,bin);preflightArtGLB(bytes);
  const plan=await inspect(bytes,doc);assert.equal(plan.denseBytes,36);assert.equal(plan.viewBytes,base?240:112);
});
test('typed arrays and interleaved accessors sharing a view do not double charge it',async()=>{
  const {doc,bin}=tiny({interleaved:true});
  doc.accessors.push({...doc.accessors[0]});doc.meshes[0].primitives[0].attributes.NORMAL=2;
  const bytes=glb(doc,bin);preflightGLB(bytes);const plan=await inspect(bytes,doc);
  assert.equal(plan.viewBytes,160);assert.equal(plan.denseBytes,0);
});
test('loader-incompatible final stride and sparse interleaved bases reject in preflight',()=>{
  const {doc,bin}=tiny({interleaved:true});doc.bufferViews[0].byteLength=44;
  for(const check of [preflightGLB,preflightArtGLB])assert.throws(()=>check(glb(doc,bin)),/Loader interleaved backing range/);
  const sparse=tiny({interleaved:true,sparse:true});assert.throws(()=>preflightArtGLB(glb(sparse.doc,sparse.bin)),/Loader sparse matrix\/interleaved/);
});
test('zero-base dense accessor allocates exactly its dense bytes',async()=>{
  const {doc,bin}=tiny({base:false}),bytes=glb(doc,bin);preflightArtGLB(bytes);
  const plan=await inspect(bytes,doc);assert.equal(plan.denseBytes,36);assert.equal(plan.viewBytes,32);
});
