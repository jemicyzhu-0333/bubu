import fs from 'node:fs';
import * as T from '../../../node_modules/three/build/three.module.js';
import {createTeaCup} from '../../../sip-tea-prototype-v1/src/cup-model.mjs';
import {exportSceneFrame} from '../../../petting-continuous-r2/tools/export-scene-frame.mjs';
const j=JSON.parse(fs.readFileSync(new URL('contact-route-fit.json',import.meta.url))),c=createTeaCup({radius:j.parameters.cupRadius,height:j.parameters.cupHeight});
const r=j.cupRotation;c.root.setRotationFromMatrix(new T.Matrix4().set(...r[0],0,...r[1],0,...r[2],0,0,0,0,1));c.root.position.fromArray(j.cupCenter);
const f=exportSceneFrame(c.root);for(const m of f.meshes)m.materialColor=m.name==='Sip_tea_surface'?[.12,.045,.012]:[.33,.60,.51];
fs.writeFileSync(new URL('contact-cup-meshes.json',import.meta.url),JSON.stringify(f));c.dispose();
