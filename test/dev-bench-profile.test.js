'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createDisposableProfile, readDisposableProfile, removeDisposableProfile } = require('../tools/dev-bench/profile-fixture');
const { launchBench } = require('../tools/dev-bench/launch');
const { verifyManualGrowth, verifyPersistedScenario, finishSmoke } = require('../tools/dev-bench/smoke');
const { verifyInstall, waitForOutcome } = require('../scripts/verify-macos-install');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { assertCanonicalPersistedState } = require('../src/platform/persistence/persisted-schema');
const { encodePayload } = require('../src/platform/persistence/sqlite/config-authority-schema');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { createUnitOfWork, createCompleteWorkStepWorkflow, createCompleteWorkItemWorkflow } = require('../src/application');
const { seriesRefresh } = require('../src/capabilities/work');
const { localDayKey } = require('../src/core/calendar');
const NOW = new Date(2026, 9, 7, 12).getTime();

function profileFor(t, scenario = 'level-up') {
  const profile = createDisposableProfile({ scenario, now: NOW });
  t.after(() => fs.rmSync(profile.root, { recursive: true, force: true }));
  return profile;
}
const bytes = directory => Object.fromEntries(fs.readdirSync(directory).sort()
  .map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')]));
function mutatePayload(profile, mutate) {
  const db = new DatabaseSync(path.join(profile.userDataPath, 'config.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
    mutate(state);
    const encoded = encodePayload(state);
    db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?')
      .run(encoded.version, encoded.hash, encoded.json, encoded.mirrorHash);
  } finally { db.close(); }
}
function tracedFactory(events) {
  return options => createSqliteStateAdapter({ ...options, authorityFactory: config => openSqliteConfigAuthority(config, {
    selectDriver: () => ({ open(file, settings = {}) {
      events.push({ kind: 'open', readOnly: settings.readOnly === true });
      return new DatabaseSync(file, settings);
    } }),
    makeHandle: db => ({
      exec(sql) { events.push({ kind: 'write', sql }); db.exec(sql); },
      run(sql, args = []) { events.push({ kind: 'write', sql }); return db.prepare(sql).run(...args); },
      get: (sql, args = []) => db.prepare(sql).get(...args),
      all: (sql, args = []) => db.prepare(sql).all(...args),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
    })
  }) });
}

test('fixture creates canonical18 SQL and identity, closes, then reopens at the same revision without a JSON mirror', t => {
  const profile = profileFor(t);
  assert.equal(profile.initial.level, 1);
  assert.equal(profile.initial.xp, 0);
  assert.equal(fs.existsSync(path.join(profile.userDataPath, 'config.json')), false);
  const persisted = readDisposableProfile(profile);
  assertCanonicalPersistedState(persisted.state);
  assert.deepEqual(persisted.state, profile.initial);
  assert.equal(persisted.revision, profile.revision);
  const db = new DatabaseSync(path.join(profile.userDataPath, 'config.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT payload_version FROM config_snapshot').get().payload_version, 18);
  } finally { db.close(); }
  assert.deepEqual(readDisposableProfile(profile), persisted);
});

test('fixture verification rejects arbitrary paths and copied handles before opening a repository', t => {
  const profile = profileFor(t);
  for (const unknown of [profile.userDataPath, { ...profile }, { userDataPath: '/not-a-test-profile' }]) {
    assert.throws(() => readDisposableProfile(unknown, { repositoryFactory: () => assert.fail('must not open') }), /not-owned/);
  }
  assert.throws(() => createDisposableProfile({ userDataPath: profile.userDataPath }), /options-invalid/);
});

for (const failure of ['missing SQL', 'missing identity', 'JSON only', 'corrupt SQL', 'old payload', 'future payload', 'malformed18', 'changed identity']) {
  test(`fixture read refuses ${failure} with zero mutation, replacement or proof`, t => {
    const profile = profileFor(t);
    const sql = path.join(profile.userDataPath, 'config.sqlite');
    const identity = `${sql}.identity.sqlite`;
    if (failure === 'missing SQL' || failure === 'JSON only') fs.rmSync(sql);
    if (failure === 'missing identity' || failure === 'JSON only') fs.rmSync(identity);
    if (failure === 'JSON only') fs.writeFileSync(path.join(profile.userDataPath, 'config.json'), JSON.stringify(profile.initial));
    if (failure === 'corrupt SQL') fs.writeFileSync(sql, 'synthetic corrupt database');
    if (failure === 'old payload') mutatePayload(profile, state => { state.schemaVersion = 17; });
    if (failure === 'future payload') mutatePayload(profile, state => { state.schemaVersion = 19; });
    if (failure === 'malformed18') mutatePayload(profile, state => { delete state.pet.foodTickets; });
    if (failure === 'changed identity') fs.writeFileSync(identity, 'synthetic changed identity');
    const before = bytes(profile.userDataPath), events = [];
    assert.throws(() => readDisposableProfile(profile, { repositoryFactory: tracedFactory(events) }));
    assert.ok(events.every(event => event.kind === 'open' && event.readOnly), 'no write handle or startup proof');
    assert.deepEqual(bytes(profile.userDataPath), before);
  });
}

test('fixture refuses a replaced directory or symlink without following it', t => {
  const profile = profileFor(t);
  const preserved = `${profile.userDataPath}-preserved`;
  fs.renameSync(profile.userDataPath, preserved);
  fs.symlinkSync(preserved, profile.userDataPath, 'dir');
  const before = bytes(preserved);
  assert.throws(() => readDisposableProfile(profile, { repositoryFactory: () => assert.fail('must not open') }), /path-replaced/);
  assert.deepEqual(bytes(preserved), before);
});

for (const stage of ['setup', 'commit', 'close']) test(`failed fixture ${stage} never launches main or selects a profile`, t => {
  let root, closes = 0;
  const createProfile = options => createDisposableProfile({ ...options, now: NOW }, {
    repositoryFactory(config) {
      root = path.dirname(config.userDataPath);
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      if (stage === 'setup') throw new Error('fixture setup failure');
      const repository = createSqliteStateAdapter(config);
      return { ...repository,
        commit(...args) { if (stage === 'commit') throw new Error('fixture commit failure'); return repository.commit(...args); },
        close() { closes++; repository.close(); if (stage === 'close') throw new Error('fixture close failure'); }
      };
    }
  });
  assert.throws(() => launchBench({ app: { isPackaged: false, setPath: () => assert.fail('must not select') },
    argv: ['node', '--scenario=level-up'], createProfile, startMain: () => assert.fail('must not launch'), log() {} }),
  new RegExp(`fixture ${stage} failure`));
  assert.equal(closes, stage === 'setup' ? 0 : 1);
});

test('bench refuses packaged/unknown scenarios and launches only after the seeded repository closes', t => {
  for (const options of [{ app: { isPackaged: true } }, { app: { isPackaged: false }, argv: ['--scenario=unknown'] }]) {
    assert.throws(() => launchBench({ ...options, createProfile: () => assert.fail('must not create'), startMain: () => assert.fail('must not launch') }));
  }
  const selected = [], argv = ['--scenario=level-up'];
  let closed = false;
  const profile = launchBench({ app: { isPackaged: false, setPath: (...args) => selected.push(args) }, argv, log() {},
    createProfile: options => createDisposableProfile({ ...options, now: NOW }, { repositoryFactory: config => {
      const repo = createSqliteStateAdapter(config);
      t.after(() => fs.rmSync(path.dirname(config.userDataPath), { recursive: true, force: true }));
      return { ...repo, close() { repo.close(); closed = true; } };
    } }),
    startMain() { assert.equal(closed, true); }
  });
  assert.deepEqual(selected, [['userData', profile.userDataPath], ['sessionData', profile.userDataPath]]);
  assert.ok(argv.includes('--dev'));
});

for (const scenario of ['level-up', 'flame-near']) test(`${scenario} smoke ports exercise actual SQLite manual workflows, ticket idempotence and no food drop`, async t => {
  const profile = profileFor(t, scenario);
  const repository = createSqliteStateAdapter({ userDataPath: profile.userDataPath, now: () => NOW });
  const facts = [];
  const common = { unitOfWork: createUnitOfWork({ repository }), clock: { now: () => NOW }, idFactory: () => 'unused',
    publish: fact => facts.push(fact) };
  const readState = () => {
    const state = repository.snapshot();
    return { tasks: state.tasks, nowTaskId: state.nowTaskId, level: state.level, xp: state.xp,
      foodTickets: state.pet.foodTickets, feedState: { foodInventory: state.pet.foodInventory } };
  };
  let growth;
  try {
    growth = await verifyManualGrowth({ readState,
      completeStep: (taskId, stepId) => createCompleteWorkStepWorkflow(common).execute({ taskId, stepId }),
      completeTask: taskId => createCompleteWorkItemWorkflow(common).execute({ taskId })
    }, readState());
    assert.equal(repository.revision(), profile.revision + 2, 'only step and parent commit; retries write nothing');
    assert.equal(facts[0].reward.firstAdvance, true);
    assert.equal(facts[0].ticketsGranted, true);
    assert.equal(facts[1].reward.awardedReward, 0);
    assert.equal(facts[1].foodDrop, null);
    assert.equal(facts[1].ticketsGranted, false);
    if (scenario === 'flame-near') assert.ok(facts[0].newlyUnlockedSkins.includes('flame'));
  } finally { repository.close(); }
  const persisted = readDisposableProfile(profile);
  verifyPersistedScenario(profile, persisted, growth);
  assert.equal(persisted.revision, profile.revision + 2);
  assert.deepEqual(readDisposableProfile(profile), persisted);
});

test('non-macOS installer fails before allocating a profile or invoking OS ports', async () => {
  await assert.rejects(verifyInstall({ platform: 'linux', createProfile: () => assert.fail('must not allocate'),
    execFile: () => assert.fail('must not execute'), spawnChild: () => assert.fail('must not spawn') }), /requires macOS/);
});

test('outcome wait distinguishes an actual exit from timeout and propagates rejection', async () => {
  assert.deepEqual(await waitForOutcome(Promise.resolve({ code: 0 }), 10), { code: 0 });
  assert.equal(await waitForOutcome(new Promise(() => {}), 1), null);
  await assert.rejects(waitForOutcome(Promise.reject(new Error('synthetic wait failure')), 10), /wait failure/);
});

function installPorts(t, mode = 'success') {
  let fixture, child, completed = false, reads = 0;
  const calls = [];
  const writeAsar = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'synthetic asar'); };
  const createProfile = options => {
    fixture = createDisposableProfile(options);
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    return fixture;
  };
  const ports = { platform: 'darwin', now: NOW, argv: ['node', 'verify', path.join(__dirname, 'dev-bench.test.js')],
    createProfile, log(message) { calls.push(['report', JSON.parse(message)]); },
    execFile(command, args) {
      calls.push([command, args]);
      if (command === 'hdiutil' && args[0] === 'attach') {
        assert.ok(args.includes('-readonly'));
        writeAsar(path.join(args.at(-2), 'I’m ADHDer.app/Contents/Resources/app.asar'));
      }
      if (command === 'hdiutil' && args[0] === 'detach' && mode === 'detach-error') throw new Error('synthetic detach failure');
      if (command === 'ditto') {
        const file = path.join(args[1], 'Contents/Resources/app.asar');
        writeAsar(file);
        if (mode === 'hash-mismatch') fs.appendFileSync(file, 'changed');
      }
      if (command === '/usr/bin/codesign' && mode === 'signature-error') throw new Error('synthetic invalid code signature');
      if (command === 'osascript') {
        assert.match(args.at(-1), /runningApplicationWithProcessIdentifier\(12345\)/);
        assert.ok(args.at(-1).includes(JSON.stringify(path.join(fixture.root, 'Applications/I’m ADHDer.app/Contents/MacOS/I’m ADHDer'))));
        if (mode === 'quit-error') throw new Error('synthetic quit failure');
        if (mode !== 'quit-timeout') {
          completed = true;
          child.emit('close', mode === 'exit-signal' ? null : 0, mode === 'exit-signal' ? 'SIGTERM' : null);
        }
      }
    },
    spawnChild(executable, args) {
      calls.push(['spawn', executable]);
      assert.equal(executable, path.join(fixture.root, 'Applications/I’m ADHDer.app/Contents/MacOS/I’m ADHDer'));
      assert.deepEqual(args, [`--user-data-dir=${fixture.userDataPath}`, '--dev']);
      const repo = createSqliteStateAdapter({ userDataPath: fixture.userDataPath, now: () => NOW });
      try {
        if (mode !== 'no-startup-write') repo.update(state => {
          seriesRefresh.refreshSeriesOccurrences(state, { now: NOW, today: localDayKey(NOW) }, { createId: () => 'unused' });
        }, { now: NOW });
      } finally { repo.close(); }
      child = new EventEmitter(); child.pid = 12345; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = signal => { completed = true; child.emit('close', null, signal); };
      if (mode === 'spawn-error') queueMicrotask(() => {
        child.emit('error', new Error('synthetic spawn failure'));
        completed = true; child.emit('close', -2, null);
      });
      return child;
    },
    async wait(completion, delay) {
      if (delay === 6000) {
        if (mode === 'spawn-error') return completion;
        if (mode === 'early-exit') { completed = true; child.emit('close', 1, null); return completion; }
        return null;
      }
      if (!completed) return null;
      return completion;
    },
    readProfile(profile) { reads++; assert.equal(completed, true); return readDisposableProfile(profile); },
    removeProfile(profile) {
      if (mode === 'cleanup-error') throw new Error('synthetic cleanup failure');
      removeDisposableProfile(profile);
    }
  };
  return { ports, calls, reads: () => reads, fixture: () => fixture };
}

