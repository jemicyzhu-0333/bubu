import fs from 'node:fs';
import {paths} from '../paths.mjs';import path from 'node:path';
const cfg=paths(),{createRigidTeaController}=await import(cfg.pkg+'/tea/src/rigid-tea.mjs');fs.mkdirSync(path.join(cfg.cache,'tea/reports'),{recursive:true});
const read=n=>JSON.parse(fs.readFileSync(path.join(cfg.pkg,'tea/inputs',n+'.json')));
const controller=createRigidTeaController({config:read('rigid-config'),hold:read('hold-fit'),sip:read('sip-fit')});
const sample=(t,options={})=>{const r=controller.sample(t,options);return {...r,matrices:Object.fromEntries(Object.entries(r.matrices).map(([n,m])=>[n,m.elements]))};};
const normal=Array.from({length:271},(_,i)=>sample(i/30));
const cancellations=[0,.2,.8,1.3,2.5,3.8,5.5,6.7,7.5,8.5].map(cancelAt=>({cancelAt,samples:Array.from({length:73},(_,i)=>sample(cancelAt+i/60,{cancelAt}))}));
fs.writeFileSync(path.join(cfg.cache,'tea/reports/samples.json'),JSON.stringify({normal,cancellations}));
