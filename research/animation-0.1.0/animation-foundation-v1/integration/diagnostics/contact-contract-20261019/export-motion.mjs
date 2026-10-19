import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {exportPaths} from './export-paths.mjs';
const {research,out}=exportPaths();
const {createRigidTeaController}=await import(pathToFileURL(path.join(research,'original-parts-hybrid-v1/tea/src/rigid-tea.mjs')));
const read=n=>JSON.parse(fs.readFileSync(path.join(research,'original-parts-hybrid-v1/tea/inputs',n+'.json')));
const c=createRigidTeaController({config:read('rigid-config'),hold:read('hold-fit'),sip:read('sip-fit')});
fs.writeFileSync(path.join(out,'motion.json'),JSON.stringify([0,.6,1.2,1.5,2,2.7,3.4,4.1,4.8,5.5,6.2,6.6,6.9,7.5,8.1,9].map(t=>{const s=c.sample(t);return {...s,matrices:Object.fromEntries(Object.entries(s.matrices).map(([n,m])=>[n,m.elements]))}})));
