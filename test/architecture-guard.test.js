'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { importedSpecifiers, resolveSpecifier } = require('../scripts/module-imports');
const { ipcRegistrationSites } = require('../scripts/ipc-registrations');
const { layersOf, outwardEdge, isExempt } = require('../scripts/manifest-rules');
const { callOptionKeys, callReceives } = require('../scripts/call-shapes');
const { dirtyFlagReads } = require('../scripts/state-flags');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const execution = require('../src/capabilities/execution');
const work = require('../src/capabilities/work');
const attention = require('../src/capabilities/attention');
const companion = require('../src/capabilities/companion');
const {
  ACCEPT_HEALTHY_SHUTDOWN_WRITES,
  ADJUST_FOCUS_DURATION_WRITES,
  ARCHIVE_WORK_ITEM_WRITES,
  CLARIFY_WORK_ITEM_WRITES,
  COMPLETE_DUE_SESSION_WRITES,
  CREATE_WORK_ITEM_WRITES,
  EXPIRE_WORK_ITEMS_WRITES,
  COMPLETE_WORK_ITEM_WRITES,
  COMPLETE_WORK_STEP_WRITES,
  RESOLVE_FOCUS_LANDING_WRITES,
  RESOLVE_IMPULSE_WRITES,
  RESOLVE_QUICK_START_WRITES,
  RESUME_FOCUS_SESSION_WRITES,
  START_FOCUS_SESSION_WRITES,
  STOP_FOCUS_SESSION_WRITES,
  SELECT_NOW_WRITES,
  SKIP_WORK_OCCURRENCE_WRITES,
  SETTLE_FOCUS_SESSION_WRITES,
  UPDATE_WORK_ITEM_WRITES,
  RESOLVE_REVIEW_WRITES,
  FEED_COMPANION_WRITES,
  RECORD_TASK_AVOIDANCE_WRITES,
  RECORD_COMPANION_INTERACTION_WRITES
} = require('../src/application');

const ROOT = path.resolve(__dirname, '..');

test('capability manifest assigns every canonical state path to exactly one owner', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
  const owned = Object.values(manifest.capabilities).flatMap(capability => capability.statePaths);
  assert.equal(new Set(owned).size, owned.length, 'state ownership must not overlap');
  const canonical = Object.keys(normalizePersistedState({}, { now: 0 }));
  assert.deepEqual([...owned].sort(), canonical.sort());
});

