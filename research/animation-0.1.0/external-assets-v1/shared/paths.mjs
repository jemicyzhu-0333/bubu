import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
export const sha256=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function paths(){
 const {values:a}=parseArgs({options:{'repo-root':{type:'string'},'reference-root':{type:'string'},'cache-root':{type:'string'},'static-only':{type:'boolean'}}});
 for(const k of ['repo-root','reference-root','cache-root'])if(!a[k])throw new Error(`Required --${k}`);
 const repo=path.resolve(a['repo-root']),reference=path.resolve(a['reference-root']),cache=path.resolve(a['cache-root']);
 const proof=JSON.parse(fs.readFileSync(path.join(reference,'fixture-source-manifest.json')));
 for(const row of proof.files)if(sha256(path.join(reference,row.path))!==row.sha256)throw new Error('Fixture source changed: '+row.path);
 const research=path.join(reference,'research/animation-0.1.0'),pkg=path.join(research,'original-parts-hybrid-v1');
 const source=path.join(research,'runtime-facepath05/fixtures/face-d2/asset.glb'),hybrid=path.join(pkg,'geometry/bubu-hybrid-binding.glb');
 if(sha256(source)!=='84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a')throw new Error('Source hash mismatch');
 if(sha256(hybrid)!=='52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67')throw new Error('Hybrid hash mismatch');
 return {repo,reference,cache,research,pkg,source,hybrid,staticOnly:!!a['static-only']};
}