test('installer fake OS ports verify SQL only after graceful child close, then detach and clean the owned profile', async t => {
  const f = installPorts(t);
  const report = await verifyInstall(f.ports);
  assert.equal(report.result, 'passed');
  assert.equal(report.codeSignature.integrity, 'codesign-deep-strict-verified');
  assert.match(report.gatekeeperAcceptance, /not asserted/);
  const commands = f.calls.map(call => call[0]);
  assert.ok(commands.indexOf('ditto') < commands.indexOf('/usr/bin/codesign'));
  assert.ok(commands.indexOf('/usr/bin/codesign') < commands.indexOf('spawn'));
  assert.equal(f.reads(), 1);
  assert.equal(f.calls.at(-2)[1][0], 'detach');
  assert.equal(f.calls.at(-1)[0], 'report');
  assert.equal(fs.existsSync(f.fixture().root), false);
});
for (const mode of ['signature-error', 'early-exit', 'quit-timeout', 'no-startup-write', 'spawn-error', 'detach-error', 'cleanup-error', 'hash-mismatch', 'quit-error', 'exit-signal']) test(`installer refuses ${mode} without a native acceptance result`, async t => {
  const f = installPorts(t, mode);
  await assert.rejects(verifyInstall(f.ports));
  if (mode === 'signature-error') assert.equal(f.calls.some(([command]) => command === 'spawn'), false);
  assert.equal(f.reads(), ['no-startup-write', 'detach-error', 'cleanup-error'].includes(mode) ? 1 : 0);
  assert.equal(f.calls.some(([command]) => command === 'report'), false);
  assert.equal(f.calls.at(-1)[1][0], 'detach');
  assert.equal(fs.existsSync(f.fixture().root), ['detach-error', 'cleanup-error'].includes(mode));
});


