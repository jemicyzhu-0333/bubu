import {paths} from '../../shared/paths.mjs';import {pathToFileURL} from 'node:url';import path from 'node:path';import {execFileSync} from 'node:child_process';
const cfg=paths();execFileSync('python',[new URL('../../shared/verify-prop-evidence.py',import.meta.url).pathname,'--proof',path.join(cfg.cache,'comfort-props/reports/current-evidence.json')]);
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {verifyStaticEvidence,sha256} from './verify-static-evidence.mjs';
const base=pathToFileURL(path.join(cfg.cache,'comfort-props')+'/'),audit=JSON.parse(fs.readFileSync(new URL('reports/mount-audit.json',base)));
const referenceBytes=fs.readFileSync(path.join(cfg.cache,'accessory/review/halo-static.json'));
for(const a of audit.items)test(a.id+' current static input, immutable actor and SHA-bound triangle evidence',()=>{verifyStaticEvidence(a,fs.readFileSync(new URL('reports/'+a.id+'-mounted.json',base)),referenceBytes);});
for(const kind of ['actor vertex','prop depth','prop nonfinite','actor topology','reference'])test(kind+' mutation cannot reuse green report',()=>{
 const a=audit.items.find(i=>i.id==='mirror');const original=fs.readFileSync(new URL('reports/mirror-mounted.json',base));const data=JSON.parse(original);
 if(kind==='reference'){assert.throws(()=>verifyStaticEvidence(a,original,Buffer.concat([referenceBytes,Buffer.from(' ')])));return;}
 const actor=data.frames[0].meshes.find(m=>m.name==='Bubu_body'),prop=data.frames[0].meshes.find(m=>!m.name.startsWith('Bubu_')&&!m.name.startsWith('A_'));
 if(kind==='actor vertex')actor.positions[0]+=100;if(kind==='prop depth')prop.positions[2]+=100;if(kind==='prop nonfinite')prop.positions[0]=null;if(kind==='actor topology')actor.indices[0]+=1;
 const altered=Buffer.from(JSON.stringify(data));assert.throws(()=>verifyStaticEvidence(a,altered,referenceBytes),/Stale mount audit/);
 // Even a forged refreshed input hash cannot bypass the independent current-geometry checks.
 assert.throws(()=>verifyStaticEvidence({...a,inputSha256:sha256(altered)},altered,referenceBytes));
});