test('named workflows publish their closed state write sets in the architecture manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.workflowWrites['accept-healthy-shutdown'], ACCEPT_HEALTHY_SHUTDOWN_WRITES);
  assert.deepEqual(manifest.workflowWrites['adjust-focus-duration'], ADJUST_FOCUS_DURATION_WRITES);
  assert.deepEqual(manifest.workflowWrites['archive-work-item'], ARCHIVE_WORK_ITEM_WRITES);
  assert.deepEqual(manifest.workflowWrites['clarify-work-item'], CLARIFY_WORK_ITEM_WRITES);
  assert.deepEqual(manifest.workflowWrites['complete-due-session'], COMPLETE_DUE_SESSION_WRITES);
  assert.deepEqual(manifest.workflowWrites['create-work-item'], CREATE_WORK_ITEM_WRITES);
  assert.deepEqual(manifest.workflowWrites['expire-work-items'], EXPIRE_WORK_ITEMS_WRITES);
  assert.deepEqual(manifest.workflowWrites['complete-work-item'], COMPLETE_WORK_ITEM_WRITES);
  assert.deepEqual(manifest.workflowWrites['complete-work-step'], COMPLETE_WORK_STEP_WRITES);
  assert.deepEqual(manifest.workflowWrites['resolve-focus-landing'], RESOLVE_FOCUS_LANDING_WRITES);
  assert.deepEqual(manifest.workflowWrites['resolve-impulse'], RESOLVE_IMPULSE_WRITES);
  assert.deepEqual(manifest.workflowWrites['resolve-quick-start'], RESOLVE_QUICK_START_WRITES);
  assert.deepEqual(manifest.workflowWrites['resume-focus-session'], RESUME_FOCUS_SESSION_WRITES);
  assert.deepEqual(manifest.workflowWrites['start-focus-session'], START_FOCUS_SESSION_WRITES);
  assert.deepEqual(manifest.workflowWrites['stop-focus-session'], STOP_FOCUS_SESSION_WRITES);
  assert.deepEqual(manifest.workflowWrites['select-now'], SELECT_NOW_WRITES);
  assert.deepEqual(manifest.workflowWrites['skip-work-occurrence'], SKIP_WORK_OCCURRENCE_WRITES);
  assert.deepEqual(manifest.workflowWrites['settle-focus-session'], SETTLE_FOCUS_SESSION_WRITES);
  assert.deepEqual(manifest.workflowWrites['update-work-item'], UPDATE_WORK_ITEM_WRITES);
  assert.deepEqual(manifest.workflowWrites['resolve-review'], RESOLVE_REVIEW_WRITES);
  assert.deepEqual(manifest.workflowWrites['feed-companion'], FEED_COMPANION_WRITES);
  assert.deepEqual(
    manifest.workflowWrites['record-companion-interaction'],
    RECORD_COMPANION_INTERACTION_WRITES
  );
  assert.deepEqual(manifest.workflowWrites['record-task-avoidance'], RECORD_TASK_AVOIDANCE_WRITES);
  for (const name of ['buy-companion-food', 'advance-meal-care', 'resolve-meal-decision', 'update-preferences', 'start-break-session', 'record-session-growth']) {
    const contract = require(`../src/application/workflows/${name}`);
    const declarations = Object.entries(contract).filter(([key]) => key.endsWith('_WRITES'));
    assert.equal(declarations.length, 1, `${name} has exactly one closed write set`);
    assert.deepEqual(manifest.workflowWrites[name], declarations[0][1]);
  }
  for (const name of ['preferences/update-preferences', 'execution/start-break-session', 'companion/maintain-companion-care']) {
    assert.equal(Object.hasOwn(manifest.capabilityWrites, name), false);
    assert.equal(fs.existsSync(path.join(ROOT, `src/capabilities/${name.replace('/', '/application/')}.js`)), false);
  }
});

test('capability commands publish write sets limited to their owned state', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
  assert.deepEqual(
    manifest.capabilityWrites['execution/pause-for-interruption'],
    execution.pauseForInterruption.PAUSE_FOR_INTERRUPTION_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['execution/pause-session'],
    execution.pauseSession.PAUSE_SESSION_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['execution/recover-session'],
    execution.recoverSession.RECOVER_SESSION_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['work/capture-impulse'],
    work.captureImpulse.CAPTURE_IMPULSE_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['work/discard-impulse'],
    work.discardImpulse.DISCARD_IMPULSE_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['work/duplicate-work-item'],
    work.duplicateWorkItem.DUPLICATE_WORK_ITEM_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['work/restore-work-item'],
    work.restoreWorkItem.RESTORE_WORK_ITEM_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['work/update-recurrence-series'],
    work.updateRecurrenceSeries.UPDATE_RECURRENCE_SERIES_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['guidance/materialize-due-reviews'],
    require('../src/capabilities/guidance').materializeDueReviews.MATERIALIZE_DUE_REVIEWS_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['attention/record-work-end-reminder'],
    attention.recordWorkEndReminder.RECORD_WORK_END_REMINDER_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['companion/persist-surprise-state'],
    companion.persistSurpriseState.PERSIST_SURPRISE_STATE_WRITES
  );
  assert.deepEqual(
    manifest.capabilityWrites['companion/select-skin'],
    companion.selectSkin.SELECT_SKIN_WRITES
  );
  assert.deepEqual(manifest.capabilityWrites['companion/level-up-feedback'], []);
  assert.deepEqual(manifest.capabilityWrites['attention/sitting-reminder'], []);
});

