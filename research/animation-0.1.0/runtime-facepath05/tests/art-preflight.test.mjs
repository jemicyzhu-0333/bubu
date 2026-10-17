import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ART_LIMITS, preflightArtGLB, decodeArtAccessor } from '../src/art-glb-preflight.mjs';
import { LIMITS } from '../src/contracts.mjs';

const size={5121:1,5123:2,5125:4,5126:4};
const type={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
function builder() {
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Root',mesh:0}],
    meshes:[{primitives:[{attributes:{},indices:0,material:0}]}],
    materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,.5,.3,1],metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
  const chunks=[];
  let length=0;
  const view=(values,componentType,fields={})=> {
    while(length%4){chunks.push(Uint8Array.of(0));length++;}
    const raw=new type[componentType](values);
    const bytes=new Uint8Array(raw.buffer);
    const index=doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,...fields})-1;
    chunks.push(bytes);length+=bytes.length;return index;
  };
  const accessor=(values,componentType,kind,fields={},viewFields={})=>doc.accessors.push({bufferView:view(values,componentType,viewFields),componentType,type:kind,count:values.length/({SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[kind]),...fields})-1;
  const primitive=doc.meshes[0].primitives[0];
  primitive.attributes.POSITION=accessor([0,0,0,1,0,0,0,1,0],5126,'VEC3',{}, {target:34962});
  primitive.attributes.NORMAL=accessor([0,0,1,0,0,1,0,0,1],5126,'VEC3',{}, {target:34962});
  primitive.attributes.COLOR_0=accessor([1,0,0,1,0,1,0,1,0,0,1,1],5126,'VEC4',{}, {target:34962});
  primitive.indices=accessor([0,1,2],5123,'SCALAR',{}, {target:34963});
  return {doc,primitive,view,accessor,finish() {
    doc.buffers[0].byteLength=length;
    const bin=new Uint8Array(Math.ceil(length/4)*4);let offset=0;
    for(const c of chunks){bin.set(c,offset);offset+=c.length;}
    return {doc,bin};
  }};
}
function encode({doc,bin}) {
  const raw=new TextEncoder().encode(JSON.stringify(doc)),json=new Uint8Array(Math.ceil(raw.length/4)*4).fill(32);json.set(raw);
  const bytes=new Uint8Array(28+json.length+bin.length),v=new DataView(bytes.buffer);
  [0x46546c67,2,bytes.length,json.length,0x4e4f534a].forEach((x,i)=>v.setUint32(i*4,x,true));
  bytes.set(json,20);v.setUint32(20+json.length,bin.length,true);v.setUint32(24+json.length,0x004e4942,true);bytes.set(bin,28+json.length);return bytes;
}
function fixture(mutate=()=>{}) {const b=builder();mutate(b);return b.finish();}
function check(f,budget) {return preflightArtGLB(encode(f),budget);}
function write(f,viewIndex,element,componentType,value) {
  const v=new DataView(f.bin.buffer),offset=f.doc.bufferViews[viewIndex].byteOffset+element*size[componentType];
  if(componentType===5126)v.setFloat32(offset,value,true);
  else if(componentType===5125)v.setUint32(offset,value,true);
  else if(componentType===5123)v.setUint16(offset,value,true);
  else v.setUint8(offset,value);
}
function sparseFixture({indexType=5121,base=false,indices=[0,2],values=[1,2,3,7,8,9]}={}) {
  let index;
  const f=fixture(b=> {
    const a={componentType:5126,type:'VEC3',count:3};
    if(base)a.bufferView=b.view([10,11,12,13,14,15,16,17,18],5126);
    a.sparse={count:indices.length,indices:{bufferView:b.view(indices,indexType),componentType:indexType},values:{bufferView:b.view(values,5126)}};
    index=b.doc.accessors.push(a)-1;
    b.primitive.targets=[{POSITION:index}];
    b.doc.meshes[0].weights=[0];b.doc.meshes[0].extras={targetNames:['FaceNeutralDelta']};
  });
  return {...f,index};
}
function skinFixture() {
  return fixture(b=> {
    b.doc.nodes[0].children=[1];b.doc.nodes.push({name:'Joint'});b.doc.nodes[0].skin=0;
    b.primitive.attributes.JOINTS_0=b.accessor(Array(12).fill(0),5121,'VEC4');
    b.primitive.attributes.WEIGHTS_0=b.accessor([1,0,0,0,1,0,0,0,1,0,0,0],5126,'VEC4');
    b.doc.skins=[{joints:[1],inverseBindMatrices:b.accessor([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],5126,'MAT4')}];
  });
}

