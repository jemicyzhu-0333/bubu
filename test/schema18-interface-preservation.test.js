const ROOT = require('node:path').join(__dirname, '..');
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {fixture,NOW,facts,tracedFactory}=require(ROOT+'/test-support/config-admission-fixture');
const {encodePayload}=require(ROOT+'/src/platform/persistence/sqlite/config-authority-schema');
for(const live of [false,true])test(`complete schema18 settings without locale/theme are rejected byte-exact; live WAL=${live}`,t=>{
 const f=fixture(t),r=f.open();r.update(s=>{s.settings.autoCheckUpdates=false;s.pet.satiation=44.9;},{now:NOW});r.close();
 const db=new DatabaseSync(f.database), identity=new DatabaseSync(f.identity);
 const state=JSON.parse(db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
 state.schemaVersion=18;delete state.settings.locale;delete state.settings.theme;
 const v=encodePayload(state);
 db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?').run(v.version,v.hash,v.json,v.mirrorHash);
 if(live)f.retain([db,identity]);else {db.close();identity.close();}
 const before=f.capture(),beforeFacts=facts(before),events=[];let normalizations=0;
 assert.throws(()=>f.open({authorityFactory:tracedFactory(events),normalize(){normalizations++;throw Error('must not normalize');}}));
 assert.equal(normalizations,0);assert.deepEqual(f.capture(),before);assert.deepEqual(facts(f.capture()),beforeFacts);
 assert.ok(events.every(e=>e.kind==='open'&&e.readOnly&&path.dirname(e.filePath)!==f.directory));
});
