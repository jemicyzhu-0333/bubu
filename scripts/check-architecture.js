'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { importedSpecifiers } = require('./module-imports');
const { layersOf, outwardEdge, isExempt } = require('./manifest-rules');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture/manifest.json'), 'utf8'));
const failures = [];
const notices = [];

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function walk(relative) {
  if (!exists(relative)) return [];
  return fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true }).flatMap(entry => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

function importsOf(file) {
  const specifiers = importedSpecifiers(read(file));
  return specifiers.filter(specifier => specifier.startsWith('.')).map(specifier => {
    const unresolved = path.resolve(ROOT, path.dirname(file), specifier);
    // 候选顺序沿用 Node 自己的 CommonJS 解析：先原名，再补扩展名，最后才是目录下的
    // index.js。必须要求命中的是文件——existsSync 对目录同样为真，于是
    // require('../../capabilities/work') 会解析成目录路径，随后被 sourceFiles 过滤掉，
    // 整条边就此消失。能力门面正是这种写法，等于依赖图在架构最在意的地方最瞎。
    const candidates = [unresolved, `${unresolved}.js`, `${unresolved}.mjs`, path.join(unresolved, 'index.js')];
    const target = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return target ? path.relative(ROOT, target).split(path.sep).join('/') : null;
  }).filter(Boolean);
}

function capabilityOf(file) {
  const match = file.match(/^src\/capabilities\/([^/]+)\//);
  return match && match[1];
}

function assertUniqueStateOwners() {
  const owners = new Map();
  for (const [capability, config] of Object.entries(manifest.capabilities)) {
    if (!Array.isArray(config.statePaths) || config.statePaths.length === 0) {
      failures.push(`capability ${capability} must own at least one state path`);
      continue;
    }
    for (const statePath of config.statePaths) {
      if (owners.has(statePath)) failures.push(`state path ${statePath} has owners ${owners.get(statePath)} and ${capability}`);
      owners.set(statePath, capability);
    }
  }
}

function assertWorkflowWrites() {
  const owners = new Map();
  for (const [capability, config] of Object.entries(manifest.capabilities)) {
    for (const statePath of config.statePaths) owners.set(statePath, capability);
  }
  const declarations = manifest.workflowWrites || {};
  const workflowFiles = walk('src/application/workflows')
    .filter(file => file.endsWith('.js') && path.basename(file) !== 'index.js');

  for (const file of workflowFiles) {
    const name = path.basename(file, '.js');
    if (!Object.prototype.hasOwnProperty.call(declarations, name)) {
      failures.push(`${file} has no declared workflow write set`);
    }
  }
  for (const [name, statePaths] of Object.entries(declarations)) {
    const file = `src/application/workflows/${name}.js`;
    if (!exists(file)) failures.push(`workflow write declaration ${name} has no implementation`);
    if (!Array.isArray(statePaths) || statePaths.length === 0) {
      failures.push(`workflow ${name} must declare at least one state path`);
      continue;
    }
    if (new Set(statePaths).size !== statePaths.length) {
      failures.push(`workflow ${name} declares a state path more than once`);
    }
    for (const statePath of statePaths) {
      if (!owners.has(statePath)) failures.push(`workflow ${name} writes unowned state path ${statePath}`);
    }
  }
}

function assertCapabilityWrites() {
  const owners = new Map();
  for (const [capability, config] of Object.entries(manifest.capabilities)) {
    for (const statePath of config.statePaths) owners.set(statePath, capability);
  }
  const declarations = manifest.capabilityWrites || {};
  const commandFiles = walk('src/capabilities').filter(file => (
    /^src\/capabilities\/[^/]+\/application\/[^/]+\.js$/.test(file)
    && path.basename(file) !== 'index.js'
  ));

  for (const file of commandFiles) {
    const capability = capabilityOf(file);
    const key = `${capability}/${path.basename(file, '.js')}`;
    if (!Object.prototype.hasOwnProperty.call(declarations, key)) {
      failures.push(`${file} has no declared capability write set`);
    }
  }
  for (const [key, statePaths] of Object.entries(declarations)) {
    const separator = key.indexOf('/');
    const capability = separator > 0 ? key.slice(0, separator) : '';
    const command = separator > 0 ? key.slice(separator + 1) : '';
    const file = `src/capabilities/${capability}/application/${command}.js`;
    if (!capability || !command || !exists(file)) {
      failures.push(`capability write declaration ${key} has no implementation`);
    }
    if (!Array.isArray(statePaths)) {
      failures.push(`capability command ${key} must declare its state paths (empty for non-persisting use cases)`);
      continue;
    }
    if (new Set(statePaths).size !== statePaths.length) {
      failures.push(`capability command ${key} declares a state path more than once`);
    }
    for (const statePath of statePaths) {
      if (owners.get(statePath) !== capability) {
        failures.push(`capability command ${key} writes state path ${statePath} owned by ${owners.get(statePath) || 'nobody'}`);
      }
    }
  }
}

function assertNames(files) {
  const forbidden = /^(?:utils?|helpers?|common|manager|service)\.(?:js|mjs)$/i;
  for (const file of files) {
    if (forbidden.test(path.basename(file))) failures.push(`${file} uses a catch-all module name`);
  }
}

// Modules whose rules moved into a capability and whose compatibility alias has been deleted.
// Asserting they stay absent is stronger than forbidding imports of them: a re-created alias cannot
// quietly become the second home for a rule that now has exactly one owner.
const PRUNED_LEGACY_MODULES = Object.freeze([
  // Batch B moves cross-owner care/settings/rest to single application workflows.
  'src/capabilities/companion/application/maintain-companion-care.js',
  'src/capabilities/companion/application/advance-meal-care.js',
  'src/capabilities/companion/application/resolve-meal-decision.js',
  'src/capabilities/preferences/application/update-preferences.js',
  'src/capabilities/execution/application/start-break-session.js',
  // Shared collaboration owns every conversation, including the legacy IPC adapters.
  'src/application/ai/draft-conversations.js',
  'src/capabilities/guidance/application/clarify-conversation.js',
  'src/core/daily-review.js',
  'src/core/focus-session.js',
  'src/core/recurrence.js',
  'src/core/runtime-session-clock.js',
  'src/core/session-duration.js',
  // 事实上的跨能力工作流，却住在 core：它一次改写 execution、progress、work 三家的状态，
  // 写集从未进过 manifest.workflowWrites。同一笔结算的唯一所有者是
  // src/application/workflows/settle-focus-session.js。
  'src/core/state-transitions.js',
  'src/core/task-availability.js',
  'src/core/task-model.js',
  'src/core/task-transactions.js',
  // 旧的全产品 validation facade。校验现在分属 persisted-schema、各能力 contract 与 IPC route
  // catalog；重建它等于再造一个“什么都校验”的中心，而那时没人知道新规则该往哪边加。
  'src/core/validation.js',
  'src/nudge-system.js',
  // 表层迁移把这两个的规则搬进了 src/surfaces/，文件本身删了。它们最容易被当成“临时接线”重
  // 建：一个新的 src/renderer/pet.js 只要跑得起来，就立刻是宠物演出规则的第二个家。
  'src/renderer/pet.js',
  'src/renderer/popover.js',
  'src/renderer/session-duration.js',
  // 这两个从未接线，且各自抄了一份优先级表（其中一份把 input-safe 与 cue 抄反）。
  // 演出优先级只由 src/core/pet-presentation.mjs 裁决。
  'src/surfaces/pet/presentation.mjs',
  'src/surfaces/pet/runtime-state.mjs'
]);

function assertPrunedLegacyModulesStayDeleted() {
  for (const module of PRUNED_LEGACY_MODULES) {
    if (exists(module)) {
      failures.push(`${module} was pruned in 0.4.0; depend on the owning capability facade instead of restoring it`);
    }
  }
}

// 方向规则只能约束归了层的文件，所以“每个文件恰好属于一层”必须是断言而不是惯例：先前
// src/core（49 个文件）、src/content（12 个）和 src 根目录都不在任何层里，方向检查从来
// 没看过它们，而 manifest 看上去已经声明了层。新目录不能再这样静默滑出契约。
function assertLayerCoverage(files) {
  for (const file of files) {
    const matches = layersOf(manifest.layers, file);
    if (matches.length === 0) {
      failures.push(`${file} belongs to no layer; declare it in architecture/manifest.json layers`);
    }
    if (matches.length > 1) {
      failures.push(`${file} matches layers ${matches.map(match => match.name).join(' and ')}; layer paths must not overlap`);
    }
  }
}

function assertDependencyDirection(files, graph) {
  for (const [file, dependencies] of graph) {
    const owner = capabilityOf(file);
    for (const dependency of dependencies) {
      const targetOwner = capabilityOf(dependency);
      if (owner && targetOwner && owner !== targetOwner && dependency !== `src/capabilities/${targetOwner}/index.js`) {
        failures.push(`${file} deep-imports capability ${targetOwner} through ${dependency}`);
      }
      if (/^src\/capabilities\/[^/]+\/domain\//.test(file)
          && /^(?:src\/(?:application|bootstrap|platform|surfaces)\/|src\/capabilities\/[^/]+\/application\/)/.test(dependency)) {
        failures.push(`${file} has an outward domain dependency on ${dependency}`);
      }
      const outward = outwardEdge(manifest.layers, file, dependency);
      if (outward && !isExempt(manifest.exceptions, 'layer-direction', file, dependency)) {
        failures.push(`${file} (${outward.from}) depends on outer layer ${dependency} (${outward.to})`);
      }
      if (dependency === 'src/main.js') failures.push(`${file} depends on legacy main.js`);
    }
  }
}

function assertPureCapabilityDomains(files) {
  const forbidden = [
    [/\bDate\.now\s*\(/, 'reads wall-clock time'],
    [/\bMath\.random\s*\(/, 'reads ambient randomness'],
    [/\brandomUUID\s*\(/, 'creates an ambient identifier'],
    [/\b(?:window|document|process|globalThis)\s*\./, 'reads a process or UI global']
  ];
  for (const file of files.filter(file => /^src\/capabilities\/[^/]+\/domain\//.test(file))) {
    const source = read(file);
    for (const [pattern, message] of forbidden) {
      if (pattern.test(source)) failures.push(`${file} ${message}`);
    }
  }
}

function assertPlatformIsolation(files) {
  for (const file of files) {
    const source = read(file);
    const isPreload = /^src\/preload-[^/]+\.js$/.test(file)
      || /^src\/platform\/electron\/preloads\//.test(file);
    const isSecureCredentialAdapter = file === 'src/platform/providers/secure-credential-store.js';
    const mayUseElectron = isPreload || isSecureCredentialAdapter
      || /^src\/(?:bootstrap|platform\/electron)\//.test(file);
    if (!mayUseElectron && !isExempt(manifest.exceptions, 'electron-import', file)
        && /require\(\s*['"]electron['"]\s*\)|from\s+['"]electron['"]/.test(source)) {
      failures.push(`${file} imports Electron outside bootstrap/platform/preload`);
    }
    if (isSecureCredentialAdapter
        && !/require\(['"]electron['"]\)\.safeStorage/.test(source)) {
      failures.push(`${file} may access Electron only through safeStorage`);
    }
    const mayUseStore = file === 'src/main.js' || /^src\/platform\/persistence\//.test(file);
    if (!mayUseStore && /require\(\s*['"]electron-store['"]\s*\)|from\s+['"]electron-store['"]/.test(source)) {
      failures.push(`${file} imports electron-store outside persistence adapter`);
    }
    if (/^src\/surfaces\//.test(file)
        && !/^src\/surfaces\/[^/]+\/adapter\//.test(file)
        && /window\.focuspix\b/.test(source)) {
      failures.push(`${file} accesses window.focuspix outside its surface adapter`);
    }
    if (/^src\/(?:bootstrap|application|capabilities|platform|surfaces|shared)\//.test(file)
        && /(?:require|import)\(\s*[^'"\s]/.test(source)) {
      failures.push(`${file} uses dynamic module loading`);
    }
  }
}

function assertAcyclic(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(file, trail) {
    if (visiting.has(file)) {
      const start = trail.indexOf(file);
      failures.push(`dependency cycle: ${[...trail.slice(start), file].join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of graph.get(file) || []) visit(dependency, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
}

function metric(source, name) {
  if (name === 'lines') return source.split(/\r?\n/).length - 1;
  if (name === 'requires') {
    return [...source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)].length;
  }
  if (name === 'ipcRegistrations') return [...source.matchAll(/registerIpc\('([^']+)'/g)].length;
  if (name === 'focuspixCalls') return [...source.matchAll(/window\.focuspix\.[A-Za-z0-9_]+/g)].length;
  if (name === 'legacyGlobals') return [...source.matchAll(/window\.FocusPix[A-Za-z0-9_]*/g)].length;
  throw new Error(`unknown architecture metric: ${name}`);
}

// A one-directional ratchet decays: every migration step silently converts progress into slack that
// legacy code may re-expand into for free. Requiring the recorded budget to equal the measurement
// makes each step bank its own progress, so the baseline can only ever travel downwards.
function assertLegacyRatchet() {
  for (const [file, baseline] of Object.entries(manifest.legacyRatchet)) {
    if (!exists(file)) {
      failures.push(`legacy ratchet tracks ${file}, which no longer exists; drop the baseline`);
      continue;
    }
    const source = read(file);
    for (const [name, budget] of Object.entries(baseline)) {
      const actual = metric(source, name);
      if (actual > budget) failures.push(`${file} ${name} grew from ${budget} to ${actual}`);
      if (actual < budget) {
        failures.push(`${file} ${name} shrank to ${actual}; retighten the ${budget} baseline in architecture/manifest.json`);
      }
    }
  }
}

function phaseOrdinal(label, description) {
  const match = /^P(\d+)$/.exec(typeof label === 'string' ? label : '');
  if (!match) {
    failures.push(`${description} must name a migration phase such as "P4", found ${JSON.stringify(label)}`);
    return null;
  }
  return Number(match[1]);
}

// An exception is a dated loan against the architecture, so it carries a repayment phase. Checking
// the deadline against the phase the migration has actually reached is what turns "no expired
// exceptions" into something a script can prove instead of something a reviewer has to remember.
function assertExceptionsExpire(graph) {
  const current = phaseOrdinal(manifest.currentPhase, 'architecture/manifest.json currentPhase');
  for (const exception of manifest.exceptions) {
    const label = typeof exception.path === 'string' && exception.path
      ? `exception for ${exception.path}`
      : `exception ${JSON.stringify(exception)}`;
    for (const field of ['rule', 'path', 'owner', 'reason', 'removeByPhase']) {
      if (typeof exception[field] !== 'string' || !exception[field].trim()) {
        failures.push(`${label} must declare ${field}`);
      }
    }
    if (typeof exception.path === 'string' && exception.path && !exists(exception.path)) {
      failures.push(`${label} points at a file that no longer exists; delete the exception`);
    }
    // 逐边记账的规则必须真的把边列出来，否则例外会退化成整文件通行证。
    if (exception.rule === 'layer-direction' && !Array.isArray(exception.dependencies)) {
      failures.push(`${label} must list the dependencies it covers; a whole-file exception is too broad`);
    }
    // 挂账的还款方式有两种：改掉这条边，或者到期。所以边一旦消失，账也必须同时销掉——否则
    // 把依赖端口化之后豁免会原地留成一张空白通行证，等下一条同源外向边免费复用。
    const edges = graph.get(exception.path);
    if (edges && Array.isArray(exception.dependencies)) {
      if (exception.dependencies.length === 0) failures.push(`${label} declares an empty dependencies list`);
      for (const dependency of exception.dependencies) {
        if (typeof dependency !== 'string' || !edges.includes(dependency)) {
          failures.push(`${label} covers ${JSON.stringify(dependency)}, which it no longer depends on; drop the stale entry`);
        }
      }
    }
    const deadline = phaseOrdinal(exception.removeByPhase, `${label} removeByPhase`);
    if (current !== null && deadline !== null && current > deadline) {
      failures.push(`${label} was due in ${exception.removeByPhase} and the migration has reached ${manifest.currentPhase}`);
    }
  }
}

function assertHistoricalCommitBoundaryIsNotImported(graph) {
  // Historical Usagi source manifests still read these exact bytes. Retaining
  // the file for that evidence must not reintroduce a second runtime writer.
  const historical = 'src/core/state-commit.js';
  for (const [file, dependencies] of graph) {
    if (dependencies.includes(historical)) {
      failures.push(`${file} imports historical state-commit; use the canonical unit of work`);
    }
  }
}

function assertBootstrapOwnsProcessLifecycle() {
  if (!exists('src/main.js')) return;
  const source = read('src/main.js');
  const forbidden = [
    [/\bsetInterval\s*\(/, 'creates an unmanaged interval'],
    [/\bsetTimeout\s*\(/, 'creates an unmanaged timeout'],
    [/\bclearInterval\s*\(/, 'clears an interval outside the lifecycle owner'],
    [/\bclearTimeout\s*\(/, 'clears a timeout outside the lifecycle owner'],
    [/\b(?:app|powerMonitor)\.on\s*\(/, 'registers an unmanaged process listener'],
    [/\bglobalShortcut\.unregisterAll\s*\(/, 'owns shortcut cleanup outside the lifecycle owner']
  ];
  for (const [pattern, message] of forbidden) {
    if (pattern.test(source)) failures.push(`src/main.js ${message}`);
  }
  if (!/registerProcessLifecycle\s*\(\s*\{/.test(source)) {
    failures.push('src/main.js must delegate process listener cleanup to bootstrap lifecycle');
  }
}

function reportSizeSignals(files) {
  const ignored = /^(?:test|tools|scripts|architecture|diagrams)\//;
  for (const file of files.filter(file => !ignored.test(file) && /\.(?:js|mjs|css)$/.test(file))) {
    const lines = read(file).split(/\r?\n/).length - 1;
    const isEntry = /(?:^|\/)(?:index|main|start|bootstrap|create-application)\.(?:js|mjs)$/.test(file);
    const guide = isEntry ? manifest.sizeReview.entryOrFacade : manifest.sizeReview.productionModule;
    // 棘轮只在数字变动时开口，所以这份常驻清单是唯一一直在说“还有多大”的地方。它先前排除
    // 了棘轮在跟的文件——于是仓库里最大的模块恰好是清单上唯一看不见的那个。
    if (lines > guide) notices.push(`${file}: ${lines} lines (review guide ${guide})`);
  }
}

assertUniqueStateOwners();
assertWorkflowWrites();
assertCapabilityWrites();
const sourceFiles = walk('src').filter(file => /\.(?:js|mjs)$/.test(file));
const allFiles = [...sourceFiles, ...walk('test'), ...walk('scripts')];
assertNames(sourceFiles);
const graph = new Map(sourceFiles.map(file => [file, importsOf(file).filter(target => sourceFiles.includes(target))]));
assertLayerCoverage(sourceFiles);
assertDependencyDirection(sourceFiles, graph);
assertPlatformIsolation(sourceFiles);
assertPureCapabilityDomains(sourceFiles);
assertAcyclic(graph);
assertHistoricalCommitBoundaryIsNotImported(graph);
assertPrunedLegacyModulesStayDeleted();
assertLegacyRatchet();
assertExceptionsExpire(graph);
assertBootstrapOwnsProcessLifecycle();
reportSizeSignals(allFiles);

if (notices.length) {
  process.stdout.write(`architecture size review (${notices.length}, advisory only):\n`);
  for (const notice of notices) process.stdout.write(`  - ${notice}\n`);
}
if (failures.length) {
  for (const failure of [...new Set(failures)]) process.stderr.write(`architecture: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`architecture checks passed (${sourceFiles.length} modules, ${Object.keys(manifest.capabilities).length} state owners, ${manifest.exceptions.length} exceptions, ${manifest.currentPhase} in progress)\n`);
}
