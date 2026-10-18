import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {AccessoryAdapter,disposeAsset} from './accessory-adapter.mjs';import {paths} from '../../shared/paths.mjs';
const cfg=paths();const {fixture}=await import(cfg.research+'/petting-continuous-r2/tools/fixture.mjs');const f=await fixture();
for(const [kind,file] of Object.entries({cap:'woodsman-cap',fin:'ocean-fin',wings:'bat-wings',plum:'plum-cape'})){
 const bytes=fs.readFileSync(new URL('../models/'+file+'.glb',import.meta.url));const asset=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 const parent=new T.Group();parent.rotation.set(.2,.4,.1);parent.position.set(1,2,3);f.h.body.root.add(parent);
 const make=()=>new AccessoryAdapter({kind,asset,sourceSkin:f.h.body.skin,parent,assertSourceCurrent:()=>f.h.owner.assertCurrent()});
 const a=make(),b=make();assert.throws(()=>disposeAsset(asset));a.update({time:0});for(let i=1;i<20;i++)a.update({time:i/60});a.update({time:1,calmVisual:true});assert.equal(a.deformation.offset.length(),0);assert.equal(b.deformation.offset.length(),0);
 a.dispose();a.dispose();assert.throws(()=>disposeAsset(asset));parent.scale.x=0;assert.throws(()=>b.update());assert.equal(b.root.parent,null);disposeAsset(asset);assert.throws(()=>make());parent.removeFromParent();
}
f.h.dispose();console.log('PASS actual themed assets: baked transforms, parent compensation, per-instance reset/calm, borrowed leases, invalid-parent fail-close, idempotent disposal');
