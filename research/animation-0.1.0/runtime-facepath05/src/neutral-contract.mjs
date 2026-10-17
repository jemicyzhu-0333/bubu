import {exact,fail,str,path,unique,json,LIMITS} from './contracts.mjs';
import {ART_LIMITS} from './art-glb-preflight.mjs';

const faceNames=['A_eye_highlight_L','A_eye_highlight_R','A_eye_L','A_eye_R','A_mouth_ring'];
const registered=Object.freeze({
  '3b7adcb303c8bd3c0dfb8976f9eb8fc0e6cefb897a7c16e99acc827385591722':Object.freeze({id:'static05',rig:'static',root:'A_reference_root',body:'A_mochi_skin',faces:faceNames,joints:{},sockets:{}}),
  'fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830':Object.freeze({id:'r6-neutral',rig:'skinned',root:'A_reference_root',body:'A_mochi_skin',faces:faceNames,joints:{body:'Body',shoulderLeft:'Shoulder_L',shoulderRight:'Shoulder_R',hipLeft:'Hip_L',hipRight:'Hip_R'},sockets:{headTouch:'HeadTouch',accessory:'AccessoryAnchor'}})
});
export const NEUTRAL_LIMITS=Object.freeze({...ART_LIMITS,decodedArrayBytes:16*1024*1024});
export function validateNeutralManifest(m) {
  exact(m,['format','version','id','purpose','assets','character','budgets']);
  if(m.format!=='bubu-neutral-suite'||m.version!=='0.1.0'||m.purpose!=='approved-art-neutral')fail('VERSION','Neutral-only 0.1.0 manifest');
  str(m.id);
  if(!Array.isArray(m.assets)||m.assets.length!==2)fail('REFERENCE','Exactly one GLB and one profile');
  let total=0;
  for(const a of m.assets) {
    exact(a,['id','path','kind','bytes','sha256']);str(a.id);path(a.path);
    if(!['glb','profile'].includes(a.kind))fail('UNSUPPORTED','Neutral asset kind');
    const max=a.kind==='profile'?LIMITS.profileBytes:ART_LIMITS.assetBytes;
    if(!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>max||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))fail('INTEGRITY','Asset declaration');
    total+=a.bytes;
  }
  unique(m.assets.map(a=>a.id),'Asset ids');unique(m.assets.map(a=>a.path),'Asset paths');
  exact(m.character,['asset','profile']);
  const asset=m.assets.find(a=>a.id===m.character.asset&&a.kind==='glb');
  if(!asset||!m.assets.find(a=>a.id===m.character.profile&&a.kind==='profile'))fail('REFERENCE','Neutral character');
  if(!registered[asset.sha256])fail('UNAPPROVED_ASSET','Only fixed static05/r6 neutral references');
  exact(m.budgets,[],Object.keys(NEUTRAL_LIMITS));
  m.budgets={...NEUTRAL_LIMITS,...m.budgets};
  for(const [k,v]of Object.entries(m.budgets))if(!Number.isSafeInteger(v)||v<1||v>NEUTRAL_LIMITS[k])fail('LIMIT','Neutral budget '+k);
  if(total>m.budgets.totalBytes||asset.bytes>m.budgets.assetBytes)fail('LIMIT','Neutral source bytes');
  return m;
}
export function validateNeutralProfile(p,hash,doc) {
  exact(p,['format','version','purpose','sourceSha256','rig','root','body','faces','joints','sockets','readiness']);
  if(p.format!=='bubu-neutral-profile'||p.version!=='0.1.0'||p.purpose!=='approved-art-neutral')fail('VERSION','Neutral profile');
  if(p.sourceSha256!==hash||!registered[hash])fail('UNAPPROVED_ASSET','Profile source');
  const r=registered[hash];
  for(const k of ['rig','root','body'])if(p[k]!==r[k])fail('BINDING','Neutral '+k);
  if(!Array.isArray(p.faces)||JSON.stringify(p.faces)!==JSON.stringify(r.faces))fail('BINDING','Complete face roster');
  for(const k of ['joints','sockets']) {
    exact(p[k],Object.keys(r[k]));
    for(const [id,node]of Object.entries(r[k]))if(p[k][id]!==node)fail('BINDING','Neutral '+id);
  }
  exact(p.readiness,['engine','binding','verified']);
  if(p.readiness.engine!=='neutral-load-only'||p.readiness.binding!=='hash-locked-rest'||p.readiness.verified!=='cpu-source-parity-only')fail('UNSUPPORTED','Readiness cannot authorize art motion or GPU appearance');
  const nodes=new Map(doc.nodes.map(n=>[n.name,n]));
  for(const name of [p.root,p.body,...p.faces,...Object.values(p.joints),...Object.values(p.sockets)])if(!nodes.has(name))fail('BINDING','Missing '+name);
  const expected=new Set([p.body,...p.faces]);
  for(const n of doc.nodes)if(n.mesh!==undefined&&!expected.has(n.name))fail('UNBOUND_MESH',n.name);
  for(const n of [p.body,...p.faces].map(x=>nodes.get(x)))if(n.mesh===undefined||(p.rig==='skinned')!==(n.skin!==undefined))fail('BINDING','Mesh skin role');
  if(p.rig==='static'&&(doc.skins?.length??0)!==0)fail('BINDING','Unexpected skin');
  if(p.rig==='skinned') {
    if(doc.skins?.length!==1)fail('BINDING','One source skin required');
    const jointNames=doc.skins[0].joints.map(i=>doc.nodes[i].name);
    const wanted=[...Object.values(p.joints),...Object.values(p.sockets)];
    if(jointNames.length!==wanted.length||wanted.some(n=>!jointNames.includes(n)))fail('BINDING','Complete seven-joint source skin');
  }
  return p;
}
