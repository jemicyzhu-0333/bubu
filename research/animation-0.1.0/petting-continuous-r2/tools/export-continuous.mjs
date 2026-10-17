import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import * as T from 'three';
import {fixture} from './fixture.mjs';import {exportSceneFrame} from './export-scene-frame.mjs';
const P=path.resolve(new URL('..',import.meta.url).pathname),out=path.resolve(P,'../../../preview'),bin=out+'/binary';fs.mkdirSync(bin,{recursive:true});
const sourceFiles=['src/petting-controller.mjs','src/pet-policy.mjs','../shared-input-workbench-v2/src/pointer-host.mjs','../shared-input-workbench-v2/src/host-admission.mjs','../drag-landing-r5/src/drag-controller.mjs'];
const hashes=Object.fromEntries(sourceFiles.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(P,n))).digest('hex')]));
const f=await fixture(),fps=30,records=[],chunks=[],selected=[],raycaster=new T.Raycaster(),p=new T.Vector3(),feet={left:[],right:[]},rest={},topology={};
let frames=[],segment='',initial=null,minimum=Infinity,maxLift=0,maxDrift=0,maxJoint=0;const start=f.point(-.2,1.4),ground=f.h.body.initialGround;let point={...start};
for(let i=0;i<f.h.body.skin.geometry.attributes.position.count;i++){f.h.body.skin.getVertexPosition(i,p);if(p.y<.07)feet[p.x<0?'left':'right'].push(i);}
for(const [n,b]of Object.entries(f.h.body.bones))rest[n]=b.quaternion.clone();
function currentHit(){f.camera.updateMatrixWorld(true);f.h.body.root.updateMatrixWorld(true);f.h.body.skin.computeBoundingSphere();raycaster.setFromCamera(new T.Vector2(point.clientX/192-1,1-point.clientY/192),f.camera);return raycaster.intersectObject(f.h.body.skin,false)[0];}
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const keyIndices=new Set([0,30,60,120,390,510,990,1020,1110,1824,1884]);
const windows=[['entry',0,5],['quiet-response',11,16],['sparse-look',31.5,37.5],['release',60,63]];
function save(){if(!frames.length)return;const name=`chunk-${String(chunks.length).padStart(3,'0')}.json`;fs.writeFileSync(path.join(out,name),JSON.stringify({sourceGLB:path.resolve(P,'../runtime-facepath05/fixtures/face-d2/asset.glb'),frames}));chunks.push({name,segment,frames:frames.map(({meshes,...x})=>x)});frames=[];}
try{for(let i=0;i<=63*fps;i++){
 const time=i/fps;if(i===6)f.emit('pointerdown',.2,start);
 if(time>=6&&time<=10){const u=time<8?smooth((time-6)/2):1-smooth((time-8)/2);point={clientX:start.clientX+4*u,clientY:start.clientY};f.emit('pointermove',time,point);}
 if(time>=21&&time<=25){const u=time<23?smooth((time-21)/2):1-smooth((time-23)/2);point={clientX:start.clientX-3*u,clientY:start.clientY-1.5*u};f.emit('pointermove',time,point);}
 if(i===1806)f.emit('pointerup',60.2,point);
 const s=f.tick(time);records.push(s);const support={};for(const [side,ids]of Object.entries(feet)){let x=0,z=0,min=Infinity;for(const j of ids){f.h.body.skin.getVertexPosition(j,p);p.applyMatrix4(f.h.body.skin.matrixWorld);x+=p.x;z+=p.z;min=Math.min(min,p.y);}support[side]={x:x/ids.length,z:z/ids.length,min};minimum=Math.min(minimum,min);maxLift=Math.max(maxLift,min-ground);}initial??=support;
 for(const side of ['left','right'])maxDrift=Math.max(maxDrift,Math.hypot(support[side].x-initial[side].x,support[side].z-initial[side].z));for(const [n,b]of Object.entries(f.h.body.bones))maxJoint=Math.max(maxJoint,b.quaternion.angleTo(rest[n]));
 const window=windows.find(([,a,b])=>time>=a&&time<=b);if(!window&&!keyIndices.has(i))continue;
 if(window&&segment&&segment!==window[0])save();if(window)segment=window[0];
 const frame=exportSceneFrame(f.h.body.root,{time,label:s.pet.phase+' / '+(s.face.path??'Basis')});frame.contact=s.pointerId===null?null:currentHit()?.point.toArray()??null;frame.face={path:s.face.path,amount:s.face.amount,candidate:s.face.candidate};frame.phase=s.pet.phase;frame.responseKind=s.pet.responseKind;
 for(const m of frame.meshes){topology[m.name]??={indices:m.indices,colors:m.colors};const name=path.join(bin,`${i}-${m.name}.bin`);fs.writeFileSync(name,Buffer.from(new Float32Array(m.positions).buffer));m.positionsFile=name;delete m.positions;delete m.indices;delete m.colors;delete m.faceWeights;}
 if(keyIndices.has(i))selected.push({...frame,meshes:frame.meshes.map(m=>({...m,...topology[m.name]}))});
 if(window){if(!frames.length)for(const m of frame.meshes)Object.assign(m,topology[m.name]);frames.push(frame);if(frames.length===120)save();}
}save();
fs.writeFileSync(path.join(out,'keyframes.json'),JSON.stringify({sourceGLB:path.resolve(P,'../runtime-facepath05/fixtures/face-d2/asset.glb'),frames:selected}));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({fps,speed:1,numericDuration:63,windows,sourceHashes:hashes,chunks},null,2));
fs.writeFileSync(P+'/evidence/trajectory.json',JSON.stringify(records));fs.writeFileSync(P+'/evidence/continuous-support.json',JSON.stringify({frames:records.length,minimumFootY:minimum,maximumOppositeFootLift:maxLift,maximumSoleCentroidHorizontalDrift:maxDrift,maximumLimbQuaternionAngle:maxJoint,sourceHashes:hashes},null,2));console.log('exported',records.length,'numeric frames',chunks.length,'video chunks',minimum,maxLift,maxDrift,maxJoint);
}finally{f.h.dispose();fs.writeFileSync(P+'/evidence/resources.json',JSON.stringify(f.h.pool.stats,null,2));}