test('art ceilings are frozen and independent from mechanics limits',()=> {
  assert.ok(Object.isFrozen(ART_LIMITS));assert.equal(ART_LIMITS.assetBytes,12*1024*1024);
  assert.equal(ART_LIMITS.accessorScalars,4000000);assert.equal(ART_LIMITS.morphTargets,64);
  assert.equal(LIMITS.accessorScalars,2000000);assert.equal(LIMITS.morphTargets,16);
});
test('self-contained untextured colored triangle reports exact decode costs',()=> {
  const f=fixture(),bytes=encode(f),a=preflightArtGLB(bytes);
  assert.equal(a.vertices,3);assert.equal(a.nodes,1);assert.equal(a.deformedVertices,3);
  assert.equal(a.renderVertices,3);assert.equal(a.renderDeformedVertices,3);assert.equal(a.indices,3);
  assert.equal(a.accessorScalars,33);assert.equal(a.decodedAccessorBytes,126);assert.equal(a.accessorWorkScalars,33);
  assert.equal(a.textureBytes,0);assert.deepEqual(a.document,f.doc);
  const source=decodeArtAccessor(bytes,a.document,0);assert.ok(source instanceof Float32Array);
  assert.deepEqual([...source],[0,0,0,1,0,0,0,1,0]);source[0]=100;
  assert.equal(decodeArtAccessor(bytes,a.document,0)[0],0);
  assert.ok(decodeArtAccessor(bytes,a.document,3) instanceof Uint16Array);
  assert.throws(()=>decodeArtAccessor(bytes.slice(),a.document,0));
  assert.throws(()=>decodeArtAccessor(bytes,structuredClone(a.document),0));
  assert.throws(()=>decodeArtAccessor(bytes,a.document,10));
});
for(const indexType of [5121,5123,5125])for(const base of [false,true])test(`sparse ${indexType} ${base?'overlay':'zero base'} decodes correctly`,()=> {
  const f=sparseFixture({indexType,base}),bytes=encode(f),a=preflightArtGLB(bytes);
  assert.deepEqual([...decodeArtAccessor(bytes,a.document,f.index)],base?[1,2,3,13,14,15,7,8,9]:[1,2,3,0,0,0,7,8,9]);
  assert.equal(a.accessorScalars,42);assert.equal(a.decodedAccessorBytes,162);
  assert.equal(a.sparseScalars,6);assert.equal(a.sparseIndices,2);assert.equal(a.accessorWorkScalars,50);
  assert.equal(a.deformedVertices,6);assert.deepEqual(a.document.meshes[0].weights,[0]);
});
test('dense strided accessor preserves float32 source values and does not read padding',()=> {
  const f=fixture(b=> {
    b.primitive.attributes.POSITION=b.accessor([.1,.2,.3,NaN,.4,.5,.6,NaN,.7,.8,.9,NaN],5126,'VEC3',{count:3},{byteStride:16});
  });
  const bytes=encode(f),a=preflightArtGLB(bytes),values=decodeArtAccessor(bytes,a.document,a.document.meshes[0].primitives[0].attributes.POSITION);
  assert.deepEqual(values,new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8,.9]));
});
test('an accessor without a buffer view or sparse values has a zero base',()=> {
  const f=fixture(b=>b.doc.accessors.push({componentType:5126,type:'VEC3',count:3})),bytes=encode(f),a=preflightArtGLB(bytes);
  assert.deepEqual([...decodeArtAccessor(bytes,a.document,4)],Array(9).fill(0));
});
for(const indices of [[0,0],[2,1],[0,3]])test('invalid sparse ordering/range '+indices.join(','),()=>assert.throws(()=>check(sparseFixture({indices})),/Sparse indices/));
test('sparse indices and values require safe counts/ranges/alignment, unsigned types and no strides',()=> {
  const edits=[
    a=>a.count=0,a=>a.count=4,a=>a.count=1.5,a=>a.count=Number.MAX_SAFE_INTEGER,
    a=>a.indices.componentType=5126,a=>a.indices.componentType=5122,
    a=>a.indices.byteOffset=-1,a=>a.indices.byteOffset=Number.MAX_SAFE_INTEGER,
    a=>a.values.byteOffset=2,a=>a.values.byteOffset=4,a=>a.values.bufferView=99,
    a=>a.indices.extra=true,a=>a.values.extensions={},a=>a.extra=true
  ];
  for(const edit of edits){const f=sparseFixture();edit(f.doc.accessors[f.index].sparse);assert.throws(()=>check(f));}
  for(const kind of ['indices','values'])for(const key of ['byteStride','target']) {
    const f=sparseFixture();f.doc.bufferViews[f.doc.accessors[f.index].sparse[kind].bufferView][key]=key==='byteStride'?4:34962;assert.throws(()=>check(f),/Sparse bufferView/);
  }
  for(const type of [5123,5125]){const f=sparseFixture({indexType:type});f.doc.accessors[f.index].sparse.indices.byteOffset=1;assert.throws(()=>check(f));}
});
test('zero-base sparse byteOffset must be exactly zero',()=> {
  for(const offset of [1,-1,.5,'0',null]){const f=sparseFixture();f.doc.accessors[f.index].byteOffset=offset;assert.throws(()=>check(f));}
  const f=sparseFixture();f.doc.accessors[f.index].byteOffset=0;assert.doesNotThrow(()=>check(f));
});
test('nonfinite base values reject even when overlaid; nonfinite sparse values reject',()=> {
  for(const value of [NaN,Infinity,-Infinity]) {
    const f=sparseFixture({base:true});write(f,f.doc.accessors[f.index].bufferView,0,5126,value);assert.throws(()=>check(f),/Nonfinite base/);
    const s=sparseFixture();write(s,s.doc.accessors[s.index].sparse.values.bufferView,0,5126,value);assert.throws(()=>check(s),/Nonfinite sparse/);
  }
});
test('global dense scalar and byte budgets are checked before any source reads',()=> {
  const f=fixture();write(f,0,0,5126,NaN);
  f.doc.accessors.push(...Array.from({length:2},()=>({componentType:5126,type:'MAT4',count:200000})));
  assert.throws(()=>check(f),e=>e.code==='LIMIT'&&/allocation/.test(e.message));
  const g=fixture();write(g,0,0,5126,NaN);assert.throws(()=>check(g,{decodedAccessorBytes:125}),e=>e.code==='LIMIT');
  assert.throws(()=>check(sparseFixture(),{accessorWorkScalars:49}),e=>e.code==='LIMIT');
});
test('accessor and view counts plus all caller-lowered budgets are enforced',()=> {
  const f=fixture();f.doc.accessors=Array(769).fill(f.doc.accessors[0]);assert.throws(()=>check(f),e=>e.code==='LIMIT');
  const g=fixture();g.doc.bufferViews=Array(769).fill(g.doc.bufferViews[0]);assert.throws(()=>check(g),e=>e.code==='LIMIT');
  for(const budget of [{vertices:2},{nodes:0},{indices:2},{meshes:0},{materials:0},{primitives:0},{jsonBytes:1},{assetBytes:1},{accessors:3},{bufferViews:3},{accessorScalars:32},{deformedVertices:2}])assert.throws(()=>check(fixture(),budget));
  for(const value of [NaN,Infinity,-1,1.5,null])assert.throws(()=>check(fixture(),{vertices:value}));
  const f2=fixture();f2.doc.nodes=Array.from({length:33},(_,i)=>({name:'Node'+i}));assert.throws(()=>check(f2,{nodes:9999}),e=>e.code==='LIMIT');
});
test('COLOR_0 is actual float VEC3/4 data bounded to 0..1',()=> {
  const f=fixture(b=>b.primitive.attributes.COLOR_0=b.accessor([1,0,0,0,1,0,0,0,1],5126,'VEC3'));assert.doesNotThrow(()=>check(f));
  for(const value of [-.001,1.001,NaN,Infinity]){const f=fixture();write(f,2,0,5126,value);assert.throws(()=>check(f));}
  for(const edit of [a=>a.componentType=5123,a=>a.type='SCALAR',a=>a.normalized=true]){const f=fixture();edit(f.doc.accessors[2]);assert.throws(()=>check(f));}
  const s=sparseFixture({values:[2,0,0,0,0,1]});s.doc.meshes[0].primitives[0].attributes.COLOR_0=s.index;assert.throws(()=>check(s),/Vertex colors/);
});
test('only numeric untextured specular and ior extension fields pass with consistent declarations',()=> {
  const f=fixture();f.doc.extensionsUsed=['KHR_materials_specular','KHR_materials_ior'];f.doc.extensionsRequired=['KHR_materials_specular'];
  f.doc.materials[0].extensions={KHR_materials_specular:{specularFactor:.3,specularColorFactor:[.5,.6,.7]},KHR_materials_ior:{ior:1.2}};
  assert.doesNotThrow(()=>check(f));
  for(const edit of [
    d=>d.extensionsUsed.push('KHR_lights_punctual'),d=>d.extensionsUsed.push('KHR_materials_ior'),
    d=>d.extensionsRequired=['KHR_texture_transform'],d=>d.extensionsUsed=['KHR_materials_specular'],
    d=>delete d.extensionsUsed,d=>d.materials[0].extensions.KHR_materials_ior.ior=.5,
    d=>d.materials[0].extensions.KHR_materials_specular.specularFactor=2,
    d=>d.materials[0].extensions.KHR_materials_specular.specularTexture={index:0},
    d=>d.materials[0].extensions.KHR_materials_specular.specularColorTexture={index:0},
    d=>d.materials[0].extensions.KHR_materials_specular.extras={},
    d=>d.materials[0].extensions.KHR_materials_ior.unknown=0,
    d=>d.materials[0].extensions.KHR_materials_specular.specularColorFactor=[1,2],
    d=>d.materials[0].pbrMetallicRoughness.baseColorTexture={index:0},
    d=>d.materials[0].doubleSided='true'
  ]){const copy=structuredClone(f);edit(copy.doc);assert.throws(()=>check(copy));}
  const unused=fixture();unused.doc.extensionsUsed=['KHR_materials_ior'];assert.throws(()=>check(unused),/Unused/);
});
test('unknown fields, external resources, animations, scripts and arbitrary extras reject',()=> {
  for(const edit of [
    d=>d.buffers[0].uri='https://example.test/a.bin',d=>d.images=[],d=>d.textures=[],d=>d.animations=[],d=>d.scripts=[],d=>d.extras={},
    d=>d.asset.extras={},d=>d.nodes[0].extras={surface_normal_blender:[0,1,0]},d=>d.meshes[0].extras={arbitrary:1},
    d=>d.meshes[0].primitives[0].attributes.TEXCOORD_0=0,d=>d.meshes[0].primitives[0].attributes.TANGENT=0,
    d=>d.nodes[0].extensions={KHR_materials_ior:{}},d=>d.scenes[0].extras={},d=>d.accessors[0].extensions={},
    d=>d.bufferViews[0].extras={},d=>d.materials[0].emissiveTexture={index:0},d=>d.nodes[0].matrix=Array(16).fill(0),
    d=>d.nodes[0].children=null,d=>d.meshes[0].primitives[0].mode=null
  ]){const f=fixture();edit(f.doc);assert.throws(()=>check(f));}
});
test('only named HeadTouch near-unit source normal metadata is allowed and stays unmodified',()=> {
  const f=fixture();f.doc.nodes.push({name:'HeadTouch',extras:{surface_normal_blender:[0,.6,.8]}});f.doc.nodes[0].children=[1];
  assert.deepEqual(check(f).document.nodes[1].extras,{surface_normal_blender:[0,.6,.8]});
  for(const normal of [[0,0,0],[0,1,1],[0,1],['0',0,1],[0,0,null]]){const c=structuredClone(f);c.doc.nodes[1].extras.surface_normal_blender=normal;assert.throws(()=>check(c));}
  const c=structuredClone(f);c.doc.nodes[1].extras.script='no';assert.throws(()=>check(c));
});
test('POSITION and NORMAL morphs are typed and default node/mesh weights are all zero',()=> {
  const f=sparseFixture();f.doc.meshes[0].primitives[0].targets[0].NORMAL=f.index;assert.doesNotThrow(()=>check(f));
  f.doc.nodes[0].weights=[0];assert.doesNotThrow(()=>check(f));
  for(const edit of [
    d=>d.meshes[0].weights=[.1],d=>d.nodes[0].weights=[-1],d=>d.meshes[0].weights=[],d=>d.nodes[0].weights=[0,0],
    d=>d.meshes[0].extras.targetNames=['A','B'],d=>d.meshes[0].extras.targetNames=[1],
    d=>d.meshes[0].primitives[0].targets[0].TANGENT=0,d=>d.meshes[0].primitives[0].targets=[{}],
    d=>delete d.meshes[0].primitives[0].attributes.NORMAL,
    d=>d.meshes[0].primitives[0].targets=Array(65).fill({POSITION:0}),
    d=>d.accessors.at(-1).type='VEC4'
  ]){const copy=structuredClone(f);edit(copy.doc);assert.throws(()=>check(copy));}
});
test('topology, scene hierarchy, unique names and instantiated geometry budgets remain strict',()=> {
  for(const edit of [
    d=>d.nodes.push({name:'Root'}),d=>d.nodes.push({name:'Unused'}),d=>d.nodes[0].children=[0],
    d=>{d.nodes.push({name:'Child'});d.nodes[0].children=[1,1];},d=>d.scenes[0].nodes=[0,0],
    d=>d.meshes[0].primitives[0].mode=1,d=>d.meshes[0].primitives.push(d.meshes[0].primitives[0]),
    d=>d.nodes[0].mesh=99,d=>d.nodes[0].rotation=[0,0,0,2],d=>d.nodes[0].scale=[0,1,1],
    d=>d.nodes[0].name='Unsafe name',d=>d.accessors[3].count=2
  ]){const f=fixture();edit(f.doc);assert.throws(()=>check(f));}
  const invalidIndex=fixture();write(invalidIndex,3,2,5123,3);assert.throws(()=>check(invalidIndex),/Index out of range/);
  const f=fixture();f.doc.nodes.push({name:'Another',mesh:0});f.doc.nodes[0].children=[1];
  assert.equal(check(f).renderVertices,6);assert.throws(()=>check(f,{vertices:5}),/Instanced/);
  const rest=fixture();rest.doc.nodes[0].scale=[1,.9999999403953552,1];assert.deepEqual(check(rest).document.nodes[0].scale,rest.doc.nodes[0].scale);
});
test('skin joint identity, index ranges, float weights and rest bind shape checks remain strict',()=> {
  assert.doesNotThrow(()=>check(skinFixture()));
  for(const edit of [
    d=>d.skins[0].joints=[1,1],d=>d.skins[0].joints=[99],d=>d.skins[0].skeleton=99,
    d=>d.skins[0].inverseBindMatrices=0,d=>d.nodes[0].skin=99,d=>delete d.nodes[0].mesh,
    d=>delete d.meshes[0].primitives[0].attributes.WEIGHTS_0,d=>d.accessors[4].componentType=5125
  ]){const f=skinFixture();edit(f.doc);assert.throws(()=>check(f));}
  for(const value of [-.1,0,.9,1.1]){const f=skinFixture();write(f,f.doc.accessors[5].bufferView,0,5126,value);assert.throws(()=>check(f),/Skin/);}
  const badJoint=skinFixture();write(badJoint,badJoint.doc.accessors[4].bufferView,0,5121,1);assert.throws(()=>check(badJoint),/joint range/);
});
test('malformed buffers, chunks and metadata fail with controlled contract errors',()=> {
  const original=encode(fixture());
  for(const bytes of [original.subarray(1),original.subarray(0,original.length-1),new Uint8Array(5),new ArrayBuffer(20)])assert.throws(()=>preflightArtGLB(bytes),e=>typeof e.code==='string');
  for(const edit of [d=>d.bufferViews[0].byteOffset=.5,d=>d.bufferViews[0].byteLength=Number.MAX_SAFE_INTEGER,d=>d.bufferViews[0].byteStride=5,d=>d.bufferViews[0].byteStride=8,d=>d.accessors[0].byteOffset=-1,d=>d.accessors[0].componentType='5126',d=>d.accessors[0].type='toString',d=>d.accessors[0].count=Number.MAX_SAFE_INTEGER,d=>d.accessors[0].min=[0,0,0],d=>d.buffers[0].byteLength-=4]) {
    const f=fixture();edit(f.doc);
    if(f.doc.accessors[0].min){f.doc.accessors[0].max=[-1,0,0];}
    assert.throws(()=>check(f),e=>typeof e.code==='string');
  }
});

