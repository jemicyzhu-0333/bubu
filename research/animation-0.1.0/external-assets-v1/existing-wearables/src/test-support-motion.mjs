import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {SupportMotion} from './local-adapters/support-motion.mjs';
import {SproutAdapter} from './local-adapters/sprout-adapter.mjs';
import {SatchelAdapter} from './local-adapters/satchel-adapter.mjs';
import {ScarfAdapter} from './local-adapters/scarf-adapter.mjs';
const settings={limit:.06,stiffness:52,damping:11,gravity:.16};
const still=new SupportMotion(settings),zero=new T.Vector3(),identity=new T.Matrix4();
for(let i=0;i<1000;i++)assert.equal(still.sample(i/60,zero,identity,false).length(),0);
function replay(hz){
 const m=new SupportMotion(settings);let peak=0;
 for(let i=0;i<=3*hz;i++){
  const t=i/hz,position=new T.Vector3(t<1?Math.sin(t*Math.PI)*.3:0,0,0);
  m.sample(t,position,identity,false);peak=Math.max(peak,m.value.length());
 }
 return{state:m.value.toArray(),peak};
}
assert.deepEqual(replay(60),replay(60));
const thirty=replay(30),sixty=replay(60);assert(Math.abs(thirty.peak-sixty.peak)<.008);
const tilted=new SupportMotion(settings),tilt=new T.Matrix4().makeRotationZ(.35);
for(let i=0;i<120;i++)tilted.sample(i/60,zero,tilt,false);
assert(tilted.value.x<-.02);assert(Math.abs(tilted.value.x)<settings.limit);
const actorRoot=new T.Group(),parent=new T.Group(),g=new T.BufferGeometry();
g.setAttribute('position',new T.Float32BufferAttribute([0,1.62766,0,0,.55,.75,0,1.12,-.73],3));
const skin=new T.SkinnedMesh(g,new T.MeshBasicMaterial());skin.name='A_mochi_skin';
let headOffset=0;skin.getVertexPosition=function(i,target){target.fromBufferAttribute(g.attributes.position,i);if(i===0)target.y+=headOffset;return target;};
actorRoot.add(skin);
const adapters=[];let privateDisposals=0,borrowedDisposals=0;
for(const[kind,Class]of [['sprout',SproutAdapter],['satchel',SatchelAdapter],['scarf',ScarfAdapter]]){
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,.03,.1,0,-.03,.1,0],3));geometry.computeVertexNormals();
 const name=kind==='scarf'?'scarf_tail':kind+'_stem',mesh=new T.Mesh(geometry,new T.MeshBasicMaterial());mesh.name=name;
 geometry.addEventListener('dispose',()=>borrowedDisposals++);const asset=new T.Group();asset.add(mesh);
 const adapter=new Class({actorRoot,parent,asset});adapters.push(adapter);
 for(const part of adapter.parts)part.mesh.geometry.addEventListener('dispose',()=>privateDisposals++);
}
const before=adapters.map(a=>a.root.position.clone());headOffset=.2;
for(const a of adapters)a.update(1);
assert(Math.abs(adapters[0].root.position.y-before[0].y-.2)<1e-6);
assert(adapters[1].root.position.equals(before[1]));assert(adapters[2].root.position.equals(before[2]));
for(const a of adapters){const updates=a.geometryUpdates;a.update(1);assert.equal(a.geometryUpdates,updates);a.dispose();a.dispose();assert.throws(()=>a.update(2));}
assert.equal(privateDisposals,3);assert.equal(borrowedDisposals,0);assert.equal(parent.children.length,0);
const result={noUnforcedIdleMotion:true,gravityInLocalFrame:true,deterministicReplay:true,frameRatePeaks:{thirty,sixty},headOnlyDeformationLeavesTorsoWearablesFixed:true,identicalFrameCachesGeometry:true,privateGeometryDisposedExactlyOnce:true,borrowedResourcesUnchanged:true};
const out=new URL('../reports/support-motion-tests.json',import.meta.url);fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
