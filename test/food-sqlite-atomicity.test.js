'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createBuyCompanionFoodWorkflow } = require('../src/application/workflows/buy-companion-food');
const { createFeedCompanionWorkflow } = require('../src/application/workflows/feed-companion');
const { FOODS, START } = require('../test-support/growth-food-fixture');
const { foodRequest } = require('../test-support/food-request-fixture');
const { faultFactory } = require('../test-support/sqlite-authority-faults');
function row(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { ...db.prepare('SELECT revision, payload_json, payload_hash FROM config_snapshot').get() }; }
  finally { db.close(); }
}
for (const kind of ['buy', 'feed']) {
  test(`real SQLite ${kind} COMMIT refusal leaves the entire food transaction unchanged across reopen`, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `food-${kind}-before-`));
    const database = path.join(directory, 'config.sqlite'); let repo, armed = false, reached = 0;
    t.after(() => { repo?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const options = { userDataPath: directory, now: () => START };
    repo = createSqliteStateAdapter({ ...options, authorityFactory: faultFactory(event => {
      if (armed && event.filePath === database && event.type === 'before' && event.sql === 'COMMIT') {
        armed = false; reached++; throw new Error('synthetic food COMMIT refusal');
      }
    }) });
    repo.update(s => { s.pet.satiation = 40; }, { now: START });
    const before = repo.snapshot(), revision = repo.revision(), sql = row(database), effects = [], request = foodRequest(kind === 'feed' ? 'basic' : 'berry', START);
    const make = () => (kind === 'feed' ? createFeedCompanionWorkflow : createBuyCompanionFoodWorkflow)({
      unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => START }, foods: FOODS, publish: fact => effects.push(fact)
    });
    armed = true; assert.throws(() => make().execute(request), /synthetic food COMMIT refusal/);
    assert.equal(reached, 1); assert.deepEqual(repo.snapshot(), before); assert.equal(repo.revision(), revision); assert.deepEqual(row(database), sql);
    assert.deepEqual(effects, []); repo.close(); repo = createSqliteStateAdapter(options);
    assert.deepEqual(repo.snapshot(), before); assert.equal(make().execute(request).ok, true); assert.equal(make().execute(request).replayed, true);
    assert.equal(repo.revision(), revision + 1); assert.equal(effects.length, 1);
  });
  test(`landed but unverified SQLite ${kind} keeps its request locked until recovery then replays exactly once`, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `food-${kind}-unknown-`));
    const database = path.join(directory, 'config.sqlite'); let repo, armed = false, blocked = false;
    t.after(() => { repo?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const options = { userDataPath: directory, now: () => START };
    repo = createSqliteStateAdapter({ ...options, authorityFactory: faultFactory(event => {
      if (armed && event.filePath === database && event.type === 'after' && event.sql === 'COMMIT') {
        armed = false; blocked = true; throw new Error('synthetic landed food acknowledgement loss');
      }
      if (blocked && event.filePath === database && event.type === 'open' && event.readOnly) throw new Error('synthetic food readback unavailable');
    }) });
    const effects = [], request = foodRequest('berry', START), before = repo.snapshot(), revision = repo.revision();
    const make = () => (kind === 'feed' ? createFeedCompanionWorkflow : createBuyCompanionFoodWorkflow)({
      unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => START }, foods: FOODS, publish: fact => effects.push(fact)
    });
    armed = true; assert.throws(() => make().execute(request), /outcome-unknown/); assert.throws(() => make().execute(request), /outcome-unknown/);
    assert.deepEqual(effects, []); repo.close(); repo = createSqliteStateAdapter(options);
    assert.equal(repo.revision(), revision + 1); const after = repo.snapshot();
    assert.equal(after.pet.foodInventory.berry, before.pet.foodInventory.berry + (kind === 'buy' ? 1 : -1));
    assert.equal(after.pet.foodTickets, before.pet.foodTickets - (kind === 'buy' ? 1 : 0));
    assert.equal(make().execute(request).replayed, true); assert.deepEqual(repo.snapshot(), after); assert.deepEqual(effects, []);
  });
}
