import fs from 'node:fs/promises';import assert from 'node:assert/strict';import crypto from 'node:crypto';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {SproutAdapter} from './sprout-adapter.mjs';
const here=new URL('../',import.meta.url),workspace=new URL('../../../',import.meta.url);
const source=process.env.BUBU_BODY_GLB?new URL('file://'+process.env.BUBU_BODY_GLB):new URL('runtime-facepath05/fixtures/face-d2/asset.glb',workspace);
async function load(url){const b=await fs.readFile(url);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const body=await load(source),asset=await load(new URL('sprout.glb',here));const parent=new T.Group();parent.add(body.scene);
const before=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');const meshes=[];body.scene.traverse(o=>{if(o.isMesh)meshes.push({o,g:o.geometry,m:o.material,positions:Array.from(o.geometry.attributes.position.array)});});
const a=new SproutAdapter({actorRoot:body.scene,parent,asset:asset.scene});let maxError=0,maxSway=0;
for(let i=0;i<=360;i++){
 const t=i/30;parent.rotation.set(.08*Math.sin(t),t,.06*Math.cos(t));parent.position.set(.2*Math.sin(t),.1,0);parent.updateMatrixWorld(true);maxSway=Math.max(maxSway,Math.abs(a.update(t)));
 const surface=a.skin.localToWorld(a.skin.getVertexPosition(a.vertex,new T.Vector3()));maxError=Math.max(maxError,surface.distanceTo(a.root.getWorldPosition(new T.Vector3())));
}
assert.ok(maxError<1e-6);assert.ok(maxSway<=.06+1e-12);assert.equal(a.update(1,{reducedMotion:true}),0);a.update(1,{enabled:false});assert.equal(a.root.visible,false);a.update(1);assert.equal(a.root.visible,true);
for(const {o,g,m,positions} of meshes){assert.equal(o.geometry,g);assert.equal(o.material,m);assert.deepEqual(Array.from(g.attributes.position.array),positions);}
assert.throws(()=>a.update(NaN));a.dispose();a.dispose();assert.equal(parent.children.length,1);assert.throws(()=>a.update(0));
const after=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');assert.equal(before,after);
const report={sourceSHA256:before,frames:361,rotationSweepRadians:12,maxRootContactError:maxError,maxSwayRadians:maxSway,bodyGeometryMaterialsUnchanged:true,reducedMotion:true,visibility:true,idempotentDisposal:true,scope:'CPU Three.js geometry/contact; not Electron or production pointer integration'};
await fs.writeFile(new URL('review/runtime-audit.json',here),JSON.stringify(report,null,2));console.log(report);
