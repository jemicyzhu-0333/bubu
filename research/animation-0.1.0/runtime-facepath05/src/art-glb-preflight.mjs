import { ContractError, fail, json, num, list, exact, vec, quat, str } from './contracts.mjs';

// This is a separate neutral-art boundary. It does not relax mechanics LIMITS.
export const ART_LIMITS=Object.freeze({
  assetBytes:12*1024*1024, totalBytes:16*1024*1024, jsonBytes:1024*1024,
  nodes:32, meshes:8, materials:8, skins:16, joints:32, primitives:8,
  vertices:60000, indices:300000, morphTargets:64, accessors:768, bufferViews:768,
  accessorScalars:4000000, decodedAccessorBytes:16000000,
  accessorWorkScalars:12000000, deformedVertices:400000
});
// Separate seven-slot face slice ceilings; neutral ART_LIMITS stay unchanged.
export const FACE_LIMITS=Object.freeze({...ART_LIMITS,meshes:9,primitives:9,indices:310000,accessors:1024,bufferViews:1200});
const sizes={5121:1,5123:2,5125:4,5126:4};
const counts={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const types={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const extensions=['KHR_materials_specular','KHR_materials_ior'];
const validatedAccessors=new WeakMap();
const own=(o,k)=>Object.hasOwn(o,k);
const idx=(i,a,label)=> {
  if(!Number.isSafeInteger(i)||i<0||i>=a.length)fail('GLTF_REFERENCE',label);
  return a[i];
};
const integer=(n,min,max,label)=> {
  if(!Number.isSafeInteger(n)||n<min||n>max)fail('GLB',label);
  return n;
};
function ceilings(budget,hardLimits=ART_LIMITS) {
  if(!budget||typeof budget!=='object'||Array.isArray(budget))fail('LIMIT','Art budget');
  const out={};
  for(const [key,hard] of Object.entries(hardLimits)) {
    const value=budget[key]===undefined?hard:budget[key];
    if(!Number.isSafeInteger(value)||value<0)fail('LIMIT','Art budget '+key);
    out[key]=Math.min(value,hard);
  }
  return out;
}
export function preflightArtGLB(bytes,budget=ART_LIMITS) {
  try { return checkGLB(bytes,ceilings(budget)); }
  catch(e) {
    if(e instanceof ContractError)throw e;
    fail('GLB','Malformed neutral art GLB structure');
  }
}
export function preflightFaceGLB(bytes,budget=FACE_LIMITS) {
  try {return checkGLB(bytes,ceilings(budget,FACE_LIMITS),'approved-face-slice');}
  catch(e){if(e instanceof ContractError)throw e;fail('GLB','Malformed approved face GLB');}
}
function checkGLB(bytes,limit,purpose='neutral') {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<20||bytes.byteLength>limit.assetBytes)fail('GLB','GLB size/type');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==bytes.byteLength)fail('GLB','GLB header');
  let at=12,doc=null,bin=null;
  while(at<bytes.byteLength) {
    if(at+8>bytes.byteLength)fail('GLB','Chunk header');
    const n=v.getUint32(at,true),type=v.getUint32(at+4,true);
    if(n%4||n>bytes.byteLength-at-8)fail('GLB','Chunk range');
    const chunk=bytes.subarray(at+8,at+8+n);
    if(type===0x4e4f534a&&at===12&&!doc)doc=json(chunk,limit.jsonBytes);
    else if(type===0x004e4942&&doc&&!bin)bin=chunk;
    else fail('GLB','Unsupported/duplicate chunk');
    at+=8+n;
  }
  if(!doc||!bin)fail('GLB','JSON and BIN required');
  const structural=[doc];
  while(structural.length) {
    const value=structural.pop();
    if(value===null)fail('GLB','Null glTF fields are unsupported');
    if(value&&typeof value==='object')for(const child of Object.values(value))structural.push(child);
  }
  exact(doc,['asset','scene','scenes','nodes','meshes','buffers','bufferViews','accessors'],['skins','materials','extensionsUsed','extensionsRequired',...(purpose==='approved-face-slice'?['extras']:[])]);
  if(own(doc,'extras')) {
    exact(doc.extras,['bubuLibrary','semanticSlotCount','approvalMessageID','historicalTargets','activeSemanticStates']);
    for(const key of ['bubuLibrary','approvalMessageID','historicalTargets'])str(doc.extras[key],key);
    integer(doc.extras.semanticSlotCount,1,7,'Face slice slot count');
    list(doc.extras.activeSemanticStates,7,'Face source IDs');
    if(doc.extras.activeSemanticStates.length!==doc.extras.semanticSlotCount||new Set(doc.extras.activeSemanticStates).size!==doc.extras.semanticSlotCount)fail('GLB','Source semantic IDs');
    doc.extras.activeSemanticStates.forEach(id=>str(id));
  }
  exact(doc.asset,['version'],['generator']);
  if(doc.asset.version!=='2.0')fail('GLB','glTF version');
  if(own(doc.asset,'generator'))str(doc.asset.generator,'generator');
  for(const key of ['nodes','meshes','skins','materials','bufferViews','accessors'])list(doc[key]??[],limit[key],key);
  if(!doc.nodes.length||!doc.meshes.length)fail('GLB','Art nodes and meshes required');
  const declared=new Set();
  for(const key of ['extensionsUsed','extensionsRequired']) {
    const names=doc[key]??[];
    list(names,extensions.length,key);
    if(new Set(names).size!==names.length||names.some(x=>!extensions.includes(x)))fail('GLB','Unsupported/duplicate extension declaration');
    if(key==='extensionsUsed')for(const name of names)declared.add(name);
    else if(names.some(x=>!declared.has(x)))fail('GLB','Required extension not declared used');
  }
  list(doc.buffers,1,'buffers');
  if(doc.buffers.length!==1)fail('GLB','One embedded buffer required');
  exact(doc.buffers[0],['byteLength']);
  const bufferBytes=integer(doc.buffers[0].byteLength,1,bin.length,'Buffer length');
  if(bin.length-bufferBytes>3)fail('GLB','Buffer padding');
  for(const b of doc.bufferViews) {
    exact(b,['buffer','byteLength'],['byteOffset','byteStride','target']);
    if(b.buffer!==0)fail('GLB','External buffer');
    const offset=integer(b.byteOffset??0,0,bufferBytes,'Integer buffer offset required');
    integer(b.byteLength,1,bufferBytes,'Integer buffer length required');
    if(b.byteLength>bufferBytes-offset)fail('GLB','Buffer view outside buffer');
    if(own(b,'target')&&![34962,34963].includes(b.target))fail('GLB','Buffer target');
    if(own(b,'byteStride')) {
      integer(b.byteStride,4,252,'Buffer stride');
      if(b.byteStride%4||b.target===34963)fail('GLB','Stride alignment/target');
    }
  }
  // Validate every declared dense size and aggregate sparse work before reading
  // any data or allocating any decoded accessor arrays (including zero bases).
  let accessorScalars=0,decodedAccessorBytes=0,sparseScalars=0,sparseIndices=0;
  const access=[];
  const denseRange=(viewIndex,byteOffset,count,size,n,sparse=false)=> {
    const bv=idx(viewIndex,doc.bufferViews,'accessor bufferView');
    const offset=integer(byteOffset??0,0,bv.byteLength,'Accessor byteOffset');
    if(sparse&&(own(bv,'byteStride')||own(bv,'target')))fail('GLB','Sparse bufferView stride/target');
    const stride=bv.byteStride??size*n;
    const absolute=(bv.byteOffset??0)+offset;
    if(offset%size||absolute%size||stride<size*n)fail('GLB','Accessor alignment');
    const range=(count-1)*stride+size*n;
    if(!Number.isSafeInteger(range)||range>bv.byteLength-offset)fail('GLB','Accessor range');
    if(bv.byteStride&&stride!==size*n&&(Math.floor(offset/stride)+count)*stride>bv.byteLength)fail('GLB','Loader interleaved backing range');
    return {bv,offset:absolute,stride};
  };
  for(const a of doc.accessors) {
    exact(a,['componentType','count','type'],['bufferView','byteOffset','min','max','normalized','sparse']);
    const size=own(sizes,a.componentType)&&typeof a.componentType==='number'?sizes[a.componentType]:0,n=own(counts,a.type)?counts[a.type]:0;
    if(!size||!n)fail('GLB','Accessor type');
    integer(a.count,1,limit.indices,'Accessor count');
    const scalars=a.count*n;
    accessorScalars+=scalars;
    decodedAccessorBytes+=scalars*size;
    if(accessorScalars>limit.accessorScalars||decodedAccessorBytes>limit.decodedAccessorBytes)fail('LIMIT','Accessor dense allocation budget');
    if(own(a,'normalized')&&a.normalized!==false)fail('GLB','Normalized accessors unsupported');
    for(const key of ['min','max'])if(own(a,key)) {
      vec(a[key],n,-Number.MAX_VALUE,Number.MAX_VALUE);
      if(a.componentType!==5126&&a[key].some(x=>!Number.isInteger(x)||x<0||x>2**(8*size)-1))fail('GLB','Unsigned accessor bounds');
    }
    if(own(a,'min')&&own(a,'max')&&a.min.some((x,i)=>x>a.max[i]))fail('GLB','Accessor min/max order');
    let base=null,sparse=null;
    if(own(a,'bufferView'))base=denseRange(a.bufferView,a.byteOffset,a.count,size,n);
    else if((a.byteOffset??0)!==0)fail('GLB','Zero-base accessor byteOffset must be zero');
    if(own(a,'sparse')) {
      exact(a.sparse,['count','indices','values']);
      const count=integer(a.sparse.count,1,a.count,'Sparse count');
      exact(a.sparse.indices,['bufferView','componentType'],['byteOffset']);
      exact(a.sparse.values,['bufferView'],['byteOffset']);
      const it=a.sparse.indices.componentType;
      if(![5121,5123,5125].includes(it))fail('GLB','Sparse unsigned index type');
      sparse={count,indexType:it,
        indices:denseRange(a.sparse.indices.bufferView,a.sparse.indices.byteOffset,count,sizes[it],1,true),
        values:denseRange(a.sparse.values.bufferView,a.sparse.values.byteOffset,count,size,n,true)};
      if(n>4||(base?.bv.byteStride&&base.stride!==size*n))fail('GLB','Loader sparse matrix/interleaved base unsupported');
      sparseIndices+=count;
      sparseScalars+=count*n;
    }
    access.push({a,size,n,base,sparse});
  }
  const accessorWorkScalars=accessorScalars+sparseScalars+sparseIndices;
  if(accessorWorkScalars>limit.accessorWorkScalars)fail('LIMIT','Accessor aggregate decode work');
  const data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  for(const x of access)x.values=decodePrepared(data,x);
  const read=(ai,i,c=0)=> {const a=idx(ai,access,'accessor');return a.values[i*a.n+c];};
  let vertices=0,deformedVertices=0,indices=0,primitives=0;
  for(const m of doc.meshes) {
    exact(m,['primitives'],['name','weights','extras']);
    if(own(m,'name'))str(m.name,'mesh name');
    list(m.primitives,1,'primitives');
    if(m.primitives.length!==1)fail('GLB','One primitive per art mesh');
    const targets=m.primitives[0].targets??[];
    list(targets,limit.morphTargets,'morph targets');
    if(own(m,'weights')&&(!Array.isArray(m.weights)||m.weights.length!==targets.length||m.weights.some(x=>x!==0)))fail('GLB','Default morph weights must be zero');
    if(own(m,'extras')) {
      exact(m.extras,['targetNames']);
      list(m.extras.targetNames,limit.morphTargets,'target names');
      m.extras.targetNames.forEach(x=>str(x,'target name'));
      if(m.extras.targetNames.length!==targets.length||new Set(m.extras.targetNames).size!==m.extras.targetNames.length)fail('GLB','Morph names');
    }
    for(const p of m.primitives) {
      if(++primitives>limit.primitives)fail('LIMIT','Primitive budget');
      exact(p,['attributes','indices'],['material','mode','targets']);
      if((p.mode??4)!==4)fail('GLB','Triangles only');
      exact(p.attributes,['POSITION'],['NORMAL','COLOR_0','JOINTS_0','WEIGHTS_0']);
      const pos=idx(p.attributes.POSITION,doc.accessors,'positions');
      if(pos.type!=='VEC3'||pos.componentType!==5126)fail('GLB','Positions');
      vertices+=pos.count;
      deformedVertices+=pos.count*(1+targets.length);
      for(const [name,ai] of Object.entries(p.attributes)) {
        const a=idx(ai,doc.accessors,name),x=access[ai];
        if(a.count!==pos.count)fail('GLB','Attribute count');
        if(x.base&&(x.base.offset%4||x.base.stride%4||x.base.bv.target===34963))fail('GLB','Vertex attribute alignment/target');
        if(name==='NORMAL'&&(a.type!=='VEC3'||a.componentType!==5126))fail('GLB','Normals');
        if(name==='JOINTS_0'&&(a.type!=='VEC4'||![5121,5123].includes(a.componentType)))fail('GLB','Joints');
        if(name==='WEIGHTS_0'&&(a.type!=='VEC4'||a.componentType!==5126))fail('GLB','Weights');
        if(name==='COLOR_0') {
          if(!['VEC3','VEC4'].includes(a.type)||a.componentType!==5126)fail('GLB','Float vertex colors required');
          for(const value of x.values)if(value<0||value>1)fail('GLB','Vertex colors out of range');
        }
      }
      if(own(p.attributes,'JOINTS_0')!==own(p.attributes,'WEIGHTS_0'))fail('GLB','Joint/weight pair');
      const ia=idx(p.indices,doc.accessors,'indices');
      if(ia.type!=='SCALAR'||![5121,5123,5125].includes(ia.componentType)||ia.count%3)fail('GLB','Indices');
      if(access[p.indices].base&&(own(access[p.indices].base.bv,'byteStride')||access[p.indices].base.bv.target===34962))fail('GLB','Index stride/target');
      indices+=ia.count;
      for(let i=0;i<ia.count;i++)if(read(p.indices,i)>=pos.count)fail('GLB','Index out of range');
      if(own(p,'material'))idx(p.material,doc.materials??[],'material');
      for(const target of targets) {
        exact(target,[],['POSITION','NORMAL']);
        if(!Object.keys(target).length)fail('GLB','Empty morph target');
        for(const [name,ai] of Object.entries(target)) {
          if(name==='NORMAL'&&!own(p.attributes,'NORMAL'))fail('GLB','Normal morph without base normals');
          const a=idx(ai,doc.accessors,'morph');
          if(a.type!=='VEC3'||a.componentType!==5126||a.count!==pos.count)fail('GLB','Morph data');
          const base=access[ai].base;
          if(base&&(base.offset%4||base.stride%4||base.bv.target===34963))fail('GLB','Morph alignment/target');
        }
      }
    }
  }
  if(vertices>limit.vertices||indices>limit.indices||deformedVertices>limit.deformedVertices)fail('LIMIT','Geometry budget');
  const used=new Set();
  for(const m of doc.materials??[]) {
    exact(m,[],['name','pbrMetallicRoughness','doubleSided','extensions']);
    if(own(m,'name'))str(m.name,'material name');
    if(own(m,'doubleSided')&&typeof m.doubleSided!=='boolean')fail('GLB','doubleSided must be boolean');
    if(own(m,'pbrMetallicRoughness')) {
      exact(m.pbrMetallicRoughness,[],['baseColorFactor','metallicFactor','roughnessFactor']);
      if(own(m.pbrMetallicRoughness,'baseColorFactor'))vec(m.pbrMetallicRoughness.baseColorFactor,4,0,1);
      for(const key of ['metallicFactor','roughnessFactor'])if(own(m.pbrMetallicRoughness,key))num(m.pbrMetallicRoughness[key],0,1);
    }
    if(own(m,'extensions')) {
      exact(m.extensions,[],extensions);
      for(const [name,extension] of Object.entries(m.extensions)) {
        if(!declared.has(name))fail('GLB','Undeclared material extension');
        used.add(name);
        if(name==='KHR_materials_specular') {
          exact(extension,[],['specularFactor','specularColorFactor']);
          if(own(extension,'specularFactor'))num(extension.specularFactor,0,1);
          if(own(extension,'specularColorFactor'))vec(extension.specularColorFactor,3,0,Number.MAX_VALUE);
        } else {
          exact(extension,[],['ior']);
          if(own(extension,'ior')&&(extension.ior!==0&&(!Number.isFinite(extension.ior)||extension.ior<1)))fail('GLB','Index of refraction');
        }
      }
    }
  }
  if([...declared].some(x=>!used.has(x)))fail('GLB','Unused extension declaration');
  const names=new Set();
  for(const node of doc.nodes) {
    if(typeof node.name!=='string'||node.name.length>160||!(/^[A-Za-z][A-Za-z0-9_]*$/).test(node.name)||names.has(node.name))fail('GLB','Node names must be unique safe identifiers');
    names.add(node.name);
  }
  let renderVertices=0,renderDeformedVertices=0;
  for(const node of doc.nodes)if(own(node,'mesh')) {
    const mesh=idx(node.mesh,doc.meshes,'node mesh');
    for(const p of mesh.primitives) {
      const count=doc.accessors[p.attributes.POSITION].count;
      renderVertices+=count;
      renderDeformedVertices+=count*(1+(p.targets??[]).length);
    }
  }
  if(renderVertices>limit.vertices||renderDeformedVertices>limit.deformedVertices)fail('LIMIT','Instanced geometry budget');
  for(const s of doc.skins??[]) {
    exact(s,['joints','inverseBindMatrices'],['name','skeleton']);
    if(own(s,'name'))str(s.name,'skin name');
    list(s.joints,limit.joints,'joints');
    if(!s.joints.length||new Set(s.joints).size!==s.joints.length)fail('GLB','Skin joints');
    s.joints.forEach(x=>idx(x,doc.nodes,'joint'));
    if(own(s,'skeleton'))idx(s.skeleton,doc.nodes,'skeleton');
    const a=idx(s.inverseBindMatrices,doc.accessors,'bind matrices');
    if(a.type!=='MAT4'||a.componentType!==5126||a.count!==s.joints.length)fail('GLB','Bind matrix count');
  }
  const parents=new Int32Array(doc.nodes.length).fill(-1);
  for(let i=0;i<doc.nodes.length;i++) {
    const n=doc.nodes[i];
    exact(n,['name'],['children','translation','rotation','scale','mesh','skin','weights','extras']);
    if(own(n,'translation'))vec(n.translation,3);
    if(own(n,'rotation'))quat(n.rotation);
    // Retain the exact source rest scale; profile binding checks its identity.
    if(own(n,'scale'))vec(n.scale,3,.01,10);
    if(own(n,'extras'))validateNodeExtras(n,purpose);
    list(n.children??[],limit.nodes,'children');
    for(const child of n.children??[]) {
      idx(child,doc.nodes,'child');
      if(parents[child]!==-1)fail('GLB','Multiple parents');
      parents[child]=i;
    }
    if(own(n,'mesh'))idx(n.mesh,doc.meshes,'mesh');
    if(own(n,'weights')&&(n.mesh===undefined||!Array.isArray(n.weights)||n.weights.length!==(doc.meshes[n.mesh].primitives[0].targets??[]).length||n.weights.some(x=>x!==0)))fail('GLB','Node default morph weights must be zero');
    if(own(n,'skin')) {
      const skin=idx(n.skin,doc.skins??[],'skin');
      if(!own(n,'mesh'))fail('GLB','Skin without mesh');
      for(const p of doc.meshes[n.mesh].primitives) {
        if(!own(p.attributes,'JOINTS_0'))fail('GLB','Unweighted skinned primitive');
        const count=doc.accessors[p.attributes.JOINTS_0].count;
        for(let vertex=0;vertex<count;vertex++) {
          let sum=0;
          for(let c=0;c<4;c++) {
            const w=read(p.attributes.WEIGHTS_0,vertex,c);
            if(w<0||w>1||read(p.attributes.JOINTS_0,vertex,c)>=skin.joints.length)fail('GLB','Skin weights/joint range');
            sum+=w;
          }
          if(Math.abs(sum-1)>1e-4)fail('GLB','Skin weight sum');
        }
      }
    }
  }
  for(let i=0;i<parents.length;i++) {
    let node=i,depth=0;
    while(node!==-1) {
      if(++depth>doc.nodes.length)fail('GLB','Node cycle');
      node=parents[node];
    }
  }
  list(doc.scenes,1,'scenes');
  if(doc.scene!==0||doc.scenes.length!==1)fail('GLB','Single default scene');
  exact(doc.scenes[0],['nodes'],['name']);
  if(own(doc.scenes[0],'name'))str(doc.scenes[0].name,'scene name');
  list(doc.scenes[0].nodes,limit.nodes,'scene nodes');
  if(new Set(doc.scenes[0].nodes).size!==doc.scenes[0].nodes.length)fail('GLB','Duplicate scene roots');
  doc.scenes[0].nodes.forEach(x=> {
    idx(x,doc.nodes,'scene root');
    if(parents[x]!==-1)fail('GLB','Nonroot scene node');
  });
  const reachable=new Set(),todo=doc.scenes[0].nodes.slice();
  while(todo.length) {
    const i=todo.pop();
    if(reachable.has(i))fail('GLB','Repeated scene node');
    reachable.add(i);
    for(const child of doc.nodes[i].children??[])todo.push(child);
  }
  if(reachable.size!==doc.nodes.length)fail('GLB','Unused or disconnected nodes unsupported');
  // No dense arrays escape this audit. Only bounded metadata is retained for
  // independent, one-accessor-at-a-time source comparisons after validation.
  validatedAccessors.set(doc,{bytes,binOffset:bin.byteOffset,binLength:bin.byteLength,
    access:access.map(x=>({a:{count:x.a.count,componentType:x.a.componentType},n:x.n,size:x.size,
      base:x.base?{offset:x.base.offset,stride:x.base.stride}:null,
      sparse:x.sparse?{count:x.sparse.count,indexType:x.sparse.indexType,
        indices:{offset:x.sparse.indices.offset,stride:x.sparse.indices.stride},
        values:{offset:x.sparse.values.offset,stride:x.sparse.values.stride}}:null}))});
  return {document:doc,vertices,deformedVertices,indices,nodes:doc.nodes.length,primitives,textureBytes:0,
    renderVertices,renderDeformedVertices,accessorScalars,decodedAccessorBytes,sparseScalars,sparseIndices,accessorWorkScalars};
}

