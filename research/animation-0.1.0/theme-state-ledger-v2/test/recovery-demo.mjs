import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLedger} from '../src/ledger.mjs';
import {writeCheckpoint,readCheckpoint} from '../src/checkpoint-file.mjs';
import {config,event,T} from '../fixtures/fixtures.mjs';
if (process.argv[2] === '--child') {
  const {ledger,upstreamCursor}=await readCheckpoint(process.argv[3],T+590000,{sourceCursor:'fixture:outbox:1',minLastNow:T});
  assert.equal(upstreamCursor,'fixture:outbox:1');
  assert.equal(ledger.project(T+590000).themes[0].expiresAt,T+600000);
  assert.deepEqual(ledger.applyBatch([event()],T+590000).results,['duplicate']);
  assert.equal(ledger.project(T+600000).themes.length,0);
  console.log(JSON.stringify({restoredInFreshProcess:true,remainingMs:10000,duplicateDidNotRenew:true,expiredAtOriginalDeadline:true}));
} else {
  const dir=await mkdtemp(join(tmpdir(),'bubu-theme-ledger-'));
  try {
    const l=createLedger(config()); l.applyBatch([event()],T);
    const file=join(dir,'checkpoint.json'); await writeCheckpoint(file,l.snapshot('fixture:outbox:1'),'fixture:outbox:1');
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',file],{encoding:'utf8'});
    if(child.status!==0) throw new Error(child.stderr||child.stdout);
    process.stdout.write(child.stdout);
  } finally {await rm(dir,{recursive:true,force:true});}
}
