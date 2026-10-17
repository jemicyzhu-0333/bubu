import fs from 'node:fs';import path from 'node:path';
import {createHost} from '../../drag-body-prototype-v1/src/fixture-host.mjs';
import {BodyRigAdapter} from '../../drag-body-prototype-v1/src/body-adapter.mjs';
import {exportSceneFrame} from '../../drag-body-prototype-v1/src/export-scene-frame.mjs';
import {DragController} from '../../drag-body-prototype-v1/src/drag-controller.mjs';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const legacy=JSON.parse(fs.readFileSync(path.resolve(root,'definitions/r4-keyposes.json'))),old=JSON.parse(fs.readFileSync(path.resolve(root,'definitions/v1-body-poses.json')));
const c=new DragController(old);c.begin(0,{x:0,y:0});for(let i=1;i<=45;i++)c.move(i/30,{x:0,y:i*28/30});c.move(1.6,{x:0,y:42});
let low=null,high=null;for(let i=0;i<=120;i++){const s=c.advance(1.6+i/60),z=s.pose.joints.Shoulder_L.z;if(!low||z<low.z)low={z,pose:s.pose};if(!high||z>high.z)high={z,pose:s.pose};}
const cases=[['v1 low',low.pose],['v1 high',high.pose],['r2 rest',legacy.poses.rest],['r2 pickup',legacy.poses.pickup],['r2 beat A',legacy.poses.beat_A],['r2 beat B',legacy.poses.beat_B]],frames=[],meta=[];
for(const yaw of [10,52]){const {owner}=await createHost();const b=new BodyRigAdapter(owner.root,{yawDegrees:yaw});owner.completeBatch({wallTime:0,epoch:owner.epoch,facts:{context:'none',source:'testfixture',enabled:false,interactionOwned:true},events:[{type:'request',owner:'interaction',requestId:'fixed-face',lifetime:1,candidate:'01',holdMode:'restart'}]});owner.advance(.3);b.place({y:.35});for(const [name,pose] of cases){b.applyPose({body:{x:0,y:0,z:0},joints:pose.joints});owner.assertCurrent();const frame=exportSceneFrame(b.root,{time:frames.length,label:yaw+'deg '+name});frames.push(frame);meta.push({yaw,name,pose:{body:{x:0,y:0,z:0},joints:pose.joints},snapshot:b.snapshot()});}b.dispose();owner.dispose();}
fs.writeFileSync(root+'/evidence/poses.json',JSON.stringify({sourceGLB:path.resolve(root,'../drag-body-prototype-v1/vendor/runtime-facepath05/fixtures/face-full18/asset.glb'),frames}));fs.writeFileSync(root+'/evidence/poses-metadata.json',JSON.stringify(meta,null,2));console.log('12 poses exported');
