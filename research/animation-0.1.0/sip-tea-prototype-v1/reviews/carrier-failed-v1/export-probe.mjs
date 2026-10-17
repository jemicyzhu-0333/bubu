import fs from 'node:fs';import path from 'node:path';import * as T from 'three';
import {fixture} from '../../../petting-continuous-r2/tools/fixture.mjs';
import {exportSceneFrame} from '../../../petting-continuous-r2/tools/export-scene-frame.mjs';
import {createTeaCup} from '../../src/cup-model.mjs';
const {h}=await fixture();h.body.offset.rotation.y=0;h.frame(0);const c=createTeaCup(),root=new T.Group();root.add(h.body.root,c.root);const frames=[];
for(const phase of ['low','rim-contact'])for(const yaw of [0,45,90]){root.rotation.y=yaw*Math.PI/180;c.root.position.set(0,phase==='low'?.02:.695-.33,.779+.27*.95);const f=exportSceneFrame(root,{label:phase+' '+yaw,time:frames.length});for(const m of f.meshes){const o=root.getObjectByName(m.name);if(m.name.startsWith('Sip_'))m.materialColor=o.material.color.toArray();}frames.push(f);}
fs.writeFileSync(new URL('probe-frames.json',import.meta.url),JSON.stringify({sourceGLB:new URL('../../../runtime-facepath05/fixtures/face-d2/asset.glb',import.meta.url).pathname,frames}));c.dispose();h.dispose();