test('default smoke rejects canonical-but-wrong task persistence and drift from the final scoped projection', t => {
  const profile = profileFor(t, 'all');
  const persisted = readDisposableProfile(profile);
  verifyPersistedScenario(profile, persisted, null, persisted.state.tasks);
  const wrong = structuredClone(persisted);
  wrong.state.tasks[0].title = 'Unexpected replacement';
  assertCanonicalPersistedState(wrong.state);
  assert.throws(() => verifyPersistedScenario(profile, wrong, null, persisted.state.tasks));
  const lost = structuredClone(persisted);
  lost.state.tasks = [];
  assert.throws(() => verifyPersistedScenario(profile, lost, null, persisted.state.tasks));
  const expected = structuredClone(persisted.state.tasks);
  expected.find(task => task.seriesId).occurrenceDate = localDayKey(NOW);
  assert.throws(() => verifyPersistedScenario(profile, persisted, null, expected), /shutdown must retain/);
});

for (const failure of [false, true]) test(`smoke persistence verification follows main close and ${failure ? 'fails closed' : 'reports once'}`, t => {
  const profile = profileFor(t, 'all');
  const persisted = readDisposableProfile(profile);
  const app = new EventEmitter(), events = [];
  app.once('will-quit', () => events.push('main closed'));
  app.quit = () => app.emit('will-quit', { preventDefault() { events.push('prevent quit'); } });
  finishSmoke({ app, profile, report: { expectedTasks: persisted.state.tasks },
    readProfile() {
      assert.deepEqual(events, ['main closed', 'prevent quit']);
      events.push('verify SQL');
      if (failure) throw new Error('synthetic read failure');
      return persisted;
    },
    log() { events.push('report'); },
    finish(error) { assert.equal(Boolean(error), failure); events.push(failure ? 'exit 1' : 'exit 0'); }
  });
  assert.deepEqual(events, ['main closed', 'prevent quit', 'verify SQL', ...(failure ? ['exit 1'] : ['report', 'exit 0'])]);
});

