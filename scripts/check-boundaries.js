'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcRoutes } = require('../src/application/ipc/route-catalog');
const { DIRTY_FIELDS } = require('../src/core/state-channel.mjs');
const { importedSpecifiers, resolveSpecifier } = require('./module-imports');
const { ipcRegistrationSites } = require('./ipc-registrations');
const { callReceives } = require('./call-shapes');
const { dirtyFlagReads } = require('./state-flags');

const root = path.resolve(__dirname, '..');
const failures = [];
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function walk(relative) {
  const absolute = path.join(root, relative);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => (
    entry.isDirectory() ? walk(path.join(relative, entry.name)) : [path.join(relative, entry.name)]
  ));
}

// core/content 是纯逻辑：不碰 Electron，也不反向依赖 main.js 或渲染器。这两个目录里
// .mjs 已经多于 .js，所以判据要同时认两种模块语法，并按还原后的路径判断而不是按字面
// 匹配说明符——否则 ESM 强制的 `../main.js` 和深一层的 `../../main.js` 都会漏掉。
for (const file of [...walk('src/core'), ...walk('src/content')].filter(name => /\.(?:js|mjs)$/.test(name))) {
  const specifiers = importedSpecifiers(read(file));
  const targets = specifiers.map(specifier => resolveSpecifier(file, specifier)).filter(Boolean);
  if (specifiers.includes('electron')) failures.push(`${file} must stay Electron-free`);
  if (targets.includes('src/main')) failures.push(`${file} must not depend on main.js`);
  if (targets.some(target => target.startsWith('src/renderer/'))) {
    failures.push(`${file} must not depend on renderer code`);
  }
}

