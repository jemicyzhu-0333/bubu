'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createD2Materializer, materializeD2 } = require('../tools/pet-realtime-capture/materialize-d2.mjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const CONTRACT_FILE = path.join(__dirname,'../research/animation-0.1.0/runtime-facepath05/tools/approved-d2-source.json');
async function fixture(t, { encoded, output = Buffer.from('glTF-small-approved-fixture') } = {}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bubu-d2-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'archive'));await fs.mkdir(path.join(root,'target'));
  encoded ??= gzipSync(output);
  const contract={schemaVersion:1,archive:{path:'archive/source.gz',bytes:encoded.length,sha256:hash(encoded)},
    output:{path:'target/asset.glb',bytes:output.length,sha256:hash(output)}};
  await fs.writeFile(path.join(root,contract.archive.path),encoded);
  return {root,contract,output,target:path.join(root,contract.output.path),temporary:path.join(root,'target/.asset.glb.materializing-node')};
}
const absent = async file => assert.rejects(fs.lstat(file),{code:'ENOENT'});

test('D2 Node materializer publishes exact bounded approved bytes and leaves no staging file',async t=>{
  const f=await fixture(t); const result=await createD2Materializer({contract:f.contract})({root:f.root});
  assert.equal(result.status,'materialized-and-verified');assert.equal(result.sha256,hash(f.output));
  assert.deepEqual(await fs.readFile(f.target),f.output);await absent(f.temporary);
});

test('D2 correct existing output is verified without rewriting or requiring archive',async t=>{
  const f=await fixture(t);await fs.writeFile(f.target,f.output);await fs.unlink(path.join(f.root,f.contract.archive.path));
  const before=await fs.stat(f.target);
  const result=await createD2Materializer({contract:f.contract})({root:f.root});
  const after=await fs.stat(f.target);
  assert.equal(result.status,'already-verified');assert.equal(before.ino,after.ino);assert.equal(before.mtimeMs,after.mtimeMs);
});

test('D2 wrong existing output fails closed and remains byte-for-byte unchanged',async t=>{
  const f=await fixture(t);const wrong=Buffer.alloc(f.output.length,65);await fs.writeFile(f.target,wrong);
  await assert.rejects(createD2Materializer({contract:f.contract})({root:f.root}),/hash/);
  assert.deepEqual(await fs.readFile(f.target),wrong);await absent(f.temporary);
});

test('D2 archive corruption and expanded oversize are rejected without publication',async t=>{
  for(const options of [{encoded:Buffer.from('not-gzip')},{encoded:gzipSync(Buffer.alloc(1024,65)),output:Buffer.from('tiny')}]) {
    const f=await fixture(t,options);
    await assert.rejects(createD2Materializer({contract:f.contract})({root:f.root}));
    await absent(f.target);await absent(f.temporary);
  }
  const f=await fixture(t);await fs.writeFile(path.join(f.root,f.contract.archive.path),Buffer.alloc(f.contract.archive.bytes));
  await assert.rejects(createD2Materializer({contract:f.contract})({root:f.root}),/hash/);await absent(f.target);
});

test('D2 refuses target, archive and ancestor symlinks without touching their destination',async t=>{
  const f=await fixture(t);const foreign=path.join(f.root,'foreign');await fs.mkdir(foreign);
  const destination=path.join(foreign,'asset.glb');await fs.writeFile(destination,f.output);
  await fs.symlink(destination,f.target);
  await assert.rejects(createD2Materializer({contract:f.contract})({root:f.root}),/type/);await fs.unlink(f.target);
  await fs.rmdir(path.join(f.root,'target'));await fs.symlink(foreign,path.join(f.root,'target'),'dir');
  await assert.rejects(createD2Materializer({contract:f.contract})({root:f.root}),/parent/);
  assert.deepEqual(await fs.readFile(destination),f.output);
  const g=await fixture(t);const archive=path.join(g.root,g.contract.archive.path);
  await fs.rename(archive,archive+'.real');await fs.symlink(archive+'.real',archive);
  await assert.rejects(createD2Materializer({contract:g.contract})({root:g.root}),/type/);
});

