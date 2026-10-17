import {APPROVED_FULL_FACE_SOURCE,FULL_FACE_PROFILE_SHA256} from './approved-full-face-source.mjs';
import {exact,fail,str,path,unique,LIMITS} from './contracts.mjs';
import {FACE_LIMITS,FULL_FACE_LIMITS} from './art-glb-preflight.mjs';
import {APPROVED_FACE_SOURCE} from './approved-face-source.mjs';
export const FACE_ROSTER=Object.freeze(['A_eye_highlight_L','A_eye_highlight_R','A_eye_L','A_eye_R','A_mouth_ring','A_brow_L','A_brow_R','A_tongue']);
export const FACE_SLOT_IDS=Object.freeze(['04','N3','A7','07','S5','R0','N2']);
export const FACE_PACK_LIMITS=Object.freeze({...FACE_LIMITS,decodedArrayBytes:24*1024*1024});
export const FULL_FACE_SLOT_IDS=APPROVED_FULL_FACE_SOURCE.slotIds;
export const FULL_FACE_PACK_LIMITS=Object.freeze({...FULL_FACE_LIMITS,decodedArrayBytes:38211404});
export const FULL_FACE_PURPOSE='approved-full-face-paths-opt-in';
const jointMap=Object.freeze({body:'Body',shoulderLeft:'Shoulder_L',shoulderRight:'Shoulder_R',hipLeft:'Hip_L',hipRight:'Hip_R'});
const socketMap=Object.freeze({headTouch:'HeadTouch',accessory:'AccessoryAnchor'});
const same=(actual,expected,label)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))fail('BINDING',label);};
export function validateFaceManifest(m,purpose='approved-single-face-paths') {
  if(!['approved-single-face-paths',FULL_FACE_PURPOSE].includes(purpose))fail('VERSION','Unknown face capability');
  const full=purpose===FULL_FACE_PURPOSE,source=full?APPROVED_FULL_FACE_SOURCE:APPROVED_FACE_SOURCE,limits=full?FULL_FACE_PACK_LIMITS:FACE_PACK_LIMITS;
  exact(m,['format','version','id','purpose','assets','character','budgets']);
  if(m.format!=='bubu-face-suite'||m.version!=='0.1.0'||m.purpose!==purpose)fail('VERSION','Single-face slice manifest');str(m.id);
  if(!Array.isArray(m.assets)||m.assets.length!==2)fail('REFERENCE','Exactly one fixed GLB and one profile');
  let total=0;
  for(const a of m.assets) {
    exact(a,['id','path','kind','bytes','sha256']);str(a.id);path(a.path);
    if(!['glb','profile'].includes(a.kind))fail('UNSUPPORTED','Face source kind');
    const max=a.kind==='profile'?LIMITS.profileBytes:limits.assetBytes;
    if(!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>max||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))fail('INTEGRITY','Face source declaration');total+=a.bytes;
  }
  unique(m.assets.map(a=>a.id),'asset IDs');unique(m.assets.map(a=>a.path),'asset paths');exact(m.character,['asset','profile']);
  const asset=m.assets.find(a=>a.id===m.character.asset&&a.kind==='glb');
  if(!asset||!m.assets.find(a=>a.id===m.character.profile&&a.kind==='profile'))fail('REFERENCE','Face source/profile');
  if(asset.sha256!==source.sha256)fail('UNAPPROVED_ASSET','Exact registered capability source required');
  if(full&&m.assets.find(a=>a.id===m.character.profile).sha256!==FULL_FACE_PROFILE_SHA256)fail('UNAPPROVED_ASSET','Exact full18 profile required');
  exact(m.budgets,[],Object.keys(limits));m.budgets={...limits,...m.budgets};
  for(const [k,v]of Object.entries(m.budgets))if(!Number.isSafeInteger(v)||v<1||v>limits[k])fail('LIMIT','Face budget '+k);
  if(total>m.budgets.totalBytes||asset.bytes>m.budgets.assetBytes)fail('LIMIT','Face encoded source bytes');return m;
}
export function validateFaceProfile(p,hash,doc,purpose='approved-single-face-paths') {
  if(!['approved-single-face-paths',FULL_FACE_PURPOSE].includes(purpose))fail('VERSION','Unknown face capability');
  const full=purpose===FULL_FACE_PURPOSE,source=full?APPROVED_FULL_FACE_SOURCE:APPROVED_FACE_SOURCE,slotIds=full?FULL_FACE_SLOT_IDS:FACE_SLOT_IDS;
  exact(p,['format','version','purpose','sourceSha256','root','body','faceMeshes','joints','sockets','basis','semanticDefault','hiddenBasisLayers','paths','readiness']);
  if(p.format!=='bubu-face-profile'||p.version!=='0.1.0'||p.purpose!==purpose)fail('VERSION','Face profile');
  if(hash!==source.sha256||p.sourceSha256!==hash)fail('UNAPPROVED_ASSET','Face profile source');
  if(p.root!=='A_reference_root'||p.body!=='A_mochi_skin')fail('BINDING','Source root/body');
  same(p.faceMeshes,FACE_ROSTER,'Complete eight-layer face roster');same(p.joints,jointMap,'Five immutable joint bindings');same(p.sockets,socketMap,'Two immutable socket bindings');
  if(p.basis!=='approved05-original-small-o'||p.semanticDefault!=='R0')fail('BINDING','Basis and R0 are distinct');
  same(p.hiddenBasisLayers,['A_brow_L','A_brow_R','A_tongue'],'Explicit hidden Basis layers');
  exact(p.readiness,['engine','binding','verified']);
  if(p.readiness.engine!=='single-semantic-path'||p.readiness.binding!==(full?'fixed-eighteen-slot-opt-in':'fixed-seven-slot-slice')||p.readiness.verified!=='source-parity-and-scalar-clock')fail('UNSUPPORTED','Readiness cannot authorize interaction or GPU appearance');
  if(!Array.isArray(p.paths)||p.paths.length!==slotIds.length)fail('BINDING','Complete explicit capability slots required');
  same(p.paths.map(x=>x.id),slotIds,'Slot ordering/version');
  const allTargets=[];
  for(const entry of p.paths) {
    exact(entry,['id','meaning','knots']);
    const expected=source.paths[entry.id];
    if(!expected||entry.meaning!==expected.meaning)fail('BINDING','Reviewed semantic meaning');
    if(!Array.isArray(entry.knots)||entry.knots.length!==8)fail('BINDING','Eight authored knots');
    entry.knots.forEach((k,i)=>{exact(k,['at','target']);if(k.at!==(i+1)/8||k.target!==expected.targets[i])fail('BINDING','Authored knot mapping');allTargets.push(k.target);});
  }
  unique(allTargets,'Global semantic target ownership');
  const nodes=new Map(doc.nodes.map(n=>[n.name,n])),meshSet=new Set([p.body,...FACE_ROSTER]);
  for(const name of [p.root,...meshSet,...Object.values(jointMap),...Object.values(socketMap)])if(!nodes.has(name))fail('BINDING','Missing '+name);
  for(const node of doc.nodes)if(node.mesh!==undefined) {
    if(!meshSet.has(node.name)||node.skin!==0)fail('BINDING','Unexpected/non-skinned mesh '+node.name);
    const mesh=doc.meshes[node.mesh],primitive=mesh.primitives[0];
    if(node.name===p.body) {
      if(primitive.targets?.length||mesh.weights?.length)fail('BINDING','Body must remain unmorphed');
    } else {
      same(mesh.extras?.targetNames,allTargets,'Complete mapped targets '+node.name);
      if(primitive.targets?.length!==allTargets.length)fail('BINDING','Face target count');
      for(const target of primitive.targets)if(!Object.hasOwn(target,'POSITION')||!Object.hasOwn(target,'NORMAL'))fail('BINDING','Authoritative POSITION and NORMAL required');
    }
  }
  if(doc.skins?.length!==1)fail('BINDING','One shared source skin');
  const jointNames=doc.skins[0].joints.map(i=>doc.nodes[i].name),wanted=[...Object.values(jointMap),...Object.values(socketMap)];
  if(jointNames.length!==7||wanted.some(name=>!jointNames.includes(name)))fail('BINDING','Complete source rig');
  return p;
}