test('architecture dependency and legacy-ratchet checks pass', () => {
  const result = spawnSync(process.execPath, ['scripts/check-architecture.js'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /architecture checks passed/);
});

// 棘轮只在数字变动时开口，所以这份常驻清单是唯一持续可见的规模信号。它先前把棘轮在跟的
// 文件排掉了——照着清单读会以为仓库里最大的模块只有几百行。
test('the advisory size review lists the file the legacy ratchet tracks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
  const result = spawnSync(process.execPath, ['scripts/check-architecture.js'], { cwd: ROOT, encoding: 'utf8' });
  for (const file of Object.keys(manifest.legacyRatchet)) {
    assert.match(
      result.stdout,
      new RegExp(`${file.replace(/\./g, '\\.')}: \\d+ lines`),
      `${file} is absent from the size review; if it now fits the guide, drop its ratchet baseline instead`
    );
  }
});

test('capability boundary checks pass', () => {
  const result = spawnSync(process.execPath, ['scripts/check-boundaries.js'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /boundary checks passed/);
});

// 两个守卫脚本的纯度与依赖方向判据都建立在这一层提取上。它静默失效过一次：判据只
// 认 require()，而 core/content 目录里 .mjs 已经多于 .js——脚本照常报“通过”。因此
// 每种模块语法都要有断言，而不是只断言脚本退出 0。
test('import extraction recognizes every module syntax the repo actually uses', () => {
  assert.deepEqual(importedSpecifiers("const { app } = require('electron');"), ['electron']);
  assert.deepEqual(importedSpecifiers("import { app } from 'electron';"), ['electron']);
  assert.deepEqual(importedSpecifiers("import 'electron';"), ['electron']);
  assert.deepEqual(importedSpecifiers("export { shell } from 'electron';"), ['electron']);
  assert.deepEqual(importedSpecifiers("await import('electron');"), ['electron']);
  assert.deepEqual(
    importedSpecifiers("import a from './a.mjs';\nconst b = require('../b');"),
    ['../b', './a.mjs']
  );
});

// 判据比较还原后的路径而不是说明符字面量：ESM 必须写全扩展名，而同一个目标从不同
// 深度看是 `../main` 还是 `../../main.js`。按字面匹配会漏掉其中任意一种。
test('specifier resolution is independent of extension and nesting depth', () => {
  for (const [file, specifier] of [
    ['src/core/store-migration.js', '../main'],
    ['src/core/store-migration.js', '../main.js'],
    ['src/core/llm/openai.js', '../../main.js'],
    ['src/content/index.js', './../main.mjs']
  ]) {
    assert.equal(resolveSpecifier(file, specifier), 'src/main', `${file} -> ${specifier}`);
  }
  assert.equal(resolveSpecifier('src/core/a.mjs', '../renderer/pet.mjs'), 'src/renderer/pet');
  assert.equal(resolveSpecifier('src/core/a.mjs', 'electron'), null, '裸说明符不参与路径判据');
});

// 方向规则只能约束归了层的文件，所以归层必须是全覆盖且无歧义的：src/core（49 个文件）、
// src/content（12 个）和 src 根目录先前都不在任何层里，方向检查从来没看过它们，而 manifest
// 看上去已经声明了层。这条断言独立于守卫脚本自己走一遍 src，新目录不能再静默滑出契约。
test('every source module belongs to exactly one declared layer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
  const walk = relative => fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(`${relative}/${entry.name}`) : [`${relative}/${entry.name}`]));
  const unresolved = walk('src')
    .filter(file => /\.(?:js|mjs)$/.test(file))
    .map(file => [file, layersOf(manifest.layers, file).map(layer => layer.name)])
    .filter(([, names]) => names.length !== 1);
  assert.deepEqual(unresolved, [], '每个模块必须恰好命中一层');
});