/** Decode one source accessor after successful validation of these exact objects.
 * The caller must retain immutable source bytes. Returned arrays are fresh and
 * never alias or mutate the GLB; this helper does not activate or load an actor.
 */
export function decodeArtAccessor(bytes,document,accessorIndex) {
  const validated=validatedAccessors.get(document);
  if(!validated||validated.bytes!==bytes)fail('GLB','Source accessor requires the same preflight-validated bytes/document');
  const descriptor=idx(accessorIndex,validated.access,'accessor');
  return decodePrepared(new DataView(bytes.buffer,validated.binOffset,validated.binLength),descriptor);
}
function decodePrepared(data,x) {
  const {a,n,size,base,sparse}=x;
  const component=(type,offset)=>type===5126?data.getFloat32(offset,true):type===5125?data.getUint32(offset,true):type===5123?data.getUint16(offset,true):data.getUint8(offset);
  const values=new types[a.componentType](a.count*n);
  if(base)for(let i=0;i<a.count;i++)for(let c=0;c<n;c++) {
    const value=component(a.componentType,base.offset+i*base.stride+c*size);
    if(!Number.isFinite(value))fail('GLB','Nonfinite base buffer value');
    values[i*n+c]=value;
  }
  if(sparse) {
    let previous=-1;
    for(let i=0;i<sparse.count;i++) {
      const index=component(sparse.indexType,sparse.indices.offset+i*sparse.indices.stride);
      if(index<=previous||index>=a.count)fail('GLB','Sparse indices must be sorted, unique and in range');
      previous=index;
      for(let c=0;c<n;c++) {
        const value=component(a.componentType,sparse.values.offset+i*sparse.values.stride+c*size);
        if(!Number.isFinite(value))fail('GLB','Nonfinite sparse buffer value');
        values[index*n+c]=value;
      }
    }
  }
  return values;
}

