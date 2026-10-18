import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {createLedger} from '../../theme-state-ledger-v2/src/ledger.mjs';import {writeCheckpoint,readCheckpoint,readBounded} from '../../theme-state-ledger-v2/src/checkpoint-file.mjs';import {T,config,event,revise} from '../../theme-state-ledger-v2/fixtures/fixtures.mjs';
async function file(fn){const dir=await mkdtemp(join(tmpdir(),'bubu-v2-independent-'));try{await fn(join(dir,'checkpoint.json'))}finally{await rm(dir,{recursive:true,force:true})}}
const proof=(sourceCursor,minLastNow=T)=>({sourceCursor,minLastNow});
test('file snapshot cursor binding, old-file rollback mismatch, corruption and failed replacement preserve bytes',()=>file(async path=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);const old=l.snapshot('epoch1:cursor1');await writeCheckpoint(path,old,'epoch1:cursor1');const bytes=await readFile(path);
 await assert.rejects(()=>writeCheckpoint(path,old,'epoch1:cursor2'),e=>e.code==='CHECKPOINT_CURSOR_MISMATCH');assert.deepEqual(await readFile(path),bytes);
 l.applyBatch([revise(e,{operation:'revoke',completionState:'revoked',revokeReason:'undo',committedAt:T+1000,receivedAt:T+1000})],T+1000);
 await assert.rejects(()=>readCheckpoint(path,T+1000,proof('epoch1:cursor2',T+1000)),e=>e.code==='RECOVERY_CURSOR_MISMATCH');
 await writeCheckpoint(path,l.snapshot('epoch1:cursor2'),'epoch1:cursor2');const r=await readCheckpoint(path,T+1000,proof('epoch1:cursor2',T+1000));assert.equal(r.ledger.project(T+1000).themes.length,0);
 const good=await readFile(path),envelope=JSON.parse(good);envelope.payload.upstreamCursor='tampered';await writeFile(path,JSON.stringify(envelope));await assert.rejects(()=>readCheckpoint(path,T+1000,proof('epoch1:cursor2',T+1000)),e=>e.code==='CHECKPOINT_CHECKSUM');assert.equal((await readFile(path,'utf8')),JSON.stringify(envelope));
}));
test('fresh process verifies authority cursor then restores only original remainder',()=>file(async path=>{
 const l=createLedger(config());l.applyBatch([event()],T);await writeCheckpoint(path,l.snapshot('epoch1:cursor1'),'epoch1:cursor1');const url=new URL('../../theme-state-ledger-v2/src/checkpoint-file.mjs',import.meta.url).href;
 const code=`import {readCheckpoint} from ${JSON.stringify(url)};const {ledger}=await readCheckpoint(${JSON.stringify(path)},${T+599999},${JSON.stringify(proof('epoch1:cursor1'))});console.log(JSON.stringify([ledger.project(${T+599999}).themes,ledger.project(${T+900000}).sources]));`;
 const [themes,sources]=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'}));assert.equal(themes[0].expiresAt,T+600000);assert.equal(sources.length,0);
}));
test('strict write and recovery evidence inputs never execute getters',()=>file(async path=>{
 const l=createLedger(config());l.applyBatch([event()],T);let hits=0;const s=l.snapshot('cursor1');Object.defineProperty(s,'lastNow',{enumerable:true,get(){hits++;return T}});await assert.rejects(()=>writeCheckpoint(path,s,'cursor1'));
 await writeCheckpoint(path,l.snapshot('cursor1'),'cursor1');const p=proof('cursor1');Object.defineProperty(p,'sourceCursor',{enumerable:true,get(){hits++;return 'cursor1'}});await assert.rejects(()=>readCheckpoint(path,T,p));assert.equal(hits,0);
}));
test('retained bounded reader hard-stops stat-to-read growth, truncation and oversize',async()=>{
 let read=0;await assert.rejects(()=>readBounded({async stat(){return {isFile:()=>true,size:65}},async read(){read++;return {bytesRead:0}}},64),e=>e.code==='CHECKPOINT_SIZE');assert.equal(read,0);
 let total=0;const growing={async stat(){return {isFile:()=>true,size:1,mtimeMs:1}},async read(buf,o,n){total+=n;return {bytesRead:n}}};await assert.rejects(()=>readBounded(growing,64),e=>e.code==='CHECKPOINT_SIZE');assert.equal(total,65);
 let stats=0;await assert.rejects(()=>readBounded({async stat(){return {isFile:()=>true,size:++stats===1?8:0,mtimeMs:1}},async read(){return {bytesRead:0}}},64),e=>e.code==='CHECKPOINT_CHANGED_DURING_READ');
});
