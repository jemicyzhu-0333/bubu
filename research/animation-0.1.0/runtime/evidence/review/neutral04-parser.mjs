import fs from 'node:fs';import assert from 'node:assert/strict';
import {preflightArtGLB,ART_LIMITS} from '../../src/art-glb-preflight.mjs';
const raw=fs.readFileSync(new URL('../../fixtures/neutral-r6/asset.glb',import.meta.url));const jl=raw.readUInt32LE(12);const source=JSON.parse(raw.subarray(20,20+jl)),bin=raw.subarray(28+jl);
function encode(d,b=bin){let j=Buffer.from(JSON.stringify(d));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const out=Buffer.alloc(28+j.length+b.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(j.length,12);out.writeUInt32LE(0x4e4f534a,16);j.copy(out,20);out.writeUInt32LE(b.length,20+j.length);out.writeUInt32LE(0x004e4942,24+j.length);b.copy(out,28+j.length);return out;}
const results=[];function test(name,mutate,budget,accept=false){const d=structuredClone(source),b=Buffer.concat([bin,Buffer.alloc(32)]);d.buffers[0].byteLength=b.length;mutate?.(d,b);try{preflightArtGLB(encode(d,b),budget??ART_LIMITS);assert(accept,'unexpected acceptance');results.push({name,result:'accepted as expected'})}catch(e){if(accept||e.code==='ERR_ASSERTION')throw e;results.push({name,result:'rejected',code:e.code,message:e.message});}}
preflightArtGLB(raw);results.push({name:'exact real r6',result:'accepted as expected'});test('r6 extra unreferenced bytes',null,null,true);
test('unknown extension',d=>d.extensionsUsed.push('KHR_evil'));
test('unknown specular field',d=>{d.materials.find(m=>m.extensions?.KHR_materials_specular).extensions.KHR_materials_specular.unknown=1});
test('active mesh weights',d=>{let m=d.meshes.find(m=>m.weights?.length);m.weights[0]=1});
test('duplicate scene roots',d=>d.scenes[0].nodes.push(d.scenes[0].nodes[0]));
test('small scalar budget',null,{accessorScalars:100});
test('small decoded budget',null,{decodedAccessorBytes:100});
// Append a standalone sparse accessor; no source geometry or approved source file is changed.
function sparse(d,b){const a={componentType:5126,count:3,type:'VEC3',sparse:{count:2,indices:{bufferView:d.bufferViews.length,componentType:5121},values:{bufferView:d.bufferViews.length+1}}};d.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:2},{buffer:0,byteOffset:bin.length+4,byteLength:24});b[bin.length]=0;b[bin.length+1]=2;d.accessors.push(a);return a;}
// Sparse payload has its own appended storage, independent of real geometry.
for(const [name,mutate] of [['duplicate',(a,b)=>b[bin.length+1]=0],['descending',(a,b)=>{b[bin.length]=2;b[bin.length+1]=1}],['outside',(a,b)=>b[bin.length+1]=3],['signed index',a=>a.sparse.indices.componentType=5122],['base offset',a=>a.byteOffset=4],['too many',a=>a.sparse.count=4],['nonfinite',(a,b)=>b.writeFloatLE(Infinity,bin.length+4)],['unaligned',a=>a.sparse.values.byteOffset=1]])test('sparse '+name,(d,b)=>mutate(sparse(d,b),b));
console.log(JSON.stringify({cases:results.length,results},null,2));
