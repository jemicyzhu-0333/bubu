import {
  GLTFLoader
}
from 'three/addons/loaders/GLTFLoader.js';
import {
  json, validateManifest, validateProfile, validateMotion, LIMITS, fail
}
from './contracts.mjs';
import {
  preflightGLB
}
from './glb-preflight.mjs';
import {validateFaceManifest,validateFaceProfile} from './face-contract.mjs';
import {preflightFaceGLB} from './art-glb-preflight.mjs';
import {preflightArtGLB} from './art-glb-preflight.mjs';
import {validateNeutralManifest,validateNeutralProfile} from './neutral-contract.mjs';
import {verifyNeutralSource} from './neutral-source-check.mjs';
import {decodedArrayReservation,geometryBackingBytes} from './geometry-accounting.mjs';
import {validateClipLibrary} from './clip-contract.mjs';
// Immutable admission accounting is captured before exposing the prepared pack.
const admissionRecords=new WeakMap();
const privatePreparedBytes=new WeakMap();
function deepFreeze(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    for(const child of Object.values(value))deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function readonlyMap(map,copyBytes=false) {
  const read=value=>copyBytes&&value!==undefined?value.slice():value;
  const entries=function*(){for(const [key,value] of map)yield [key,read(value)];};
  return Object.freeze({size:map.size,get:key=>read(map.get(key)),has:key=>map.has(key),keys:()=>map.keys(),values:function*(){for(const value of map.values())yield read(value);},entries,[Symbol.iterator]:entries});
}
export function preparedAdmission(pack) {
  const record=admissionRecords.get(pack);
  if(!record)fail('BINDING', 'ActorPool requires a prepared pack');
  return record;
}
export async function sha256(bytes) {
  const h=new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, b=>b.toString(16).padStart(2, '0')).join('');
}
export async function preparePack(read, {
  signal
}
= {
}) {
  const check=()=> {
    if(signal?.aborted)throw signal.reason??new Error('Aborted');
  };
  check();
  const m=validateManifest(json(await read('manifest.json', LIMITS.manifestBytes, signal), LIMITS.manifestBytes));
  const data=new Map(), audits=new Map();
  let vertices=0, nodes=0, deformedVertices=0;
  for(const a of m.assets) {
    check();
    const incoming=await read(a.path, a.bytes, signal);
    check();
    if(!(incoming instanceof Uint8Array)||incoming.byteLength!==a.bytes)fail('INTEGRITY', a.id);
    // Own bytes before the hash await or any subsequent reader invocation.
    // Buffer.slice aliases memory, so use a real Uint8Array copy explicitly.
    const b=Uint8Array.from(incoming);
    if(await sha256(b)!==a.sha256)fail('INTEGRITY', a.id);
    if(a.kind==='glb') {
      const v=preflightGLB(b, m.budgets);
      vertices+=v.vertices;
      nodes+=v.nodes;
      deformedVertices+=v.deformedVertices;
      audits.set(a.id, v);
    }
    data.set(a.id, b);
  }
  if(vertices>m.budgets.vertices||nodes>m.budgets.nodes||deformedVertices>LIMITS.deformedVertices)fail('LIMIT', 'Aggregate package geometry budget');
  const profile=validateProfile(json(data.get(m.character.profile), LIMITS.profileBytes));
  const motion=validateMotion(json(data.get(m.motion), LIMITS.motionBytes), profile, m.equipment);
  const clipResult=m.clips===undefined?{library:null,clipKeyScalars:0}:validateClipLibrary(json(data.get(m.clips),LIMITS.clipBytes),profile,m.equipment);
  for(const c of m.requiredCapabilities)if(['skeletal-delta', 'expression-single-path', 'rigid-socket'].includes(c)&&!profile.capabilities.includes(c))fail('UNBOUND_CAPABILITY', c);
  for(const item of m.equipment)if(audits.get(item.asset).document.skins?.length)fail('UNSUPPORTED', 'Skinned equipment adapter missing');
  const definitions= {
    vertices, nodes, deformedVertices
  };
  vertices=0;
  nodes=1;
  deformedVertices=0;
  for(const id of [m.character.asset, ...m.equipment.map(x=>x.asset)]) {
    const a=audits.get(id);
    vertices+=a.renderVertices;
    nodes+=a.nodes+1;
    deformedVertices+=a.renderDeformedVertices;
  }
  nodes+=2*m.equipment.length;
  if(vertices>m.budgets.vertices||nodes>m.budgets.nodes||deformedVertices>LIMITS.deformedVertices)fail('LIMIT', 'Resolved instance budget');
  check();
  // Public metadata cannot diverge from the reserved instance cost. Byte views
  // are copy-on-read; Object.freeze(Map/TypedArray) alone would not protect them.
  const privateBytes=data;
  for(const audit of audits.values())deepFreeze(audit);
  const result=Object.freeze({
    manifest:deepFreeze(m), profile:deepFreeze(profile), motion:deepFreeze(motion), clips:deepFreeze(clipResult.library), data:readonlyMap(privateBytes,true), audits:readonlyMap(audits), budget:deepFreeze({
      vertices, nodes, deformedVertices, clipKeyScalars:clipResult.clipKeyScalars, textureBytes:0, definitions
    })
  });
  const sources=new Map();
  for(const id of [m.character.asset, ...m.equipment.map(x=>x.asset)]) {
    const a=m.assets.find(x=>x.id===id);
    sources.set('gltf-0.1.0:'+a.sha256, Object.freeze({key:'gltf-0.1.0:'+a.sha256, bytes:a.bytes, decodedBytes:decodedArrayReservation(a.bytes,audits.get(id).document)}));
  }
  if(m.clips!==undefined) {
    const a=m.assets.find(x=>x.id===m.clips),key='clips-0.1.0:'+a.sha256;
    sources.set(key,Object.freeze({key,bytes:a.bytes,decodedBytes:0}));
  }
  privatePreparedBytes.set(result,privateBytes);
  admissionRecords.set(result, Object.freeze({vertices,nodes,deformedVertices,clipKeyScalars:clipResult.clipKeyScalars,sources:Object.freeze([...sources.values()])}));
  return result;
}
export async function prepareNeutralPack(read,{signal}={}) {
  const check=()=>{if(signal?.aborted)throw signal.reason??new Error('Aborted');};
  check();
  const manifest=validateNeutralManifest(json(await read('manifest.json',LIMITS.manifestBytes,signal),LIMITS.manifestBytes));
  const data=new Map(),audits=new Map();
  for(const asset of manifest.assets) {
    check();const incoming=await read(asset.path,asset.bytes,signal);check();
    if(!(incoming instanceof Uint8Array)||incoming.byteLength!==asset.bytes)fail('INTEGRITY',asset.id);
    const bytes=Uint8Array.from(incoming);
    if(await sha256(bytes)!==asset.sha256)fail('INTEGRITY',asset.id);
    data.set(asset.id,bytes);
    if(asset.kind==='glb')audits.set(asset.id,preflightArtGLB(bytes,manifest.budgets));
  }
  const asset=manifest.assets.find(a=>a.id===manifest.character.asset),audit=audits.get(asset.id);
  const profile=validateNeutralProfile(json(data.get(manifest.character.profile),LIMITS.profileBytes),asset.sha256,audit.document);
  const vertices=audit.renderVertices,nodes=audit.nodes+2,deformedVertices=audit.renderDeformedVertices;
  const decodedReservation=decodedArrayReservation(asset.bytes,audit.document);
  if(decodedReservation>manifest.budgets.decodedArrayBytes)fail('LIMIT','Neutral decoded geometry reservation');
  if(vertices>manifest.budgets.vertices||nodes>manifest.budgets.nodes||deformedVertices>manifest.budgets.deformedVertices)fail('LIMIT','Neutral instance budget');
  check();for(const a of audits.values())deepFreeze(a);
  const pack=Object.freeze({kind:'approved-art-neutral',manifest:deepFreeze(manifest),profile:deepFreeze(profile),data:readonlyMap(data,true),audits:readonlyMap(audits),budget:deepFreeze({vertices,nodes,deformedVertices,clipKeyScalars:0,textureBytes:0,decodedArrayReservation:decodedReservation})});
  privatePreparedBytes.set(pack,data);
  const key='neutral-gltf-0.1.0:'+asset.sha256;
  admissionRecords.set(pack,Object.freeze({vertices,nodes,deformedVertices,clipKeyScalars:0,sources:Object.freeze([Object.freeze({key,bytes:asset.bytes,decodedBytes:decodedReservation})])}));
  return pack;
}
export async function acquireNeutralGLB(pack,cache,options={}) {
  if(pack.kind!=='approved-art-neutral'||!privatePreparedBytes.has(pack))fail('BINDING','Prepared neutral pack required');
  const asset=pack.manifest.assets.find(a=>a.id===pack.manifest.character.asset),key='neutral-gltf-0.1.0:'+asset.sha256;
  return cache.acquire(key,async()=>{
    const bytes=privatePreparedBytes.get(pack).get(asset.id);
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    try {
      const verification=verifyNeutralSource(bytes,pack.audits.get(asset.id),gltf,pack.budget.decodedArrayReservation);
      return {gltf,verification,dispose:()=>disposeSource(gltf.scene)};
    } catch(error) {disposeSource(gltf.scene);throw error;}
  },options);
}
export async function prepareFacePack(read,{signal}={}) {
  const check=()=>{if(signal?.aborted)throw signal.reason??new Error('Aborted');};
  check();const manifest=validateFaceManifest(json(await read('manifest.json',LIMITS.manifestBytes,signal),LIMITS.manifestBytes));
  const data=new Map(),audits=new Map();
  for(const asset of manifest.assets) {
    check();const incoming=await read(asset.path,asset.bytes,signal);check();
    if(!(incoming instanceof Uint8Array)||incoming.byteLength!==asset.bytes)fail('INTEGRITY',asset.id);
    const bytes=Uint8Array.from(incoming);if(await sha256(bytes)!==asset.sha256)fail('INTEGRITY',asset.id);
    data.set(asset.id,bytes);if(asset.kind==='glb')audits.set(asset.id,preflightFaceGLB(bytes,manifest.budgets));
  }
  const asset=manifest.assets.find(a=>a.id===manifest.character.asset),audit=audits.get(asset.id);
  const profile=validateFaceProfile(json(data.get(manifest.character.profile),LIMITS.profileBytes),asset.sha256,audit.document);
  const vertices=audit.renderVertices,nodes=audit.nodes+2,deformedVertices=audit.renderDeformedVertices,decodedReservation=decodedArrayReservation(asset.bytes,audit.document);
  if(vertices>manifest.budgets.vertices||nodes>manifest.budgets.nodes||deformedVertices>manifest.budgets.deformedVertices||decodedReservation>manifest.budgets.decodedArrayBytes)fail('LIMIT','Face instance/decoded budget');
  check();for(const a of audits.values())deepFreeze(a);
  const pack=Object.freeze({kind:'approved-single-face-paths',manifest:deepFreeze(manifest),profile:deepFreeze(profile),data:readonlyMap(data,true),audits:readonlyMap(audits),budget:deepFreeze({vertices,nodes,deformedVertices,clipKeyScalars:0,textureBytes:0,decodedArrayReservation:decodedReservation})});
  privatePreparedBytes.set(pack,data);
  const key='face-gltf-0.1.0:'+asset.sha256;
  admissionRecords.set(pack,Object.freeze({vertices,nodes,deformedVertices,clipKeyScalars:0,sources:Object.freeze([Object.freeze({key,bytes:asset.bytes,decodedBytes:decodedReservation})])}));
  return pack;
}
export async function acquireFaceGLB(pack,cache,options={}) {
  if(pack.kind!=='approved-single-face-paths'||!privatePreparedBytes.has(pack))fail('BINDING','Prepared single-face pack required');
  const asset=pack.manifest.assets.find(a=>a.id===pack.manifest.character.asset),key='face-gltf-0.1.0:'+asset.sha256;
  return cache.acquire(key,async()=>{
    const bytes=privatePreparedBytes.get(pack).get(asset.id);
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    try {
      const verification=verifyNeutralSource(bytes,pack.audits.get(asset.id),gltf,pack.budget.decodedArrayReservation);
      return {gltf,verification,dispose:()=>disposeSource(gltf.scene)};
    }catch(error){disposeSource(gltf.scene);throw error;}
  },options);
}
function disposeSource(scene) {
  const gs=new Set(), ms=new Set(), ss=new Set();
  scene.traverse(o=> {
    if(o.geometry)gs.add(o.geometry);
    if(o.skeleton)ss.add(o.skeleton);
    for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])ms.add(m);
  });
  for(const x of ss)x.dispose();
  for(const x of gs)x.dispose();
  for(const x of ms)x.dispose();
}
export async function acquireGLB(pack, id, cache, options= {
}) {
  const asset=pack.manifest.assets.find(x=>x.id===id);
  if(asset?.kind!=='glb'||!pack.audits.has(id))fail('REFERENCE', 'Preflight GLB required');
  const key='gltf-0.1.0:'+asset.sha256;
  return cache.acquire(key, async()=> {
    const bytes=privatePreparedBytes.get(pack)?.get(id)??pack.data.get(id);
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), '');
    const allowance=decodedArrayReservation(asset.bytes,pack.audits.get(id).document);
    if(geometryBackingBytes(gltf.scene)>allowance){disposeSource(gltf.scene);fail('LIMIT','Decoded geometry array reservation');}
    return {
      gltf, dispose:()=>disposeSource(gltf.scene)
    };
  }, options);
}
/** Streaming browser reader bounds bytes before concatenation. No network URLs from manifests. */
export function browserPackReader(baseURL) {
  const base=new URL(baseURL, location.href);
  if(base.origin!==location.origin)fail('PATH', 'Pack origin');
  return async(path, max, signal)=> {
    const u=new URL(path, base);
    if(u.origin!==base.origin||!u.pathname.startsWith(base.pathname))fail('PATH', 'Outside pack');
    const r=await fetch(u, {
      signal, credentials:'same-origin', redirect:'error'
    });
    if(!r.ok)throw Error('HTTP '+r.status);
    if(Number(r.headers.get('content-length')??0)>max)fail('LIMIT', 'Response length');
    const reader=r.body.getReader(), chunks=[];
    let size=0;
    try {
      for(;
      ;
      ) {
        const {
          done, value
        }
        =await reader.read();
        if(done)break;
        size+=value.length;
        if(size>max)fail('LIMIT', 'Streaming byte limit');
        chunks.push(value);
      }
    }
    catch(e) {
      await reader.cancel();
      throw e;
    }
    const b=new Uint8Array(size);
    let at=0;
    for(const c of chunks) {
      b.set(c, at);
      at+=c.length;
    }
    return b;
  };
}
