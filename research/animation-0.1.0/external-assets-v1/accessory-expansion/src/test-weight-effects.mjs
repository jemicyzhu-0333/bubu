import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {AccessoryAdapter,disposeAsset} from './accessory-adapter.mjs';import {paths} from '../../shared/paths.mjs';
const cfg=paths();const {fixture}=await import(cfg.research+'/petting-continuous-r2/tools/fixture.mjs');const f=await fixture();
async function load(file){const b=fs.readFileSync(new URL('../models/'+file,import.meta.url));return(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
for(const [kind,file] of [['halo','05-halo.glb'],['boots','06-boots.glb']]){
 const asset=await load(file),original=[];asset.traverse(m=>{if(m.isMesh)original.push({mesh:m,geometry:m.geometry,material:m.material,color:m.geometry.attributes.color?.array.slice()});});
 const make=()=>new AccessoryAdapter({kind,asset,sourceSkin:f.h.body.skin,parent:f.h.body.root,assertSourceCurrent:()=>f.h.owner.assertCurrent(),occludedFeet:kind==='boots'?['left','right'].map(side=>{const m=new T.SkinnedMesh(asset.getObjectByName('boots_'+side).geometry,new T.MeshBasicMaterial());m.name='Bubu_foot-'+side;m.bind(f.h.body.skin.skeleton,f.h.body.skin.bindMatrix);return m;}):[]});
 const a=make(),b=make();a.update({time:.7});b.update({time:0});
 if(kind==='halo'){assert.notEqual(a.parts[0].material.emissiveIntensity,b.parts[0].material.emissiveIntensity);assert.notEqual(a.parts[0].material,original[0].material);a.update({time:4,calmVisual:true});assert.equal(a.parts[0].material.emissiveIntensity,.18);}
 else{assert.notDeepEqual(Array.from(a.parts[0].geometry.attributes.color.array),Array.from(b.parts[0].geometry.attributes.color.array));assert.ok(a.feet.every(f=>f.mesh.visible));a.update({time:4,reducedMotion:true});for(const p of original)assert.deepEqual(p.mesh.geometry.attributes.color.array,p.color);}
 for(const row of original){assert.equal(row.mesh.geometry,row.geometry);assert.equal(row.mesh.material,row.material);}
 a.dispose();b.dispose();disposeAsset(asset);
}
f.h.dispose();console.log('PASS per-actor halo glow and boot-star glint isolation, calm/reduced motion, native foot retention, borrowed-resource integrity');
