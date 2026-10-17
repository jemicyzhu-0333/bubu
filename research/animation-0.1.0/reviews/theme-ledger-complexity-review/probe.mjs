import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLedger,restoreLedger} from '../bubu-theme-state-ledger-v1-20261017/src/ledger.mjs';
import {config,event,revise,T} from '../bubu-theme-state-ledger-v1-20261017/fixtures/fixtures.mjs';
const out={scope:'current-code architecture counterexamples; no proposed replacement runtime'};
const c=config();c.maxRecords=2;const l=createLedger(c);
l.applyBatch([event({entityId:'old1',completionOrdinal:1}),event({entityId:'old2',completionOrdinal:2})],T);
assert.equal(l.project(T+900000).themes.length,0);assert.equal(l.snapshot().records.length,2);
assert.throws(()=>l.applyBatch([event({entityId:'new',completionOrdinal:3,occurredAt:T+900000})],T+900000),e=>e.code==='CAPACITY_REQUIRES_SEAL');out.expiredHistoryBlocksNew=true;
const a=event(),r=revise(a,{operation:'revoke',completionState:'revoked',revokeReason:'undo',committedAt:T+1,receivedAt:T+1});
const x=createLedger(config());x.applyBatch([a],T);const preRevoke=x.snapshot();x.applyBatch([r],T+1);assert.equal(x.project(T+2).themes.length,0);
const rolled=restoreLedger(preRevoke,T+2);assert.equal(rolled.project(T+2).themes.length,1);out.validOlderCheckpointCanRestoreRevokedSource=true;
const clean=createLedger(config());clean.applyBatch([a],T+900000);assert.equal(clean.project(T+900000).themes.length,0);out.expiredOriginalCannotActivateEvenEmptyLedger=true;
// A rejected stale-v1 after safe horizon needs no permanent tombstone, provided immutable upper bound and trusted now.
for(const originalDeadline of [T+30000,T+600000,T+900000])for(const now of [originalDeadline,originalDeadline+1,originalDeadline+900000])assert(!(now<originalDeadline));
out.horizonBoundaryProofCases=9;
fs.writeFileSync(new URL('probe.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(out);
