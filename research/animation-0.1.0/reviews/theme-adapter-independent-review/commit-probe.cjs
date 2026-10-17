const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const file=path.resolve(__dirname,'../bubu-theme-commit-adapter-20261017/tests/commit-integration.test.cjs');
const prefix=fs.readFileSync(file,'utf8').split("test('real complete")[0];
const {fixture,T}=new Function('require',prefix+'\nreturn {fixture,T};')(createRequire(file));
const f=fixture();const r=f.command.log({routineId:'routine-a',status:'done'});const first=f.events.at(-1).completion;
f.setNow(T+100);f.feed.execute(f.request('feed1'));f.setNow(T+200);f.feed.execute(f.request('feed2'));
f.setNow(T+300);f.command.undo({occurrenceId:r.occurrenceId});assert.equal(f.project().sources.filter(x=>x.active).length,2);
f.setNow(T+1000);f.command.log({routineId:'routine-a',occurrenceId:r.occurrenceId,status:'done'});assert.equal(f.events.at(-1).completion.generation,first.generation);assert.equal(f.project().themes[0].expiresAt,T+600000);
f.setNow(T+2000);f.command.log({routineId:'routine-a',occurrenceId:r.occurrenceId,status:'skipped'});f.setNow(T+3000);f.command.log({routineId:'routine-a',occurrenceId:r.occurrenceId,status:'done'});assert.equal(f.events.at(-1).completion.generation,first.generation);
f.setNow(T+4000);f.command.undo({occurrenceId:r.occurrenceId});f.setNow(T+901000);f.command.log({routineId:'routine-a',occurrenceId:r.occurrenceId,status:'done'});assert.equal(f.project().themes.length,0);assert.equal(f.events.at(-1).completion.generation,first.generation);
// Explicitly new free record is a distinct real completion, despite freed/reused raw IDs.
f.setNow(T+902000);f.command.log({routineId:'routine-a',status:'done'});assert.notEqual(f.events.at(-1).completion.generation,first.generation);assert.equal(f.project().themes[0].expiresAt,T+1502000);assert.deepEqual(f.errors,[]);
console.log(JSON.stringify({sameSlotUndoRestore:true,skipRestore:true,noReviveAfterHorizon:true,newFreeCompletion:true,revokeDoesNotClearIndependentFeeds:true,adapterErrors:0}));
