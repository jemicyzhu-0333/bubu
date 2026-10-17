'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {fixture,ports}=require('../stage/test-support/preferences-upgrade-fixture');
const {createSqliteStateAdapter}=require('../stage/src/platform/persistence/sqlite-state-adapter');
const {inspectProfileUpgradeBackup}=require('../stage/src/platform/persistence/sqlite/profile-upgrade-backup-container');
const {normalizePersistedState,assertCanonicalPersistedState,assertCanonicalSchema20}=require('../stage/src/platform/persistence/persisted-schema');
const {prepareThemeIdentityUpgrade}=require('../stage/src/application/workflows/upgrade-theme-identity');
for(const live of [false,true])test(`real SQLite schema20→21 keeps original bytes in verified backup; live WAL=${live}`,t=>{
 const f=fixture(t,{sourceVersion:20,live});const before=f.capture();const upgrade=f.prepare();assert.equal(upgrade.sourceVersion,20);assert.equal(upgrade.targetVersion,21);assert.deepEqual(f.capture(),before);
 assert.throws(()=>upgrade.execute('not-approved'),/confirmation-required/);assert.deepEqual(f.capture(),before);
 const result=upgrade.execute(upgrade.confirmation);assert.equal(result.status,'upgraded');
 const db=new DatabaseSync(result.backupFile,{readOnly:true});try{const rows=db.prepare("SELECT relative_path,bytes FROM upgrade_files WHERE kind='file'").all();for(const row of rows)assert.deepEqual(Buffer.from(row.bytes),before[row.relative_path].bytes);}finally{db.close();}
 const p=ports(),handle=p.makeHandle(p.driver.open(result.backupFile,{readOnly:true}));try{assert.equal(inspectProfileUpgradeBackup(handle).manifest.binding.targetVersion,21);}finally{handle.close();}
 const reopened=createSqliteStateAdapter({userDataPath:f.directory});const expected=structuredClone(f.state);expected.schemaVersion=21;assert.deepEqual(reopened.snapshot(),expected);reopened.close();
 const twice=createSqliteStateAdapter({userDataPath:f.directory});assert.deepEqual(twice.snapshot(),expected);twice.close();
 assert.throws(()=>f.prepare(),/source-invalid/);assert.throws(()=>upgrade.execute(upgrade.confirmation),/confirmation-required/);
});
for(const boundary of ['admitted','candidate-validated','before-writer','evidence-written','payload-written','before-commit'])test(`upgrade fault ${boundary} cannot leave mutated business payload`,t=>{
 const f=fixture(t,{sourceVersion:20});const before=structuredClone(f.state);
 const upgrade=f.prepare({checkpoint:where=>{if(where===boundary)throw new Error('synthetic-fault');}});
 assert.throws(()=>upgrade.execute(upgrade.confirmation),/synthetic-fault/);
 const db=new DatabaseSync(f.database,{readOnly:true});try{const row=db.prepare('SELECT payload_json FROM config_snapshot').get();assert.deepEqual(JSON.parse(row.payload_json),before);}finally{db.close();}
});
test('pure upgrade is byte-meaning preserving, rejects corruption, and adds no historical eligibility',()=>{
 const source=normalizePersistedState({}, {now:1800000000000});source.schemaVersion=20;assertCanonicalSchema20(source);
 const next=prepareThemeIdentityUpgrade(source,{assertSource:assertCanonicalSchema20,assertTarget:assertCanonicalPersistedState});assert.deepEqual(next,{...source,schemaVersion:21});
 const corrupt=structuredClone(source);corrupt.pet.foodTickets='invalid';assert.throws(()=>prepareThemeIdentityUpgrade(corrupt,{assertSource:assertCanonicalSchema20,assertTarget:assertCanonicalPersistedState}),/invalid-pet-count/);
 const malformed=structuredClone(next);malformed.routines=[{id:'a',title:'a',kind:'stimulant',createdAt:1}];assert.throws(()=>assertCanonicalPersistedState(malformed));
});
