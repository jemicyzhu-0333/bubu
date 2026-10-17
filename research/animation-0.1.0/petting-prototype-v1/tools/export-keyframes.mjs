import {writeFile,mkdir} from 'node:fs/promises';
import * as T from '../../drag-body-prototype-v1/node_modules/three/build/three.module.js';
import {exportSceneFrame} from '../../drag-body-prototype-v1/src/export-scene-frame.mjs';
import {createPettingHost} from '../src/petting-host.mjs';
const out=new URL('../evidence/',import.meta.url);await mkdir(out,{recursive:true});
const h=await createPettingHost(),frames=[];let anchor=null,contactSource=null;
function contact(x){const hit=h.body.hitRay(x,1.45);if(!hit)throw Error("Missing actual upper body surface hit");anchor=h.body.surfaceAnchor(hit);contactSource=hit.point.clone();return hit;}
try {
 const skin=h.body.skin,p=new T.Vector3(),feet={left:[],right:[]};
 for(let i=0;i<skin.geometry.attributes.position.count;i++){skin.getVertexPosition(i,p);if(p.y<.07)feet[p.x<0?'left':'right'].push(i);}
 const support=()=>Object.fromEntries(Object.entries(feet).map(([side,ids])=>{let min=Infinity,x=0,z=0;for(const i of ids){skin.getVertexPosition(i,p);p.applyMatrix4(skin.matrixWorld);min=Math.min(min,p.y);x+=p.x;z+=p.z;}return [side,{minimumY:min,centroidXZ:[x/ids.length,z/ids.length],vertices:ids.length}];}));
 function snap(time,label){const s=h.tick(time),meshes=exportSceneFrame(h.body.root,{time,label}).meshes;const weights={};const m=h.owner.root.getObjectByName('A_eye_L');for(const [name,index] of Object.entries(m.morphTargetDictionary))if(m.morphTargetInfluences[index])weights[name]=m.morphTargetInfluences[index];frames.push({label,time,...s,weights,feet:support(),contact:anchor?h.body.surfacePoint(anchor).toArray():null,contactDrift:anchor?h.body.surfacePoint(anchor).distanceTo(contactSource):null,meshes});}
 snap(0,'rest');contact(0);h.input({type:'down',time:.2,pointerId:1,x:0,y:0,side:0,eligible:true});snap(.85,'enter');snap(2.6,'settled_P2');
 contact(-.4);h.input({type:'move',time:4,pointerId:1,x:2,y:0,side:-1,eligible:true});snap(5.5,'left_contact');
 contact(.4);h.input({type:'move',time:7,pointerId:1,x:4,y:0,side:1,eligible:true});snap(8.5,'right_contact');
 const response=h.control.deadline;snap(response+1.1,'sparse_response');snap(response+4,'calm_again');
 anchor=null;h.input({type:'up',time:response+5,pointerId:1});snap(response+5.35,'release');snap(response+7.5,'restored');
 await writeFile(new URL('keyframes.json',out),JSON.stringify({sourceGLB:new URL('../../drag-body-prototype-v1/vendor/runtime-facepath05/fixtures/face-full18/asset.glb',import.meta.url).pathname,format:'bubu-petting-actual-world-vertices-v1',scope:'Actual full18 weighted-owner and body-enabled four-limb rig; offline render inputs, not WebGL capture',assetSha256:h.pack.profile.sourceSha256,frames}));
 await writeFile(new URL('keyframe-audit.json',out),JSON.stringify(frames.map(({meshes,...rest})=>rest),null,2));
 console.log(frames.map(f=>({label:f.label,time:f.time,face:f.face.path,amount:f.face.amount,feet:f.feet})));
}finally{h.dispose();}
