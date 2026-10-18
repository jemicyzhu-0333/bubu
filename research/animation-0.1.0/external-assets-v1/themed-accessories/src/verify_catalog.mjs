import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {SPECS} from './accessory-adapter.mjs';
import {paths} from '../../shared/paths.mjs';
const cfg=paths();
const P=process.env.THEMED_AUTHORING_ROOT?path.resolve(process.env.THEMED_AUTHORING_ROOT):path.resolve(new URL('..',import.meta.url).pathname);
const catalogPath=path.join(cfg.repo,'src/content/appearance.mjs');
const {PET_APPEARANCE_ITEMS}=await import(catalogPath);
const manifest=JSON.parse(fs.readFileSync(P+'/attach-manifest.json'));
const tea=JSON.parse(fs.readFileSync(P+'/reports/tea-collision-full.json'));
const fields=['id','slot','exclusiveGroup','exclusivePriority','minLevel','unlockKind','optInOnly','formId','skin'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const results=[];
for(const item of manifest.items){
 const canonical=PET_APPEARANCE_ITEMS.find(x=>x.id===item.id);assert.ok(canonical);
 for(const key of fields){const expected=key==='optInOnly'?Boolean(canonical[key]):canonical[key];assert.deepEqual(item[key],expected);assert.deepEqual(SPECS[item.kind][key],expected);}
 const modelHash=hash(P+'/'+item.model);assert.equal(modelHash,item.sha256);assert.equal(modelHash,tea.accessoryModelSHA256[path.basename(item.model)]);
 results.push({id:item.id,fieldsMatch:true,adapterSpecMatches:true,modelUnchangedFromFullTea:true});
}
fs.mkdirSync(path.join(cfg.cache,'themed-accessories/reports'),{recursive:true});
fs.writeFileSync(path.join(cfg.cache,'themed-accessories/reports/catalog-metadata-proof.json'),JSON.stringify({catalogSHA256:hash(catalogPath),manifestSHA256:hash(P+'/attach-manifest.json'),adapterSHA256:hash(P+'/src/accessory-adapter.mjs'),fields,results,allPassed:true},null,2));
console.log('Canonical metadata and unchanged model evidence verified for '+results.length+' items.');