test('known-role source provenance is inert, bounded and field-specific',()=> {
  const f=fixture();f.doc.nodes[0].name='A_reference_root';
  f.doc.nodes[0].extras={stage:'Static only',reference_priority:'Original sources',geometry_source:'Measured',
    asset_stage:'Original source',front_axis:'+Z',ground_y:.006,shape_source_sha256:'a'.repeat(64),
    joint_translation_policy:'Do not use as instructions',rig_revision:'r6',expression_channels:'Provenance only',
    petting_pose:'Inactive',note:'Preserved verbatim',selected_face_reference:'Source selection'};
  assert.deepEqual(check(f).document.nodes[0].extras,f.doc.nodes[0].extras);
  for(const name of ['A_mochi_skin','A_eye_highlight_L','A_eye_highlight_R','A_eye_L','A_eye_R','A_mouth_ring']) {
    const g=fixture();g.doc.nodes[0].name=name;
    g.doc.nodes[0].extras=name==='A_mochi_skin'?{role:'continuous_body_skin',touchTarget:'HeadTouch',rig_model:'Linear blend skinning'}:{expression_contract:'Source expression notes',selected_face_contract:'Source selected face notes'};
    assert.doesNotThrow(()=>check(g));g.doc.nodes[0].extras.script='console.log(1)';assert.throws(()=>check(g));
  }
  for(const edit of [
    e=>e.note='x'.repeat(513),e=>e.note='',e=>e.stage={},e=>e.ground_y='0',e=>e.ground_y=null,
    e=>e.shape_source_sha256='bad',e=>e.rig_model='wrong role',e=>e.arbitrary='unknown'
  ]){const g=structuredClone(f);edit(g.doc.nodes[0].extras);assert.throws(()=>check(g));}
});

