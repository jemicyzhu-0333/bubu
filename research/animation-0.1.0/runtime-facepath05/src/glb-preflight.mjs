import {
  ContractError, fail, json, LIMITS, num, list, exact, vec, quat
}
from './contracts.mjs';
const sizes= {
  5121:1, 5123:2, 5125:4, 5126:4
}, counts= {
  SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16
};
const idx=(i, a, label)=> {
  if(!Number.isInteger(i)||i<0||i>=a.length)fail('GLTF_REFERENCE', label);
  return a[i];
};
export function preflightGLB(bytes, budget=LIMITS) {
  try {
    return checkGLB(bytes, budget);
  }
  catch(e) {
    if(e instanceof ContractError)throw e;
    fail('GLB', 'Malformed GLB structure');
  }
}
function checkGLB(bytes, budget) {
  if(bytes.byteLength<20||bytes.byteLength>LIMITS.assetBytes)fail('GLB', 'GLB size');
  const v=new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if(v.getUint32(0, true)!==0x46546c67||v.getUint32(4, true)!==2||v.getUint32(8, true)!==bytes.byteLength)fail('GLB', 'GLB header');
  let at=12, doc=null, bin=null;
  while(at<bytes.byteLength) {
    if(at+8>bytes.byteLength)fail('GLB', 'Chunk header');
    const n=v.getUint32(at, true), type=v.getUint32(at+4, true);
    if(n%4||at+8+n>bytes.byteLength)fail('GLB', 'Chunk range');
    const chunk=bytes.subarray(at+8, at+8+n);
    if(type===0x4e4f534a&&at===12&&!doc)doc=json(chunk, LIMITS.profileBytes*4);
    else if(type===0x004e4942&&doc&&!bin)bin=chunk;
    else fail('GLB', 'Unsupported/duplicate chunk');
    at+=8+n;
  }
  if(!doc||!bin)fail('GLB', 'JSON and BIN required');
  exact(doc, ['asset', 'scene', 'scenes', 'nodes', 'meshes', 'buffers', 'bufferViews', 'accessors'], ['skins', 'materials']);
  exact(doc.asset, ['version'], ['generator']);
  if(doc.asset.version!=='2.0')fail('GLB', 'glTF version');
  list(doc.nodes, Math.min(LIMITS.nodes, budget.nodes));
  list(doc.meshes, LIMITS.meshes);
  list(doc.skins??[], 16);
  list(doc.materials??[], 16);
  if(doc.buffers.length!==1)fail('GLB', 'One embedded buffer required');
  exact(doc.buffers[0], ['byteLength']);
  if(!Number.isInteger(doc.buffers[0].byteLength)||doc.buffers[0].byteLength<1||doc.buffers[0].byteLength>bin.length||bin.length-doc.buffers[0].byteLength>3)fail('GLB', 'Buffer length');
  list(doc.bufferViews, LIMITS.bufferViews);
  list(doc.accessors, LIMITS.accessors);
  for(const b of doc.bufferViews) {
    exact(b, ['buffer', 'byteLength'], ['byteOffset', 'byteStride', 'target']);
    if(b.target!==undefined&&![34962, 34963].includes(b.target))fail('GLB', 'Buffer target');
    if(b.buffer!==0)fail('GLB', 'External buffer');
    num(b.byteOffset??0, 0, bin.length);
    num(b.byteLength, 1, bin.length);
    if(!Number.isInteger(b.byteOffset??0)||!Number.isInteger(b.byteLength))fail('GLB', 'Integer buffer range required');
    if((b.byteOffset??0)+b.byteLength>doc.buffers[0].byteLength)fail('GLB', 'Buffer view outside buffer');
    if(b.byteStride!==undefined) {
      num(b.byteStride, 4, 252);
      if(b.byteStride%4)fail('GLB', 'Stride alignment');
    }
  }
  let scalarCost=0;
  const access=[];
  for(const a of doc.accessors) {
    exact(a, ['bufferView', 'componentType', 'count', 'type'], ['byteOffset', 'min', 'max', 'normalized']);
    const bv=idx(a.bufferView, doc.bufferViews, 'accessor bufferView'), size=sizes[a.componentType], n=counts[a.type];
    if(!size||!n||!Number.isInteger(a.count)||a.count<1||a.count>LIMITS.indices)fail('GLB', 'Accessor type/count');
    scalarCost+=a.count*n;
    if(scalarCost>LIMITS.accessorScalars)fail('LIMIT', 'Accessor scalar cost');
    const offset=a.byteOffset??0, stride=bv.byteStride??size*n;
    if(!Number.isInteger(offset)||offset<0||offset%size||((bv.byteOffset??0)+offset)%size||stride<size*n||offset+(a.count-1)*stride+size*n>bv.byteLength)fail('GLB', 'Accessor range/alignment');
    if(bv.byteStride&&stride!==size*n&&(Math.floor(offset/stride)+a.count)*stride>bv.byteLength)fail('GLB', 'Loader interleaved backing range');
    if(a.normalized!==undefined&&a.normalized!==false)fail('GLB', 'Normalized accessors unsupported');
    for(const k of ['min', 'max'])if(a[k])vec(a[k], n);
    access.push({
      a, bv, size, n, stride, offset:(bv.byteOffset??0)+offset
    });
  }
  const d=new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read=(ai, i, c=0)=> {
    const a=idx(ai, access, 'accessor'), offset=a.offset+i*a.stride+c*a.size;
    return a.a.componentType===5126?d.getFloat32(offset, true):a.a.componentType===5125?d.getUint32(offset, true):a.a.componentType===5123?d.getUint16(offset, true):d.getUint8(offset);
  };
  // Bound all float values before the loader sees them, not only accessor min/max metadata.
  for(let a=0;
  a<access.length;
  a++)if(access[a].a.componentType===5126)for(let i=0;
  i<access[a].a.count;
  i++)for(let c=0;
  c<access[a].n;
  c++)if(!Number.isFinite(read(a, i, c)))fail('GLB', 'Nonfinite buffer float');
  let vertices=0, deformedVertices=0, indices=0, primitives=0;
  for(const m of doc.meshes) {
    exact(m, ['primitives'], ['name', 'weights', 'extras']);
    list(m.primitives, 1);
    if(m.primitives.length!==1)fail('GLB', 'One primitive per mesh in slice');
    if(m.weights) {
      if(!Array.isArray(m.weights)||m.weights.length!==(m.primitives[0].targets??[]).length||m.weights.some(x=>x!==0))fail('GLB', 'Default morph weights must be zero');
    }
    if(m.extras) {
      exact(m.extras, ['targetNames']);
      list(m.extras.targetNames, LIMITS.morphTargets);
      if(new Set(m.extras.targetNames).size!==m.extras.targetNames.length)fail('GLB', 'Duplicate morph names');
    }
    for(const p of m.primitives) {
      if(++primitives>LIMITS.primitives)fail('LIMIT', 'Primitive budget');
      exact(p, ['attributes', 'indices'], ['material', 'mode', 'targets']);
      if((p.mode??4)!==4)fail('GLB', 'Triangles only');
      exact(p.attributes, ['POSITION'], ['NORMAL', 'JOINTS_0', 'WEIGHTS_0']);
      const pos=idx(p.attributes.POSITION, doc.accessors, 'positions');
      if(pos.type!=='VEC3'||pos.componentType!==5126)fail('GLB', 'Positions');
      vertices+=pos.count;
      deformedVertices+=pos.count*(1+(p.targets??[]).length);
      for(const[n, ai]of Object.entries(p.attributes)) {
        const a=idx(ai, doc.accessors, n);
        if(a.count!==pos.count)fail('GLB', 'Attribute count');
        if(n==='NORMAL'&&(a.type!=='VEC3'||a.componentType!==5126))fail('GLB', 'Normals');
        if(n==='JOINTS_0'&&(a.type!=='VEC4'||![5121, 5123].includes(a.componentType)))fail('GLB', 'Joints');
        if(n==='WEIGHTS_0'&&(a.type!=='VEC4'||a.componentType!==5126))fail('GLB', 'Weights');
      }
      if(('JOINTS_0'in p.attributes)!==('WEIGHTS_0'in p.attributes))fail('GLB', 'Joint/weight pair');
      const ia=idx(p.indices, doc.accessors, 'indices');
      if(ia.type!=='SCALAR'||![5121, 5123, 5125].includes(ia.componentType)||ia.count%3)fail('GLB', 'Indices');
      indices+=ia.count;
      for(let i=0;
      i<ia.count;
      i++)if(read(p.indices, i)>=pos.count)fail('GLB', 'Index out of range');
      if(p.material!==undefined)idx(p.material, doc.materials??[], 'material');
      list(p.targets??[], LIMITS.morphTargets);
      if(m.extras&&m.extras.targetNames.length!==(p.targets??[]).length)fail('GLB', 'Morph names');
      for(const target of p.targets??[]) {
        exact(target, ['POSITION']);
        const a=idx(target.POSITION, doc.accessors, 'morph');
        if(a.type!=='VEC3'||a.componentType!==5126||a.count!==pos.count)fail('GLB', 'Morph data');
      }
    }
  }
  if(vertices>Math.min(LIMITS.vertices, budget.vertices)||indices>LIMITS.indices||deformedVertices>LIMITS.deformedVertices)fail('LIMIT', 'Geometry budget');
  for(const m of doc.materials??[]) {
    exact(m, [], ['name', 'pbrMetallicRoughness', 'doubleSided']);
    if(m.pbrMetallicRoughness) {
      exact(m.pbrMetallicRoughness, [], ['baseColorFactor', 'metallicFactor', 'roughnessFactor']);
      if(m.pbrMetallicRoughness.baseColorFactor)vec(m.pbrMetallicRoughness.baseColorFactor, 4, 0, 1);
      for(const k of ['metallicFactor', 'roughnessFactor'])if(m.pbrMetallicRoughness[k]!==undefined)num(m.pbrMetallicRoughness[k], 0, 1);
    }
  }
  const names=new Set();
  for(const node of doc.nodes) {
    if(typeof node.name!=='string'||!(/^[A-Za-z][A-Za-z0-9_]*$/).test(node.name)||names.has(node.name))fail('GLB', 'Node names must be unique safe identifiers');
    names.add(node.name);
  }
  let renderVertices=0, renderDeformedVertices=0;
  for(const node of doc.nodes)if(node.mesh!==undefined) {
    const mesh=idx(node.mesh, doc.meshes, 'node mesh');
    for(const p of mesh.primitives) {
      const c=doc.accessors[p.attributes.POSITION].count;
      renderVertices+=c;
      renderDeformedVertices+=c*(1+(p.targets??[]).length);
    }
  }
  if(renderVertices>Math.min(LIMITS.vertices, budget.vertices)||renderDeformedVertices>LIMITS.deformedVertices)fail('LIMIT', 'Instanced geometry budget');
  const parents=new Int32Array(doc.nodes.length).fill(-1);
  for(let i=0;
  i<doc.nodes.length;
  i++) {
    const n=doc.nodes[i];
    exact(n, [], ['name', 'children', 'translation', 'rotation', 'scale', 'mesh', 'skin', 'weights']);
    if(n.translation)vec(n.translation, 3);
    if(n.rotation)quat(n.rotation);
    if(n.scale) {
      vec(n.scale, 3, .001, 100);
      if(n.scale.some(x=>x!==1))fail('GLB', 'Nonunit node scale unsupported in slice');
    }
    for(const c of n.children??[]) {
      idx(c, doc.nodes, 'child');
      if(parents[c]!==-1)fail('GLB', 'Multiple parents');
      parents[c]=i;
    }
    if(n.mesh!==undefined)idx(n.mesh, doc.meshes, 'mesh');
    if(n.weights) {
      if(n.mesh===undefined||!Array.isArray(n.weights)||n.weights.length!==(doc.meshes[n.mesh].primitives[0].targets??[]).length||n.weights.some(x=>x!==0))fail('GLB', 'Node default morph weights must be zero');
    }
    if(n.skin!==undefined) {
      const skin=idx(n.skin, doc.skins??[], 'skin');
      if(n.mesh===undefined)fail('GLB', 'Skin without mesh');
      for(const p of doc.meshes[n.mesh].primitives) {
        if(p.attributes.JOINTS_0===undefined)fail('GLB', 'Unweighted skinned primitive');
        const count=doc.accessors[p.attributes.JOINTS_0].count;
        for(let v=0;
        v<count;
        v++) {
          let sum=0;
          for(let c=0;
          c<4;
          c++) {
            const w=read(p.attributes.WEIGHTS_0, v, c);
            if(w<0||w>1||read(p.attributes.JOINTS_0, v, c)>=skin.joints.length)fail('GLB', 'Skin weights/joint range');
            sum+=w;
          }
          if(Math.abs(sum-1)>1e-4)fail('GLB', 'Skin weight sum');
        }
      }
    }
  }
  for(let i=0;
  i<parents.length;
  i++) {
    let n=i, depth=0;
    while(n!==-1) {
      if(++depth>doc.nodes.length)fail('GLB', 'Node cycle');
      n=parents[n];
    }
  }
  for(const s of doc.skins??[]) {
    exact(s, ['joints', 'inverseBindMatrices'], ['name', 'skeleton']);
    list(s.joints, LIMITS.joints);
    if(!s.joints.length||new Set(s.joints).size!==s.joints.length)fail('GLB', 'Skin joints');
    s.joints.forEach(x=>idx(x, doc.nodes, 'joint'));
    if(s.skeleton!==undefined)idx(s.skeleton, doc.nodes, 'skeleton');
    const a=idx(s.inverseBindMatrices, doc.accessors, 'bind matrices');
    if(a.type!=='MAT4'||a.componentType!==5126||a.count!==s.joints.length)fail('GLB', 'Bind matrix count');
  }
  list(doc.scenes, 1);
  if(doc.scene!==0||doc.scenes.length!==1)fail('GLB', 'Single default scene');
  exact(doc.scenes[0], ['nodes'], ['name']);
  if(!Array.isArray(doc.scenes[0].nodes)||new Set(doc.scenes[0].nodes).size!==doc.scenes[0].nodes.length)fail('GLB', 'Duplicate scene roots');
  doc.scenes[0].nodes.forEach(x=> {
    idx(x, doc.nodes, 'scene root');
    if(parents[x]!==-1)fail('GLB', 'Nonroot scene node');
  });
  const reachable=new Set(), todo=doc.scenes[0].nodes.slice();
  while(todo.length) {
    const i=todo.pop();
    if(reachable.has(i))fail('GLB', 'Repeated scene node');
    reachable.add(i);
    for(const c of doc.nodes[i].children??[])todo.push(c);
  }
  if(reachable.size!==doc.nodes.length)fail('GLB', 'Unused or disconnected nodes unsupported');
  return {
    document:doc, vertices, deformedVertices, indices, nodes:doc.nodes.length, primitives, textureBytes:0, renderVertices, renderDeformedVertices, accessorScalars:scalarCost
  };
}
