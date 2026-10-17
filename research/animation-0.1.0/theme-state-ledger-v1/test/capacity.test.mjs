import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger,restoreLedger,LIMITS} from '../src/ledger.mjs';
import {config,event,T} from '../fixtures/fixtures.mjs';
const long = suffix => '\u0000'.repeat(LIMITS.maxIdChars-suffix.length)+suffix;
test('maximum admitted config and records export/restore within bounded validation budget',()=>{
  const c=config();c.maxRecords=LIMITS.maxRecords;
  c.namespaces=Array.from({length:LIMITS.maxNamespaces},(_,i)=>long(`ns:${i}`));
  c.capabilities=Array.from({length:LIMITS.maxCapabilities},(_,i)=>({id:long(`cap:${i}`),approved:true,runtimeReady:true,channel:'environment.overlay'}));
  c.mappings=Array.from({length:LIMITS.maxMappings},(_,i)=>({sourceKind:'routine',definitionId:long(`preset:${i}`),mappingVersion:long(`version:${i}`),themeId:long(`theme:${i}`),recipeVersion:long(`recipe:${i}`),approved:true,presentationMode:'overlay_only',overlayPolicyId:long(`policy:${i}`),actionPolicyId:null,requiredCapabilities:c.capabilities.slice(0,LIMITS.maxRequiredCapabilities).map(x=>x.id),assetPolicyDigest:long(`digest:${i}`),durationSec:900}));
  const l=createLedger(c);
  for(let offset=0;offset<LIMITS.maxRecords;offset+=256){
    const events=Array.from({length:256},(_,j)=>{const n=offset+j;const e=event({namespace:c.namespaces[n%32],eventId:long(`event:${n}`),transactionId:long(`tx:${n}`),entityId:long(`entity:${n}`),completionGeneration:long(`gen:${n}`),completionOrdinal:n+1,operation:'revoke',completionState:'revoked',revokeReason:long(`reason:${n}`)});e.original.definitionId=c.mappings[0].definitionId;e.original.mappingVersion=c.mappings[0].mappingVersion;return e;});l.applyBatch(events,T);
  }
  const s=l.snapshot();assert.equal(s.records.length,LIMITS.maxRecords);
  const bytes=Buffer.byteLength(JSON.stringify(s));assert.ok(bytes<96*1024*1024,`snapshot bytes ${bytes}`);
  const restored=restoreLedger(s,T);assert.equal(restored.snapshot().records.length,LIMITS.maxRecords);assert.equal(restored.project(T).themes.length,0);
});
test('configuration beyond recoverable record ceiling is rejected before any writes',()=>{const c=config();c.maxRecords=LIMITS.maxRecords+1;assert.throws(()=>createLedger(c),e=>e.code==='CAPACITY_LIMIT');});
