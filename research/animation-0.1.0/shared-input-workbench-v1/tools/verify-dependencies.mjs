import fs from 'node:fs';import crypto from 'node:crypto';
const root=new URL('../',import.meta.url), manifest=JSON.parse(fs.readFileSync(new URL('PROVENANCE.json',root)));
for(const [path,expected] of Object.entries(manifest.sha256)){const actual=crypto.createHash('sha256').update(fs.readFileSync(new URL(path,root))).digest('hex');if(actual!==expected)throw Error('Dependency hash mismatch: '+path);}
console.log('Verified '+Object.keys(manifest.sha256).length+' controller/profile dependency hashes');
