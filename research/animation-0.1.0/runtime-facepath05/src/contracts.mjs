export class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name='ContractError';
    this.code=code;
  }
}
export const fail=(code, message)=> {
  throw new ContractError(code, message);
};
export const ENGINE_CAPABILITIES=Object.freeze(['skeletal-delta', 'expression-single-path', 'rigid-socket', 'accessory-local-rotation', 'canonical-events', 'interrupt-c0', 'demand-render', 'authored-quaternion-clips']);
export const LIMITS=Object.freeze({
  manifestBytes:65536, profileBytes:131072, motionBytes:262144, clipBytes:131072, clips:16, clipTracks:72, keysPerTrack:128, clipKeys:2048, clipKeyScalars:10240, assetBytes:8388608, totalBytes:33554432, assets:16, jsonDepth:20, jsonEntries:20000, nodes:128, meshes:32, primitives:64, vertices:100000, deformedVertices:500000, indices:300000, morphTargets:16, accessors:512, bufferViews:512, accessorScalars:2000000, joints:64, segments:64, queue:128
});
export function exact(o, required, optional=[], where='object') {
  if(!o||typeof o!=='object'||Array.isArray(o))fail('TYPE', where+' must be an object');
  for(const k of required)if(!Object.hasOwn(o, k))fail('MISSING', where+'.'+k);
  for(const k of Object.keys(o))if(!required.includes(k)&&!optional.includes(k))fail('UNKNOWN_FIELD', where+'.'+k);
  return o;
}
export function str(s, where='string') {
  if(typeof s!=='string'||!s.length||s.length>160)fail('TYPE', where);
  return s;
}
export function num(n, lo, hi, where='number') {
  if(!Number.isFinite(n)||n<lo||n>hi)fail('RANGE', where);
  return n;
}
export function list(a, max, where='array') {
  if(!Array.isArray(a)||a.length>max)fail('LIMIT', where);
  return a;
}
export function vec(a, n, lo=-1e6, hi=1e6) {
  list(a, n);
  if(a.length!==n)fail('TYPE', 'vector dimension');
  a.forEach(v=>num(v, lo, hi));
  return a;
}
export function quat(a) {
  vec(a, 4, -1, 1);
  if(Math.abs(Math.hypot(...a)-1)>1e-5)fail('QUATERNION', 'quaternion must be normalized');
  return a;
}
export function unique(a, where) {
  if(new Set(a).size!==a.length)fail('DUPLICATE', where);
}
export function member(s, a, where) {
  if(!a.includes(s))fail('UNSUPPORTED', where+': '+s);
  return s;
}
export function path(p) {
  str(p, 'path');
  if(p.length>128||!p.split('/').every(x=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x)&&x!=='.'&&x!=='..'))fail('PATH', 'Unsafe package path');
  return p;
}
export function json(bytes, max, complexity=LIMITS) {
  if(bytes.byteLength>max)fail('LIMIT', 'JSON byte budget');
  let o;
  try {
    o=JSON.parse(new TextDecoder('utf-8', {
      fatal:true
    }).decode(bytes));
  }
  catch {
    fail('JSON', 'Invalid UTF-8 JSON');
  }
  let count=0;
  const stack=[[o, 0]];
  while(stack.length) {
    const[v, d]=stack.pop();
    if(d>complexity.jsonDepth||++count>complexity.jsonEntries)fail('LIMIT', 'JSON complexity');
    if(v&&typeof v==='object')for(const x of Object.values(v))stack.push([x, d+1]);
  }
  return o;
}
function version(o, format) {
  if(o.format!==format||o.version!=='0.1.0')fail('VERSION', 'Only '+format+' 0.1.0 is supported');
}
export function validateManifest(m) {
  exact(m, ['format', 'version', 'id', 'assets', 'character', 'equipment', 'motion', 'requiredCapabilities', 'budgets'],['clips']);
  version(m, 'bubu-suite');
  str(m.id);
  list(m.assets, LIMITS.assets);
  if(!m.assets.length)fail('MISSING', 'assets');
  let bytes=0;
  for(const a of m.assets) {
    exact(a, ['id', 'path', 'kind', 'bytes', 'sha256']);
    str(a.id);
    path(a.path);
    member(a.kind, ['glb', 'profile', 'motion', 'clips'], 'asset kind');
    num(a.bytes, 1, LIMITS.assetBytes);
    if(a.kind==='clips')num(a.bytes,1,LIMITS.clipBytes,'Clip library byte budget');
    if(!Number.isInteger(a.bytes)||!/^[0-9a-f]{64}$/.test(a.sha256))fail('INTEGRITY', 'Asset size/hash');
    bytes+=a.bytes;
  }
  unique(m.assets.map(a=>a.id), 'asset ids');
  unique(m.assets.map(a=>a.path), 'asset paths');
  exact(m.character, ['asset', 'profile']);
  const ids=new Map(m.assets.map(a=>[a.id, a]));
  const need=(id, kind)=> {
    if(ids.get(id)?.kind!==kind)fail('REFERENCE', id+' expected '+kind);
  };
  need(m.character.asset, 'glb');
  need(m.character.profile, 'profile');
  need(m.motion, 'motion');
  if(m.clips!==undefined)need(m.clips,'clips');
  if(m.assets.some(a=>a.kind==='clips'&&a.id!==m.clips))fail('REFERENCE','Unreferenced clip library');
  list(m.equipment, 8);
  for(const e of m.equipment) {
    exact(e, ['id', 'asset', 'slot', 'fit', 'attachment', 'collision', 'support']);
    str(e.id);
    str(e.slot);
    need(e.asset, 'glb');
    exact(e.fit, ['position', 'rotation', 'scale']);
    vec(e.fit.position, 3);
    quat(e.fit.rotation);
    num(e.fit.scale, .01, 10);
    member(e.attachment, ['rigid-socket'], 'attachment');
    member(e.collision, ['unverified-no-solver'], 'collision');
    member(e.support, ['none'], 'equipment support');
  }
  unique(m.equipment.map(x=>x.id), 'equipment ids');
  list(m.requiredCapabilities, ENGINE_CAPABILITIES.length);
  unique(m.requiredCapabilities, 'capabilities');
  for(const c of m.requiredCapabilities)member(c, ENGINE_CAPABILITIES, 'engine capability');
  if(m.clips!==undefined&&!m.requiredCapabilities.includes('authored-quaternion-clips'))fail('UNBOUND_CAPABILITY','authored-quaternion-clips');
  exact(m.budgets, ['totalBytes', 'vertices', 'nodes']);
  num(m.budgets.totalBytes, 1, LIMITS.totalBytes);
  num(m.budgets.vertices, 1, LIMITS.vertices);
  num(m.budgets.nodes, 1, LIMITS.nodes);
  if(bytes>m.budgets.totalBytes)fail('LIMIT', 'package byte budget');
  return m;
}
export function validateProfile(p) {
  exact(p, ['format', 'version', 'id', 'purpose', 'coordinates', 'joints', 'sockets', 'expressions', 'capabilities', 'verification']);
  version(p, 'bubu-character-profile');
  str(p.id);
  member(p.purpose, ['mechanics-fixture'], 'profile activation');
  exact(p.coordinates, ['up', 'front', 'unitScale']);
  if(p.coordinates.up!=='+Y'||p.coordinates.front!=='+Z')fail('COORDINATES', 'Unsupported coordinate frame');
  num(p.coordinates.unitScale, 1, 1);
  list(p.joints, LIMITS.joints);
  for(const b of p.joints) {
    exact(b, ['id', 'node', 'capRadians']);
    str(b.id);
    str(b.node);
    num(b.capRadians, 0, .5);
  }
  unique(p.joints.map(x=>x.id), 'joint ids');
  unique(p.joints.map(x=>x.node), 'joint bindings');
  list(p.sockets, 16);
  for(const s of p.sockets) {
    exact(s, ['id', 'node']);
    str(s.id);
    str(s.node);
  }
  unique(p.sockets.map(x=>x.id), 'socket ids');
  exact(p.expressions, ['policy', 'meshes', 'paths']);
  member(p.expressions.policy, ['single-path-via-neutral'], 'expression policy');
  list(p.expressions.meshes, 16);
  p.expressions.meshes.forEach(n=>str(n));
  unique(p.expressions.meshes, 'face meshes');
  list(p.expressions.paths, 8);
  for(const f of p.expressions.paths) {
    exact(f, ['id', 'knots']);
    str(f.id);
    list(f.knots, 17);
    if(f.knots.length<2)fail('PATH', 'Face path needs neutral and target');
    let prev=-1;
    for(const k of f.knots) {
      exact(k, ['at', 'targets']);
      num(k.at, 0, 1);
      if(k.at<=prev)fail('PATH', 'Increasing face knots');
      prev=k.at;
      if(!k.targets||typeof k.targets!=='object'||Array.isArray(k.targets))fail('TYPE', 'targets');
      exact(k.targets, p.expressions.meshes, [], 'knot meshes');
      for(const mesh of p.expressions.meshes) {
        const targets=k.targets[mesh];
        if(!targets||typeof targets!=='object'||Array.isArray(targets))fail('TYPE', 'mesh targets');
        let sum=0;
        for(const[n, w]of Object.entries(targets)) {
          str(n);
          sum+=num(w, 0, 1);
        }
        if(sum>1+1e-9)fail('FACE_SIMPLEX', 'Knot weights exceed one');
      }
    }
    if(f.knots[0].at!==0||Object.values(f.knots[0].targets).some(x=>Object.keys(x).length)||f.knots.at(-1).at!==1)fail('PATH', 'Face neutral/end knots');
  }
  unique(p.expressions.paths.map(x=>x.id), 'face paths');
  list(p.capabilities, ENGINE_CAPABILITIES.length);
  unique(p.capabilities, 'profile capabilities');
  for(const c of p.capabilities)member(c, ENGINE_CAPABILITIES, 'bound capability');
  exact(p.verification, ['numeric', 'visual', 'userApproval']);
  member(p.verification.numeric, ['fixture-tests-pending', 'fixture-tests-passed'], 'numeric verification');
  if(p.verification.visual!=='not-art-asset'||p.verification.userApproval!=='not-art-asset')fail('APPROVAL', 'Only mechanical fixture profile can activate');
  return p;
}
export function validateMotion(m, profile, equipment) {
  exact(m, ['format', 'version', 'id', 'segments']);
  version(m, 'bubu-motion');
  str(m.id);
  list(m.segments, LIMITS.segments);
  unique(m.segments.map(x=>x.id), 'segment ids');
  const joints=new Map(profile.joints.map(x=>[x.id, x])), faces=new Set(profile.expressions.paths.map(x=>x.id)), items=new Set(equipment.map(x=>x.id));
  for(const s of m.segments) {
    exact(s, ['id', 'durationSec', 'curve', 'joints', 'accessories'], ['expression']);
    str(s.id);
    num(s.durationSec, .02, 10);
    member(s.curve, ['smoothstep'], 'segment primitive');
    for(const k of ['joints', 'accessories'])if(!s[k]||typeof s[k]!=='object'||Array.isArray(s[k]))fail('TYPE', k);
    if(Object.keys(s.joints).length&&!profile.capabilities.includes('skeletal-delta'))fail('UNBOUND_CAPABILITY', 'skeletal-delta');
    if(s.expression&&!profile.capabilities.includes('expression-single-path'))fail('UNBOUND_CAPABILITY', 'expression-single-path');
    for(const[id, q]of Object.entries(s.joints)) {
      if(!joints.has(id))fail('REFERENCE', 'Unknown joint '+id);
      quat(q);
      if(2*Math.acos(Math.min(1, Math.abs(q[3])/Math.hypot(...q)))>joints.get(id).capRadians+1e-6)fail('JOINT_LIMIT', id);
    }
    for(const[id, q]of Object.entries(s.accessories)) {
      if(!items.has(id))fail('REFERENCE', 'Unknown accessory '+id);
      quat(q);
      if(2*Math.acos(Math.min(1, Math.abs(q[3])/Math.hypot(...q)))>.5)fail('JOINT_LIMIT', 'Accessory rotation');
    }
    if(s.expression) {
      exact(s.expression, ['path', 'intensity', 'fadeOutSec', 'fadeInSec']);
      if(!faces.has(s.expression.path))fail('REFERENCE', 'Unknown face path');
      num(s.expression.intensity, 0, 1);
      num(s.expression.fadeOutSec, .02, 1);
      num(s.expression.fadeInSec, .02, 1);
    }
  }
  return m;
}
