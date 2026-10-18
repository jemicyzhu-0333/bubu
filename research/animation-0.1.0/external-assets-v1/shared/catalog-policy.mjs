import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import {sha256} from './paths.mjs';
const checkOnly=process.argv.includes('--check');const repo=process.argv[2];if(!repo)throw new Error('Usage: node shared/catalog-policy.mjs REPO_ROOT');
const source=path.resolve(repo,'src/content/appearance.mjs'),{PET_APPEARANCE_ITEMS}=await import(pathToFileURL(source));
const p=new URL('../catalog.json',import.meta.url),catalog=JSON.parse(fs.readFileSync(p));
const fields=['slot','layer','exclusiveGroup','exclusivePriority','minLevel','unlockKind','optInOnly','formId','skin'];
for(const row of catalog.wearables){const item=PET_APPEARANCE_ITEMS.find(x=>x.id===row.id);assert.ok(item,row.id);const expected=Object.fromEntries(fields.map(k=>[k,item[k]??null]));if(checkOnly)assert.deepEqual(row.wardrobePolicy,expected,row.id);else row.wardrobePolicy=expected;row.admission='render-host only; canonical wardrobe owner enforces eligibility and exclusivity';for(const key of fields)assert.deepEqual(row.wardrobePolicy[key],item[key]??null);}
catalog.canonicalPolicy={source:'src/content/appearance.mjs',sha256:sha256(source),fields};if(!checkOnly)fs.writeFileSync(p,JSON.stringify(catalog,null,2)+'\n');console.log('18 canonical policies verified');