for (const file of walk('src').filter(name => /\.(?:js|mjs)$/.test(name) && !path.basename(name).startsWith('preload-'))) {
  if (/ipcRenderer\.invoke\(/.test(read(file))) failures.push(`${file} bypasses the preload capability boundary`);
}

// ARCHITECTURE「事实流与长期记忆」: exactly one module may require a SQLite driver. node:sqlite is a
// builtin and better-sqlite3 an optional native addon; confining both to
// sqlite-database.js keeps driver selection behind one adapter. Existing SQL
// authority must never silently downgrade to JSONL or an empty store.
const SQLITE_DRIVER_OWNER = 'src/platform/persistence/sqlite/sqlite-database.js';
for (const file of walk('src').filter(name => /\.(?:js|mjs)$/.test(name))) {
  if (file.split(path.sep).join('/') === SQLITE_DRIVER_OWNER) continue;
  const specifiers = importedSpecifiers(read(file));
  if (specifiers.includes('node:sqlite') || specifiers.includes('better-sqlite3')) {
    failures.push(`${file} requires a SQLite driver directly; only ${SQLITE_DRIVER_OWNER} may`);
  }
}

const main = read('src/main.js');
const applicationComposition = read('src/bootstrap/create-application.js');
if (/require\(\s*['"]electron['"]\s*\)/.test(main) || /\bapp\.(?:getPath|setPath|requestSingleInstanceLock|quit|isReady|whenReady|on)\b/.test(main)) {
  failures.push('main.js reaches Electron app outside its platform adapter');
}
if (!/createApplication\s*\(\s*\{/.test(main)
    || !/stateRepository:\s*store/.test(main)
    || !callReceives(main, 'registerProcessLifecycle', ['lifecycle', 'appHost'])) {
  failures.push('main.js must enter through the application composition root and its app host');
}
if (!/createAppHost\s*\(\s*\)/.test(applicationComposition)
    || !/createStateRepository\s*=\s*createSqliteStateAdapter/.test(applicationComposition)
    || !/createCredentialStore\s*=\s*createSecureCredentialStore/.test(applicationComposition)) {
  failures.push('create-application must compose the app, canonical state and credential adapters');
}
if (/store\.store\s*=/.test(main)) failures.push('main.js writes the persistence driver outside its adapter');
if (/store\.set\(/.test(main)) failures.push('main.js has a scalar store.set write outside the canonical commit boundary');
if (/require\(['"]electron-store['"]\)/.test(main)) failures.push('main.js imports electron-store outside the persistence adapter');
// The host may read the canonical state, but every write goes through the unit
// of work, so the declared write-set of each change is checkable. A revived
// commit/update helper would put an undeclared write back within reach.
if (/store\.(?:commit|update)\s*\(/.test(main)) {
  failures.push('main.js commits canonical state outside the unit of work');
}
for (const helper of ['commitCanonicalState', 'updateCanonicalState', 'setCanonicalField']) {
  if (new RegExp(`\\b${helper}\\b`).test(main)) {
    failures.push(`main.js restored the legacy ${helper} commit path; use a workflow or capability command`);
  }
}
if (!/createUnitOfWork\s*\(\s*\{\s*repository:\s*store\s*\}\s*\)/.test(main)) {
  failures.push('main.js must route persisted writes through one unit of work over the state repository');
}
if (!/createStateRepository\s*\(\s*\{/.test(applicationComposition)) {
  failures.push('create-application must construct the canonical persistence adapter');
}
if (/\{[^}]*\bNotification\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)) {
  failures.push('main.js imports Notification outside the Electron notification adapter');
}
if (!/createNotificationHost\s*\(\s*\{/.test(main)) failures.push('main.js must use the Electron notification adapter');
if (/\bBrowserWindow\b/.test(main)) failures.push('main.js reaches BrowserWindow outside the Electron window adapters');
if (/\.webContents\b/.test(main)) failures.push('main.js reaches webContents outside the Electron window adapters');
if (!/createPopoverWindowHost\s*\(\s*\{/.test(main)
    || !/createImpulseWindowHost\s*\(\s*\{/.test(main)
    || !/createPetWindowHost\s*\(\s*\{/.test(main)) {
  failures.push('main.js must compose all primary windows through their Electron adapters');
}
if (/\{[^}]*\bscreen\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)
    || /\bscreen\.(?:getPrimaryDisplay|getDisplayNearestPoint|getCursorScreenPoint)\s*\(/.test(main)) {
  failures.push('main.js reaches Electron screen outside its platform adapter');
}
if (!/createScreenHost\s*\(\s*\)/.test(main)) failures.push('main.js must use the Electron screen adapter');
if (/\{[^}]*\bsession\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)
    || /\b(?:session\.)?defaultSession\b/.test(main)
    || /\.setPermission(?:Check|Request)Handler\s*\(/.test(main)) {
  failures.push('main.js owns Electron permission policy outside its platform adapter');
}
if (!/createPermissionHost\s*\(\s*\)/.test(main)
    || !/permissionHost\.denyAll\s*\(\s*\)/.test(main)) {
  failures.push('main.js must install the deny-by-default Electron permission adapter');
}
if (/\{[^}]*\bsafeStorage\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)) {
  failures.push('main.js reaches Electron safeStorage outside its provider adapter');
}
if (!/createCredentialStore\s*\(\s*\{\s*userDataPath\s*\}/.test(applicationComposition)) {
  failures.push('create-application must construct the secure credential provider adapter');
}
if (/\{[^}]*\bglobalShortcut\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)
    || /\bglobalShortcut\.(?:register|unregister|unregisterAll|isRegistered)\s*\(/.test(main)) {
  failures.push('main.js reaches Electron globalShortcut outside its platform adapter');
}
// ARCHITECTURE「快捷行动面板」: main.js reaches Electron shortcuts only through
// createShortcutHost. Accept both supported entry shapes: the popover's
// registerAll call and the quick panel host's binding ladder. Both must retain
// the same adapter boundary checked above.
if (!/createShortcutHost\s*\(\s*\)/.test(main)
    || !(/shortcutHost\.registerAll\s*\(/.test(main) || /createQuickPanelHost\s*\(\s*\{/.test(main))) {
  failures.push('main.js must use the Electron shortcut adapter (registerAll or the quick panel host)');
}
if (/\{[^}]*\b(?:Tray|Menu|nativeImage)\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)
    || /\bnew\s+Tray\s*\(|\bMenu\.buildFromTemplate\s*\(|\bnativeImage\.createFromBuffer\s*\(/.test(main)) {
  failures.push('main.js reaches Electron tray primitives outside their platform adapter');
}
if (!/createTrayHost\s*\(\s*\{/.test(main)) {
  failures.push('main.js must use the Electron tray adapter');
}
if (!/lifecycle\.register\('electron:tray',\s*\(\)\s*=>\s*tray\.dispose\(\)\)/.test(main)) {
  failures.push('main.js must register tray disposal with the lifecycle owner');
}
if (/\{[^}]*\bpowerMonitor\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)
    || /\bpowerMonitor\.(?:on|off|removeListener)\s*\(/.test(main)) {
  failures.push('main.js reaches Electron powerMonitor outside its platform adapter');
}
if (!/createPowerHost\s*\(\s*\)/.test(main)
    || !callReceives(main, 'registerProcessLifecycle', ['powerHost', 'isSessionRunning'])) {
  failures.push('main.js must use the Electron power adapter');
}
if (/\{[^}]*\bipcMain\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(main)
    || /\bipcMain\.(?:handle|removeHandler)\s*\(/.test(main)) {
  failures.push('main.js reaches ipcMain outside its platform adapter');
}
if (!/createIpcHost\s*\(\s*\)/.test(main)
    || !callReceives(main, 'createRendererIpcRegistrar', ['ipcHost', 'allowedSurfacesFor', 'assertIpcPayload'])
    || !callReceives(read('src/bootstrap/renderer-ipc.js'), 'createIpcRegistrar', ['ipcHost', 'senderPage'])
    || !/lifecycle\.register\('electron:ipc-host',\s*\(\)\s*=>\s*ipcHost\.dispose\(\)\)/.test(main)) {
  failures.push('main.js must compose and dispose the Electron IPC host');
}

// 'all' 是整份投影的直通口，buildStateDelta 在闭集校验之前就返回，所以它不在 DIRTY_FIELDS 里。
// 只查读侧这一个方向：声明了而当前没人读的旗标要留着——它说的是“这次改动影响了哪些字段”，
// 不是“今天有谁在看”，反向闭合会把词表钉死在今天的读法上。
const declaredDirtyFlags = new Set([...Object.keys(DIRTY_FIELDS), 'all']);
for (const file of walk('src').filter(name => /\.(?:js|mjs)$/.test(name))) {
  for (const flag of dirtyFlagReads(read(file))) {
    if (!declaredDirtyFlags.has(flag)) {
      failures.push(`${file} repaints on dirty.${flag}, which state-channel never publishes`);
    }
  }
}

const registrationSites = ipcRegistrationSites(root);
const registered = new Map();
const declared = new Set(ipcRoutes.map(route => route.channel));
for (const site of registrationSites) {
  const first = registered.get(site.channel);
  if (first) failures.push(`IPC channel ${site.channel} has handlers in both ${first} and ${site.file}`);
  else registered.set(site.channel, site.file);
}
for (const [channel, file] of registered) {
  if (!declared.has(channel)) failures.push(`${file} registers IPC channel ${channel}, which is absent from the route catalog`);
}
for (const channel of declared) if (!registered.has(channel)) failures.push(`IPC channel ${channel} is declared but has no handler`);

const preloadSurfaces = Object.freeze({
  'src/preload-popover.js': ['popover'],
  'src/preload-impulse.js': ['impulse'],
  'src/preload-pet.js': ['pet'],
  'src/preload-nudge.js': ['nudgeCorner', 'nudgeFullscreen']
});
for (const [file, surfaces] of Object.entries(preloadSurfaces)) {
  const invoked = new Set([...read(file).matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]));
  const allowed = new Set(ipcRoutes
    .filter(route => route.surfaces.some(surface => surfaces.includes(surface)))
    .map(route => route.channel));
  for (const channel of invoked) {
    if (!allowed.has(channel)) failures.push(`${file} exposes ${channel} outside its route surface allowlist`);
  }
  for (const channel of allowed) {
    if (!invoked.has(channel)) failures.push(`${file} is missing the allowlisted route ${channel}`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`boundary: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`boundary checks passed (${registered.size} IPC channels across ${new Set(registrationSites.map(site => site.file)).size} handler modules)\n`);
}
