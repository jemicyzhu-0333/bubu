import fs from 'node:fs';
import crypto from 'node:crypto';
import { decodedArrayPlan } from '../bubu-runtime-0.1.0-owner08-20261017/src/geometry-accounting.mjs';
const files=['bubu-expression-library-v1.glb','bubu-expression-slice7.glb'];
const out=files.map(file=>{
 const b=fs.readFileSync(new URL('../bubu-3d-a-expression-library-v1-20261017/'+file,import.meta.url));
 const d=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
 let vertices=0,deformed=0;const faces=[];
 for(const m of d.meshes)for(const p of m.primitives){const n=d.accessors[p.attributes.POSITION].count;vertices+=n;deformed+=n*(1+(p.targets?.length??0));if(p.targets)faces.push({name:m.name,vertices:n,targets:p.targets.length,names:m.extras?.targetNames});}
 return {file,sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length,vertices,deformed,nodes:d.nodes.length,accessors:d.accessors.length,bufferViews:d.bufferViews.length,plan:decodedArrayPlan(b.length,d),faces};
});
fs.writeFileSync(new URL('resource-plan.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.map(({faces,...x})=>({...x,faceLayers:faces.length})),null,2));
