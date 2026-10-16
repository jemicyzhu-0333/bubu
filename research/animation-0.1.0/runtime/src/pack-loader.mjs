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
    const b=await read(a.path, a.bytes, signal);
    check();
    if(!(b instanceof Uint8Array)||b.byteLength!==a.bytes||await sha256(b)!==a.sha256)fail('INTEGRITY', a.id);
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
  return {
    manifest:m, profile, motion, data, audits, budget: {
      vertices, nodes, deformedVertices, textureBytes:0, definitions
    }
  };
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
    const bytes=pack.data.get(id);
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), '');
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