function validateNodeExtras(node,purpose) {
  const faceNodes=['A_eye_highlight_L','A_eye_highlight_R','A_eye_L','A_eye_R','A_mouth_ring'];
  let fields;
  if(node.name==='HeadTouch') {
    exact(node.extras,['surface_normal_blender']);
    vec(node.extras.surface_normal_blender,3,-1,1);
    if(Math.abs(Math.hypot(...node.extras.surface_normal_blender)-1)>1e-4)fail('GLB','HeadTouch source normal must be near unit');
    return;
  }
  if(purpose==='approved-face-slice'&&['A_brow_L','A_brow_R','A_tongue'].includes(node.name))fields=['layer'];
  else if(node.name==='A_mochi_skin')fields=['role','touchTarget','rig_model'];
  else if(faceNodes.includes(node.name))fields=['expression_contract','selected_face_contract'];
  else if(node.name==='A_reference_root')fields=['stage','reference_priority','geometry_source','asset_stage','front_axis','ground_y','shape_source_sha256','joint_translation_policy','rig_revision','expression_channels','petting_pose','note','selected_face_reference'];
  else fail('GLB','Node extras are restricted to known source roles');
  if(purpose==='approved-face-slice'&&node.name==='A_reference_root')fields=[...fields,'new_basic_faces','gaze_status'];
  exact(node.extras,[],fields);
  // These source notes are inert provenance, never commands, capabilities,
  // runtime bindings or a substitute for the separate hash/profile checks.
  for(const [key,value] of Object.entries(node.extras)) {
    if(key==='ground_y')num(value,-1e6,1e6,'Source ground height');
    else if(key==='shape_source_sha256') {
      if(typeof value!=='string'||!(/^[0-9a-f]{64}$/).test(value))fail('GLB','Source shape hash');
    } else if(typeof value!=='string'||!value.length||value.length>512)fail('GLB','Bounded source provenance string');
  }
}
