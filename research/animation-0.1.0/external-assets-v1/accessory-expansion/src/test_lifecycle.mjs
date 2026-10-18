import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import  {
  GLTFLoader
}
from 'three/addons/loaders/GLTFLoader.js';
import  {
  AccessoryAdapter,disposeAsset
}
from './accessory-adapter.mjs';
import {paths} from '../../shared/paths.mjs';import path from 'node:path';
const cfg=paths(),P=new URL('../',import.meta.url),R=pathToFileURL(cfg.reference+'/'),output=pathToFileURL(path.join(cfg.cache,'accessory')+'/');
fs.mkdirSync(new URL('reports/',output),{recursive:true});
const  {
  fixture
}
=await import(new URL('research/animation-0.1.0/petting-continuous-r2/tools/fixture.mjs',R));
const bytes=fs.readFileSync(new URL('models/06-boots.glb',P));
const asset=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
const a=await fixture(),b=await fixture();
const feet=new Map();
for(const f of [a,b])feet.set(f,['left','right'].map(side=> {
  const m=new T.SkinnedMesh(asset.getObjectByName('boots_'+side).geometry,new T.MeshBasicMaterial());
  m.name='Bubu_foot-'+side;
  m.bind(f.h.body.skin.skeleton,f.h.body.skin.bindMatrix);
  return m;
}
));
function options(f,parent,assetOverride=asset) {
  return {
    occludedFeet:feet.get(f),kind:'boots',sourceSkin:f.h.body.skin,parent,asset:assetOverride,assertSourceCurrent:()=>f.h.owner.assertCurrent()
  }
  ;
}
const parent=new T.Group();
parent.position.set(3,2,1);
parent.rotation.y=.6;
parent.scale.set(1.2,.8,1.4);
const first=new AccessoryAdapter(options(a,parent)),second=new AccessoryAdapter(options(b,new T.Group()));
assert.notEqual(first.parts[0].skeleton,second.parts[0].skeleton);
assert.equal(first.parts[0].skeleton,a.h.body.skin.skeleton);
assert.equal(second.parts[0].skeleton,b.h.body.skin.skeleton);
const sourceMatrix=a.h.body.skin.matrixWorld;
assert.ok(first.root.matrixWorld.elements.every((x,i)=>Math.abs(x-sourceMatrix.elements[i])<1e-10));
assert.throws(()=>disposeAsset(asset),/borrowed/);
first.dispose();
assert.ok(feet.get(a).every(m=>m.visible));
assert.ok(feet.get(b).every(m=>!m.visible));
second.update();
assert.throws(()=>disposeAsset(asset),/borrowed/);
const altered=asset.clone(true);
altered.children[0].position.x=.1;
const cleanParent=new T.Group();
assert.throws(()=>new AccessoryAdapter(options(a,cleanParent,altered)),/identity/);
assert.equal(cleanParent.children.length,0);
const singular=new T.Group();
singular.scale.x=0;
assert.throws(()=>new AccessoryAdapter(options(a,singular)),/singular/);
assert.equal(singular.children.length,0);
second.parent.scale.y=0;
assert.throws(()=>second.update(),/singular/);
assert.equal(second.root.parent,null);
assert.equal(second.disposed,true);
feet.get(a)[0].visible=false;
const thirdParent=new T.Group();
const third=new AccessoryAdapter(options(a,thirdParent));
assert.throws(()=>new AccessoryAdapter(options(a,new T.Group())),/unowned/);
third.update({enabled:false});
assert.equal(feet.get(a)[0].visible,false);
assert.equal(feet.get(a)[1].visible,true);
third.update();
third.dispose();
third.dispose();
assert.equal(feet.get(a)[0].visible,false);
assert.equal(feet.get(a)[1].visible,true);
const replacement=new AccessoryAdapter(options(a,thirdParent));
replacement.dispose();
assert.equal(thirdParent.children.length,0);
let guards=0;
assert.throws(()=>new AccessoryAdapter({...options(a,thirdParent),assertSourceCurrent:()=>{if(++guards>1)throw new Error('injected failure');}}),/injected/);
assert.equal(thirdParent.children.length,0);
assert.equal(feet.get(a)[0].visible,false);
assert.equal(feet.get(a)[1].visible,true);
const release=disposeAsset(asset);
assert.throws(()=>new AccessoryAdapter(options(a,new T.Group())),/released/);
a.h.dispose();
b.h.dispose();
assert.equal(a.h.pool.stats.actors,0);
assert.equal(b.h.pool.stats.actors,0);
fs.writeFileSync(new URL('reports/lifecycle-edge-cases.json',output),JSON.stringify( {
  sameActorDuplicateLeaseRejected:true,preHiddenVisibilityPreserved:true,repeatedUnequipAndReplacement:true,lateConstructorFailureRestoresMask:true,otherActorUnaffected:true,separateActorSkeletons:true,nonIdentityParentRoundtrip:true,nonIdentityAssetRejected:true,constructorFailureNoResidual:true,singularParentFailsClosed:true,lastBorrowerReleaseEnforced:true,release
}
,null,2));
console.log('Lifecycle edge cases passed');