// 前缀匹配必须按路径段收边：`src/content` 不能连带把 `src/content-pack.js` 算成 content 层，
// 否则一个同前缀的新文件会悄悄继承别人的层序。
test('layer membership matches whole path segments and reports ambiguity', () => {
  const layers = [
    { name: 'inner', paths: ['src/content', 'src/energy-engine.js'] },
    { name: 'outer', paths: ['src/surfaces'] }
  ];
  assert.deepEqual(layersOf(layers, 'src/content/index.js'), [{ name: 'inner', rank: 0 }]);
  assert.deepEqual(layersOf(layers, 'src/energy-engine.js'), [{ name: 'inner', rank: 0 }]);
  assert.deepEqual(layersOf(layers, 'src/content-pack.js'), [], '同前缀的兄弟文件不属于该层');
  assert.deepEqual(layersOf(layers, 'src/main.js'), []);
  const overlapping = [...layers, { name: 'shadow', paths: ['src/content'] }];
  assert.deepEqual(
    layersOf(overlapping, 'src/content/index.js').map(layer => layer.name),
    ['inner', 'shadow'],
    '重叠声明必须两层都报出来，不能取首个'
  );
});

// IPC 契约必须与“处理器住在哪个文件”无关，否则 legacyRatchet 要求 main.js 注册数下降，而
// 唯一的下降办法（把一族处理器搬出去）会被闭集判据判成“已声明但没有处理器”，两条规则互锁。
// 用临时目录而不是往真实 src 里塞探针：node --test 并行跑文件，改动 src 会串到别的测试。
test('IPC registration collection is independent of which module holds the handler', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'focuspix-ipc-'));
  try {
    fs.mkdirSync(path.join(fixture, 'src/platform/electron'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/main.js'), "registerIpc('state:get', () => {});\n");
    fs.writeFileSync(
      path.join(fixture, 'src/platform/electron/pet-ipc.js'),
      "registerIpc('pet:getState', () => {});\nregisterIpc('pet:feed', () => {});\n"
    );
    fs.writeFileSync(path.join(fixture, 'src/notes.md'), "registerIpc('doc:only', () => {});\n");

    assert.deepEqual(ipcRegistrationSites(fixture), [
      { channel: 'state:get', file: 'src/main.js' },
      { channel: 'pet:getState', file: 'src/platform/electron/pet-ipc.js' },
      { channel: 'pet:feed', file: 'src/platform/electron/pet-ipc.js' }
    ], '嵌套目录里的处理器同样算注册，而非源码文件不算');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

// 判据要回答的是“这个调用收到了哪些协作者”，排版不属于契约。它曾把换行和键顺序写进正
// 则，于是重排一个接线正确的调用也会报“main.js 没用某个适配器”，把读的人指到一处本来就
// 对的代码上去。
test('collaborator judgments read the call, not its formatting', () => {
  const wrapped = 'const p = registerProcessLifecycle({\n  lifecycle,\n  appHost,\n  isSessionRunning: () => isActive(session()),\n});\n';
  const inline = 'const p = registerProcessLifecycle({ isSessionRunning: () => isActive(session()), appHost, lifecycle });\n';
  const collaborators = ['appHost', 'isSessionRunning', 'lifecycle'];
  assert.deepEqual([...callOptionKeys(wrapped, 'registerProcessLifecycle')].sort(), collaborators);
  assert.deepEqual([...callOptionKeys(inline, 'registerProcessLifecycle')].sort(), collaborators);

  // 回调里的括号如果不按平衡计数跳过，实参会在第一个 `)` 处截断，它后面的协作者就全丢了。
  const nested = 'createIpcRegistrar({ ipcHost, validatePayload: (channel, p) => check({ channel, p }), senderPage });\n';
  assert.equal(callReceives(nested, 'createIpcRegistrar', ['ipcHost', 'senderPage']), true);
  assert.equal(callReceives(nested, 'createIpcRegistrar', ['ipcHost', 'appHost']), false);

  // “根本没这个调用”得和“调用了但少给了协作者”分开报，所以缺调用点时返回 null。
  assert.equal(callOptionKeys('const x = 1;\n', 'registerProcessLifecycle'), null);
  assert.equal(callReceives('const x = 1;\n', 'registerProcessLifecycle', ['lifecycle']), false);
});

// 读错一个 dirty 旗标名不会报错，只会让那个特性再也不重绘，所以这层判据必须真的会咬人：
// 它自己漏认一种写法，闭集检查就退化成永真。
test('dirty flag reads are collected from the code that decides repaints', () => {
  const source = 'if (dirty.all || dirty.pomodoro) paint();\nif (message.dirty.tasks) list();\n';
  assert.deepEqual([...dirtyFlagReads(source)].sort(), ['all', 'pomodoro', 'tasks']);
  assert.deepEqual([...dirtyFlagReads('if (dirty.pomdoro) paint();\n')], ['pomdoro'], '拼错的名字要照原样报出来');
  assert.deepEqual([...dirtyFlagReads('const dirtyish = { pomodoro: true };\n')], [], '同前缀的标识符不算读旗标');
});

// 只有朝外的边算违规，而归层不明的一端不参与方向判断——否则一处归层歧义会连带把它的每
// 条边都报成方向违规，把真正该修的那一条埋掉。
test('only outward edges violate layer direction', () => {
  const layers = [
    { name: 'core', paths: ['src/core'] },
    { name: 'capabilities', paths: ['src/capabilities'] },
    { name: 'surfaces', paths: ['src/surfaces'] }
  ];
  assert.deepEqual(
    outwardEdge(layers, 'src/core/a.js', 'src/capabilities/work/index.js'),
    { from: 'core', to: 'capabilities' }
  );
  assert.equal(outwardEdge(layers, 'src/surfaces/a.mjs', 'src/core/a.js'), null, '朝内合法');
  assert.equal(outwardEdge(layers, 'src/core/a.js', 'src/core/b.js'), null, '同层合法');
  assert.equal(outwardEdge(layers, 'src/main.js', 'src/surfaces/a.mjs'), null, '归层不明的一端不判方向');
});

// AGENTS.md 要求例外必须窄，并且要有一个测试把它按窄的口径钉住。窄的机械含义只有一条：
// 匹配必须落在 (文件, 依赖) 这一对上，而不是只看文件——只看文件的话，这个文件此后新增的
// 外向依赖都会免费搭车通过。
test('an exception exempts only the edges it lists', () => {
  const exceptions = [{
    rule: 'layer-direction',
    path: 'src/core/store-migration.js',
    dependencies: ['src/capabilities/preferences/index.js']
  }];
  const covered = ['layer-direction', 'src/core/store-migration.js', 'src/capabilities/preferences/index.js'];
  assert.equal(isExempt(exceptions, ...covered), true);
  assert.equal(
    isExempt(exceptions, 'layer-direction', 'src/core/store-migration.js', 'src/capabilities/work/index.js'),
    false,
    '同一文件的其他外向依赖不搭车'
  );
  assert.equal(isExempt(exceptions, 'electron-import', ...covered.slice(1)), false, '例外不跨规则生效');
  assert.equal(isExempt(exceptions, 'layer-direction', 'src/core/llm/openai.js', covered[2]), false);
  assert.equal(isExempt(exceptions, 'layer-direction', 'src/core/store-migration.js'), false, '整文件口径问不出豁免');
  const blanket = [{ rule: 'electron-import', path: 'src/core/a.js' }];
  assert.equal(isExempt(blanket, 'electron-import', 'src/core/a.js'), true, '不针对某条边的规则按整文件生效');
});

// 实际登记的例外也要按同一口径核一遍：manifest 里若混进一条整文件的 layer-direction 豁免，
// 上面那条纯判据仍然会通过，因为它测的是判据而不是账本。
test('every recorded layer-direction exception is scoped to explicit edges', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
  for (const exception of manifest.exceptions.filter(entry => entry.rule === 'layer-direction')) {
    assert.ok(
      Array.isArray(exception.dependencies) && exception.dependencies.length > 0,
      `${exception.path} 必须逐条列出它豁免的依赖`
    );
  }
});