for (const failure of ['snapshot', 'close']) test(`admission probe ${failure} failure closes its handle and never opens original SQL`, t => {
  const profile = profileFor(t), before = bytes(profile.userDataPath);
  let probePath, closes = 0;
  assert.throws(() => readDisposableProfile(profile, { repositoryFactory(options) {
    assert.notEqual(options.userDataPath, profile.userDataPath, 'failed admission cannot open original');
    probePath = options.userDataPath;
    const repository = createSqliteStateAdapter(options);
    return { ...repository,
      snapshot() { if (failure === 'snapshot') throw new Error('synthetic snapshot failure'); return repository.snapshot(); },
      close() { closes++; repository.close(); if (failure === 'close') throw new Error('synthetic close failure'); }
    };
  } }), /synthetic/);
  assert.equal(closes, 1);
  assert.equal(fs.existsSync(probePath), false);
  assert.deepEqual(bytes(profile.userDataPath), before);
});

test('admission copy is never returned as persistence evidence, and changed source bytes stop the original reopen', t => {
  const profile = profileFor(t);
  const opened = [];
  assert.throws(() => readDisposableProfile(profile, { repositoryFactory(options) {
    opened.push(options.userDataPath);
    assert.notEqual(options.userDataPath, profile.userDataPath);
    const repository = createSqliteStateAdapter(options);
    return { ...repository, close() {
      repository.close();
      mutatePayload(profile, state => { state.xp = 1; });
    } };
  } }), /changed-during-read/);
  assert.equal(opened.length, 1);
  assert.equal(fs.existsSync(opened[0]), false);
});