test('D2 supports interruption at every pipeline boundary and cleans owned staging after late abort',async t=>{
  for(const stage of ['start','before-archive','before-decode','decoded','before-staging','before-publish']) {
    const f=await fixture(t),controller=new AbortController();
    const materialize=createD2Materializer({contract:f.contract,checkpoint:point=>{if(point===stage)controller.abort();}});
    await assert.rejects(materialize({root:f.root,signal:controller.signal}),{code:'ABORT_ERR'});
    await absent(f.target);await absent(f.temporary);
  }
});

test('D2 atomic publication failures and concurrent output never overwrite another file',async t=>{
  const f=await fixture(t);
  await assert.rejects(createD2Materializer({contract:f.contract,link:async()=>{throw Error('injected-publish-failure');}})({root:f.root}),/publish/);
  await absent(f.target);await absent(f.temporary);
  const wrong=Buffer.from('concurrent-owner');
  const materialize=createD2Materializer({contract:f.contract,checkpoint:async stage=>{if(stage==='before-publish')await fs.writeFile(f.target,wrong);}});
  await assert.rejects(materialize({root:f.root}),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(f.target),wrong);await absent(f.temporary);
});

test('D2 never deletes an existing unowned temporary file',async t=>{
  const f=await fixture(t);await fs.writeFile(f.temporary,'unowned');
  await assert.rejects(createD2Materializer({contract:f.contract})({root:f.root}),{code:'EEXIST'});
  assert.equal(await fs.readFile(f.temporary,'utf8'),'unowned');await absent(f.target);
});

test('D2 shared contract pins authentic source facts and existing real asset verifies read-only',async t=>{
  const contract=JSON.parse(await fs.readFile(CONTRACT_FILE,'utf8'));
  assert.equal(contract.archive.bytes,10915162);assert.equal(contract.output.bytes,16867596);
  assert.equal(contract.output.sha256,'84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a');
  const target=path.join(__dirname,'../research/animation-0.1.0',contract.output.path);
  let before;
  try { before=await fs.stat(target); } catch(error) {
    if(error.code!=='ENOENT')throw error;
    t.skip('Approved D2 output is not materialized; real-asset read-only check not run');return;
  }
  const result=await materializeD2();const after=await fs.stat(target);
  assert.equal(result.status,'already-verified');assert.equal(before.ino,after.ino);assert.equal(before.mtimeMs,after.mtimeMs);
});

test('D2 rejects unsafe contract paths and CLI model/profile overrides before doing work',async()=>{
  for(const item of ['/outside','../outside','https://model','a/../b','a\\..\\b']) {
    assert.throws(()=>createD2Materializer({contract:{schemaVersion:1,archive:{path:item,bytes:1,sha256:'a'.repeat(64)},
      output:{path:'target/asset.glb',bytes:1,sha256:'b'.repeat(64)}}}),/contract/);
  }
  await assert.rejects(promisify(execFile)(process.execPath,[path.join(__dirname,'../tools/pet-realtime-capture/materialize-d2.mjs'),'--root=/outside']),
    error=>error.code===2&&/accepts no arguments/.test(error.stderr));
});

test('D2 missing output parents are created only after archive verification',async t=>{
  const f=await fixture(t);await fs.rmdir(path.join(f.root,'target'));
  const contract=structuredClone(f.contract);contract.output.path='target/nested/asset.glb';
  const target=path.join(f.root,contract.output.path);
  await createD2Materializer({contract})({root:f.root});
  assert.deepEqual(await fs.readFile(target),f.output);
  const invalid=await fixture(t);await fs.rmdir(path.join(invalid.root,'target'));
  await fs.writeFile(path.join(invalid.root,invalid.contract.archive.path),Buffer.alloc(invalid.contract.archive.bytes));
  await assert.rejects(createD2Materializer({contract:invalid.contract})({root:invalid.root}),/hash/);
  await absent(path.join(invalid.root,'target'));
});
