// Portable import-layout adaptation only; original probe preserved in evidence/review.
import assert from 'node:assert/strict';
const base=new URL('../../',import.meta.url);
const T=await import('three');
const {ActorPool}=await import(new URL('runtime-facepath05/src/actor-pool.mjs',base));
const {prepareD2FacePack}=await import(new URL('runtime-facepath05/src/pack-loader.mjs',base));
const {localPackReader}=await import(new URL('runtime-facepath05/tools/read-local-pack.mjs',base));
const {BODY_PROFILE_ID}=await import(new URL('runtime-facepath05/src/body-profile.mjs',base));
const pack=await prepareD2FacePack(localPackReader(new URL('runtime-facepath05/fixtures/face-d2/',base).pathname));
const policy={format:'bubu-expression-scheduler',version:'0.1.0-p1',sourceSha256:pack.profile.sourceSha256,profileSha256:pack.manifest.assets.find(x=>x.kind==='profile').sha256,rng:{algorithm:'xorshift32-split-v1',seed:42},candidates:[{key:'R0',faceId:'R0',amount:1,selectionWeight:1,enterSec:.1,exitSec:.1,hold:{kind:'fixed',sec:1},gap:{kind:'fixed',sec:.1},cooldownSec:0,sources:['testfixture']}],contexts:[{key:'none',candidates:[],excludeRecent:0}]};
const facts={context:'none',source:'testfixture',enabled:false,interactionOwned:false};
const strict=new ActorPool(),body=new ActorPool({bodyProfile:BODY_PROFILE_ID,limits:{deformedVertices:1568280}});
try{
 const plain=await strict.createWeighted(pack,policy,{initialFacts:facts});const bone=plain.root.getObjectByName('Shoulder_L');bone.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.01));assert.throws(()=>plain.assertCurrent(),{code:'FACE_INVARIANT'});plain.dispose();
 await assert.rejects(body.create(pack),{code:'BODY_CAPABILITY'});assert.equal(body.stats.active,0);
 const a=await body.createWeighted(pack,policy,{initialFacts:facts}),b=await body.createWeighted(pack,policy,{initialFacts:facts});const shoulder=a.root.getObjectByName('Shoulder_L'),hip=a.root.getObjectByName('Hip_L'),other=a.root.getObjectByName('Body');
 const sq=shoulder.quaternion.clone(),hq=hip.quaternion.clone(),oq=other.quaternion.clone();
 shoulder.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),.19));a.assertCurrent();b.assertCurrent();
 shoulder.quaternion.copy(sq).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.201));assert.throws(()=>a.assertCurrent(),{code:'BODY_INVARIANT'});shoulder.quaternion.copy(sq);
 hip.quaternion.copy(hq).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.141));assert.throws(()=>a.assertCurrent(),{code:'BODY_INVARIANT'});hip.quaternion.copy(hq);
 shoulder.position.x+=.01;assert.throws(()=>a.assertCurrent(),{code:'FACE_INVARIANT'});shoulder.position.x-=.01;
 other.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.01));assert.throws(()=>a.assertCurrent(),{code:'FACE_INVARIANT'});other.quaternion.copy(oq);a.assertCurrent();
 assert.equal(a.root.getObjectByName('A_mouth_ring').geometry,b.root.getObjectByName('A_mouth_ring').geometry);assert.notEqual(a.root.getObjectByName('A_mouth_ring').material,b.root.getObjectByName('A_mouth_ring').material);a.dispose();b.assertCurrent();b.dispose();assert.equal(body.stats.cache.live,0);console.log(JSON.stringify({strictFaceRest:true,weightedOnly:true,boundedFourBones:true,translationAndOtherBonesRejected:true,multiActorIsolation:true,cleanup:true}));
}finally{strict.dispose();body.dispose();}