for (const name of ['config.sqlite-wal', 'config.sqlite-shm', 'config.sqlite.identity.sqlite-wal', 'config.sqlite.identity.sqlite-shm']) {
  for (const dangling of [false, true]) test(`fixture rejects ${dangling ? 'dangling' : 'existing'} ${name} symlink before admission`, t => {
    const profile = profileFor(t), sidecar = path.join(profile.userDataPath, name);
    const target = path.join(profile.root, 'synthetic-sidecar-target');
    if (!dangling) fs.writeFileSync(target, 'untouched synthetic sentinel');
    fs.rmSync(sidecar, { force: true });
    fs.symlinkSync(target, sidecar);
    assert.throws(() => readDisposableProfile(profile, { repositoryFactory: () => assert.fail('must not open') }), /sidecar-invalid/);
    assert.equal(fs.readlinkSync(sidecar), target);
    if (!dangling) assert.equal(fs.readFileSync(target, 'utf8'), 'untouched synthetic sentinel');
    else assert.equal(fs.existsSync(target), false);
  });
}

test('cleanup accepts only its own unchanged disposable directories', t => {
  const profile = profileFor(t);
  assert.throws(() => removeDisposableProfile({ ...profile }), /not-owned/);
  assert.ok(fs.existsSync(profile.userDataPath));
  removeDisposableProfile(profile);
  assert.equal(fs.existsSync(profile.root), false);
  assert.throws(() => readDisposableProfile(profile), /not-owned/);
});