// Bundled exact-source fixtures make these checks portable. The environment
// override optionally checks the original archive without changing it.
const artRoot=process.env.BUBU_ART_SOURCE_ROOT;
for(const known of [
  {id:'static05',path:'bubu-3d-a-feet05-20261016/candidate-a-static-05/a-reference-feet05.glb',hash:'3b7adcb303c8bd3c0dfb8976f9eb8fc0e6cefb897a7c16e99acc827385591722',nodes:7,scalars:729099,bytes:2337048,deformed:50265},
  {id:'r6',path:'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review/bubu-a05-selected-faces.glb',hash:'fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830',nodes:15,scalars:2306755,bytes:8044492,deformed:246169}
])test('hash-locked original '+known.id+' passes without source changes',async()=> {
  const bytes=new Uint8Array(await readFile(artRoot?resolve(artRoot,known.path):new URL('../fixtures/neutral-'+known.id+'/asset.glb',import.meta.url))),before=createHash('sha256').update(bytes).digest('hex');
  assert.equal(before,known.hash);
  const a=preflightArtGLB(bytes);
  assert.equal(a.nodes,known.nodes);assert.equal(a.vertices,50265);assert.equal(a.indices,299850);
  assert.equal(a.accessorScalars,known.scalars);assert.equal(a.decodedAccessorBytes,known.bytes);assert.equal(a.deformedVertices,known.deformed);
  let actualBytes=0,actualScalars=0;
  for(let i=0;i<a.document.accessors.length;i++) {const values=decodeArtAccessor(bytes,a.document,i);actualBytes+=values.byteLength;actualScalars+=values.length;}
  assert.equal(actualBytes,known.bytes);assert.equal(actualScalars,known.scalars);
  for(const m of a.document.meshes)assert.ok((m.weights??[]).every(w=>w===0));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),before);
});
