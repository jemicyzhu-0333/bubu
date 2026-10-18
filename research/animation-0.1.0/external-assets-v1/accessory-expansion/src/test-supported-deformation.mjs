import assert from 'node:assert/strict';
import * as T from 'three';
import {SupportedDeformation} from './supported-deformation.mjs';
function fixture(){const root=new T.Group();const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,1.2,-.8, .5,.2,-.9, -.5,.2,-.9],3));g.setIndex([0,1,2]);g.computeVertexNormals();const mesh=new T.Mesh(g,new T.MeshBasicMaterial());mesh.name='cape_cloth';root.add(mesh);return{root,mesh,source:g,d:new SupportedDeformation(root,'cape')};}
const a=fixture(),b=fixture(),identity=new T.Matrix4(),tilt=new T.Matrix4().makeRotationZ(.6);
const original=Array.from(a.source.attributes.position.array);a.d.update(identity,{time:0});b.d.update(identity,{time:0});
for(let i=1;i<=90;i++)a.d.update(tilt,{time:i/60});
assert.ok(Math.abs(a.d.offset.x)>.04);assert.deepEqual(Array.from(b.mesh.geometry.attributes.position.array),original);assert.deepEqual(Array.from(a.source.attributes.position.array),original);
assert.deepEqual(Array.from(a.mesh.geometry.attributes.position.array).slice(0,3),original.slice(0,3));
const snapshot=Array.from(a.mesh.geometry.attributes.position.array);a.d.update(identity,{time:1.5});assert.deepEqual(Array.from(a.mesh.geometry.attributes.position.array),snapshot);
a.d.update(tilt,{time:1.7});assert.ok(a.d.offset.length()<=.16);
a.d.update(tilt,{time:5});assert.equal(a.d.offset.length(),0);a.d.update(tilt,{time:4});assert.equal(a.d.offset.length(),0);
for(let i=1;i<100;i++)a.d.update(tilt,{time:4+i/60});a.d.update(tilt,{time:6,enabled:false});assert.equal(a.d.offset.length(),0);a.d.update(tilt,{time:7,reducedMotion:true});assert.equal(a.d.offset.length(),0);
a.d.reset();b.d.reset();for(let i=0;i<120;i++){a.d.update(tilt,{time:i/60});b.d.update(tilt,{time:i/60});}assert.deepEqual(Array.from(a.mesh.geometry.attributes.position.array),Array.from(b.mesh.geometry.attributes.position.array));
// Parent compensation produces the same skin-to-world input under an external transform.
const parent=new T.Matrix4().makeRotationY(.8).setPosition(2,3,4),local=parent.clone().invert().multiply(tilt);const reconstructed=parent.clone().multiply(local);a.d.reset();b.d.reset();for(let i=0;i<90;i++){a.d.update(tilt,{time:i/60});b.d.update(reconstructed,{time:i/60});}assert.ok(a.d.offset.distanceTo(b.d.offset)<1e-12);
a.d.reset();
for(let i=0;i<30;i++)a.d.update(new T.Matrix4().setPosition(i<10?i*.005:.05,0,0),{time:i/60});
assert.ok(a.d.offset.length()>0);
for(let i=30;i<600;i++)a.d.update(new T.Matrix4().setPosition(.05,0,0),{time:i/60});
assert.ok(a.d.offset.length()<1e-12);
const bad=fixture();bad.mesh.rotation.z=.2;assert.throws(()=>new SupportedDeformation(bad.root,'cape'));bad.d.dispose();
let disposed=0;a.mesh.geometry.addEventListener('dispose',()=>disposed++);a.d.dispose();a.d.dispose();assert.equal(disposed,1);assert.deepEqual(Array.from(a.source.attributes.position.array),original);b.d.dispose();console.log('PASS gravity, pinned supports, source isolation, actor isolation/interleaving, zero dt, spike/rewind/reset/reduced motion, parent invariance, disposal');
