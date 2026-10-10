'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const {
  ipcRoutes,
  allowedSurfacesFor
} = require('../src/application/ipc/route-catalog');
const { KNOWN_SURFACES } = require('../src/shared/ipc-routes');
const { ipcRegistrationSites } = require('../scripts/ipc-registrations');
const architectureManifest = require('../architecture/manifest.json');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function matches(source, expression) {
  return [...source.matchAll(expression)].map(match => match[1]);
}

function sourceFiles(relative = 'src') {
  return fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true }).flatMap(entry => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : (/\.js$/.test(child) ? [child] : []);
  });
}

const EXPECTED_PRELOAD_CHANNELS = Object.freeze({
  'src/preload-impulse.js': [
    'settings:get-interface',
    'impulse:hide', 'impulse:resize', 'impulses:add',
    // 快捷面板的“先做 2 分钟”（ARCHITECTURE「快捷行动面板」）。
    'pomodoro:kickstart', 'pomodoro:pause', 'pomodoro:resume', 'pomodoro:start', 'pomodoro:stop',
    'state:get', 'tasks:complete', 'tasks:complete-step', 'tasks:update'
  ],
  'src/preload-nudge.js': [
    'settings:get-interface',
    'nudge:dismiss', 'nudge:pointer-interactive', 'routines:log'
  ],
  'src/preload-pet.js': [
    'settings:get-interface',
    'pet:cueAck', 'pet:dragEnd', 'pet:dragStart', 'pet:feed', 'pet:getBounds', 'pet:getContent',
    'pet:getContextualLine', 'pet:getFeedState', 'pet:getState',
    'pet:hide', 'pet:interaction', 'pet:openImpulse', 'pet:openPanel', 'pet:savePosition',
    'pet:setMenuOpen', 'pet:setPosition', 'pet:setState', 'pet:startFocus', 'pet:toggleDnd',
    'pet:updateRuntime'
  ],
  'src/preload-popover.js': [
    'settings:get-interface',
    'ai:clear-credential', 'ai:credential-import', 'ai:credential-status',
    'ai:test-connection', 'ai:cancel-connection-test',
    'ai:diagnostics-status', 'ai:diagnostics-start', 'ai:diagnostics-stop', 'ai:diagnostics-list',
    'ai:diagnostics-detail', 'ai:diagnostics-clear', 'ai:diagnostics-export',
    'ai:draft-discard', 'ai:draft-turn',
    'ai:conversation-start', 'ai:conversation-list', 'ai:conversation-open', 'ai:conversation-scope',
    'ai:conversation-mode', 'ai:conversation-turn', 'ai:conversation-pause', 'ai:conversation-cancel',
    'ai:conversation-retention', 'ai:conversation-delete',
    'ai:conversation-context-choices', 'ai:conversation-receipts', 'ai:conversation-proposal-status',
    'ai:change-preview', 'ai:change-confirm', 'ai:change-cancel', 'ai:change-receipt', 'ai:change-undo-preview',
    'ai:preview-breakdown',
    'ai:cancel', 'ai:preview-enrich',
    'ai:suggest-unstick',
    'appearance:equip', 'appearance:reset', 'appearance:apply-outfit',
    'energy:adjust', 'energy:check-in', 'energy:reset-calibration', 'energy:set-wake',
    'planning:get', 'planning:preview-cancel', 'planning:proposal-preview', 'planning:preference-preview', 'planning:preference-confirm', 'planning:preference-undo',
    'planning:history-preview', 'planning:history-confirm', 'planning:trial-preview', 'planning:trial-confirm', 'planning:trial-undo',
    'impulse:open', 'impulses:add', 'impulses:delete', 'impulses:history', 'impulses:organize', 'impulses:keep-all', 'impulses:keep-mood', 'activity:copy-plugin-command', 'impulses:promote', 'impulses:review',
    'history:list',
    'memory:clear', 'memory:forget', 'memory:list', 'memory:remember', 'mood:delete',
    'memory:change-preview', 'memory:change-confirm', 'memory:undo-preview', 'memory:receipt', 'memory:change-cancel', 'memory:proposal-preview',
    'updates:get', 'updates:check', 'updates:download', 'updates:cancel', 'updates:install',
    'notices:dismiss', 'nudge:test', 'pet:buy-food',
    'pomodoro:adjust-duration', 'pomodoro:kickstart', 'pomodoro:pause',
    'pomodoro:resolve-focus-landing', 'pomodoro:resolve-quick-start',
    'pomodoro:resume', 'pomodoro:start', 'pomodoro:stop',
    'quickPanel:describeShortcut',
    'reviews:open', 'reviews:resolve',
    'routines:add', 'routines:log', 'routines:remove', 'routines:undo-log', 'routines:update',
    'series:update', 'settings:update', 'skin:switch', 'state:get',
    'strategy:feedback', 'strategy:request',
    'tasks:add', 'tasks:add-with-breakdown',
    'tasks:archive', 'tasks:clarify-now', 'tasks:complete', 'tasks:complete-step',
    'tasks:delete', 'tasks:duplicate', 'tasks:pickOne',
    'tasks:preview-breakdown', 'tasks:renew', 'tasks:restore', 'tasks:set-now', 'tasks:undo-complete',
    'tasks:apply-proposal', 'tasks:dismiss-proposal', 'tasks:skip-occurrence', 'tasks:update',
    'timeline:getDay', 'window:hide'
  ]
});

test('every BrowserWindow uses a dedicated preload and Electron isolation controls', () => {
  const main = read('src/main.js');
  const windowHost = read('src/platform/electron/windows/window-host.js');

  // One constructor for the whole app is what makes the isolation controls below
  // an app-wide guarantee instead of a habit each window has to remember.
  const constructors = sourceFiles().filter(file => /new BrowserWindow\s*\(/.test(read(file)));
  assert.deepEqual(constructors, ['src/platform/electron/windows/window-host.js']);

  assert.doesNotMatch(main, /\bBrowserWindow\b|\.webContents\b/);
  assert.match(windowHost, /new BrowserWindow\(\{/);
  assert.match(windowHost, /preload:\s*preloadPath/);
  assert.match(windowHost, /contextIsolation:\s*true/);
  assert.match(windowHost, /nodeIntegration:\s*false/);
  assert.match(windowHost, /sandbox:\s*true/);
  assert.match(windowHost, /webviewTag:\s*false/);
  for (const surface of ['popover', 'impulse', 'pet']) {
    assert.match(main, new RegExp(
      `create${surface[0].toUpperCase()}${surface.slice(1)}WindowHost\\(\\{[\\s\\S]*?preloadPath: path\\.join\\(__dirname, 'preload-${surface}\\.js'\\)`
    ));
  }
  // Both reminder surfaces are opened by one host, so they share one bridge.
  assert.match(main, /createNudgeHost\(\{[\s\S]*?preloadPath: path\.join\(__dirname, 'preload-nudge\.js'\)/);
});

test('window creation paths deny popups and renderer navigation', () => {
  const windowHost = read('src/platform/electron/windows/window-host.js');

  assert.match(windowHost, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)[\s\S]*?'will-navigate'[\s\S]*?'will-attach-webview'/);
  for (const file of ['popover-window.js', 'impulse-window.js', 'pet-window.js', 'nudge-window.js']) {
    assert.match(read(`src/platform/electron/windows/${file}`), /createHardenedWindow\(\{/);
  }
  // The reminder windows are the pair most likely to be hand-rolled again, so the
  // audit names both of them rather than trusting the shared helper alone.
  const nudgeWindows = read('src/platform/electron/windows/nudge-window.js');
  assert.equal((nudgeWindows.match(/createHardenedWindow\(\{/g) || []).length, 2);
});

test('each HTML entry point has a deny-by-default content security policy', () => {
  for (const file of [
    'src/renderer/popover.html',
    'src/renderer/impulse.html',
    'src/renderer/pet.html',
    'src/renderer/expression-gallery.html',
    'src/renderer/nudge-corner.html',
    'src/renderer/nudge-fullscreen.html'
  ]) {
    const html = read(file);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /base-uri 'none'/);
    assert.match(html, /form-action 'none'/);
  }
});

test('the development expression gallery adds no preload, IPC, popup or navigation capability', () => {
  const launcher = read('scripts/expression-gallery.js');
  const html = read('src/renderer/expression-gallery.html');
  const renderer = read('src/renderer/expression-gallery.mjs');
  assert.match(launcher, /contextIsolation:\s*true/);
  assert.match(launcher, /nodeIntegration:\s*false/);
  assert.match(launcher, /sandbox:\s*true/);
  assert.match(launcher, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(launcher, /'will-navigate'[\s\S]*?preventDefault/);
  assert.match(launcher, /'will-attach-webview'[\s\S]*?preventDefault/);
  assert.doesNotMatch(launcher, /preload\s*:|ipcMain|ipcRenderer|webviewTag|enableRemoteModule/);
  assert.doesNotMatch(`${html}\n${renderer}`, /window\.bubu|ipcRenderer|require\s*\(/);
});

test('preloads expose only their reviewed invoke surfaces', () => {
  for (const [file, expectedChannels] of Object.entries(EXPECTED_PRELOAD_CHANNELS)) {
    const source = read(file);
    // 这里管的是“能请到哪些 channel”，而不是每个 channel 只允许被包一次：
    // 一个 channel 可以有两个具名入口（如粘贴密钥与从环境变量导入）。
    const actualChannels = [...new Set(matches(source, /ipcRenderer\.invoke\('([^']+)'/g))].sort();
    assert.deepEqual(actualChannels, [...new Set(expectedChannels)].sort(), `${file} IPC surface changed`);
    assert.equal((source.match(/contextBridge\.exposeInMainWorld\(/g) || []).length, 1);
    assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*ipcRenderer\b/);
    assert.doesNotMatch(source, /ipcRenderer\.(?:send|sendSync)\(/);
    assert.doesNotMatch(source, /require\(['"](?:electron\/remote|@electron\/remote)['"]\)/);
  }

  const popover = read('src/preload-popover.js');
  assert.match(popover, /skipOccurrence: id => ipcRenderer\.invoke\('tasks:skip-occurrence', \{ id \}\)/);
  assert.match(popover, /duplicateTask: id => ipcRenderer\.invoke\('tasks:duplicate', \{ id \}\)/);
  assert.match(popover, /dismissNotice: id => ipcRenderer\.invoke\('notices:dismiss', \{ id \}\)/);
});

// 判据按“已注册的通道集合”闭合，不按处理器住在哪个文件闭合：写死 src/main.js 会让这条
// 断言和 legacyRatchet 的下降要求互相锁死——搬走一族处理器正是让注册数下降的唯一办法。
test('every renderer invocation is registered and every registration is validated', () => {
  const registrations = ipcRegistrationSites(ROOT).map(site => site.channel);
  const registered = new Set(registrations);
  const invoked = new Set(Object.keys(EXPECTED_PRELOAD_CHANNELS).flatMap(file => (
    matches(read(file), /ipcRenderer\.invoke\('([^']+)'/g)
  )));
  const declared = new Set(ipcRoutes.map(route => route.channel));

  assert.equal(registrations.length, registered.size, 'a channel must not have multiple handlers');
  assert.deepEqual([...registered].sort(), [...declared].sort(),
    'the route catalog and main-process handlers must stay closed');
  assert.deepEqual([...invoked].sort(), [...declared].sort(),
    'the route catalog and preload invoke set must stay closed');

  for (const route of ipcRoutes) {
    assert.ok(architectureManifest.capabilities[route.capability], `${route.channel} has an unknown owner`);
    assert.ok(['command', 'query'].includes(route.kind), `${route.channel} has an unknown route kind`);
    assert.equal(typeof route.decode, 'function', `${route.channel} has no decoder`);
    assert.ok(route.surfaces.length > 0, `${route.channel} has no renderer surface`);
    for (const surface of route.surfaces) {
      assert.ok(KNOWN_SURFACES.includes(surface), `${route.channel} has unknown surface ${surface}`);
    }
    assert.deepEqual(allowedSurfacesFor(route.channel), [...route.surfaces]);
    const validation = validateIpcPayload(route.channel, undefined);
    assert.equal(
      Boolean(validation.errors && validation.errors.includes(`unsupported channel: ${route.channel}`)),
      false,
      `${route.channel} bypasses the central validation contract`
    );
  }
  assert.deepEqual(allowedSurfacesFor('unknown:route'), [], 'unknown routes must fail closed');

  const preloadSurfaces = {
    'src/preload-popover.js': ['popover'],
    'src/preload-impulse.js': ['impulse'],
    'src/preload-pet.js': ['pet'],
    'src/preload-nudge.js': ['nudgeCorner', 'nudgeFullscreen']
  };
  for (const [file, surfaces] of Object.entries(preloadSurfaces)) {
    const expected = ipcRoutes
      .filter(route => route.surfaces.some(surface => surfaces.includes(surface)))
      .map(route => route.channel)
      .sort();
    assert.deepEqual([...new Set(EXPECTED_PRELOAD_CHANNELS[file])].sort(), expected,
      `${file} must expose exactly the routes authorized for its surface`);
  }
  assert.deepEqual(allowedSurfacesFor('nudge:pointer-interactive'), ['nudgeCorner']);

  // Main injects central admission into the extracted renderer composition;
  // every route still crosses the unchanged application registrar.
  const main = read('src/main.js');
  const router = read('src/application/ipc/registrar.js');
  const composition = read('src/bootstrap/renderer-ipc.js');
  assert.match(main, /const registerIpc = createRendererIpcRegistrar\(\{/);
  assert.match(composition, /const registerIpc = createIpcRegistrar\(\{/);
  assert.match(router, /if \(!page \|\| !Array\.isArray\(allowed\) \|\| !allowed\.includes\(page\)\)/);
  assert.match(main, /require\('\.\/application\/ipc'\)/);
  assert.match(composition, /return assertIpcPayload\(channel, payload,/);
  assert.doesNotMatch(main, /channel\.startsWith\('pet:'\)|return \['popover'\]/,
    'unknown channels must fail closed instead of inheriting a default surface');
});

// 密钥只有往里的方向：一个入口存它，没有任何出口把它送回 renderer。
test('the AI credential has exactly one way in and no way back out', () => {
  const credentialSource = read('src/bootstrap/ai-collaboration.js');
  const main = read('src/main.js') + '\n' + credentialSource;
  // 粘贴与从环境变量导入共用一个处理器，因而只有一处写存储。
  assert.equal((main.match(/credentialStore\.set\(/g) || []).length, 1);
  assert.match(credentialSource, /readEnvironmentCredential = \(\) => process\.env\.BUBU_AI_API_KEY/);
  assert.match(credentialSource, /registerIpc\('ai:credential-import',[\s\S]*?payload\?\.secret \|\| readEnvironmentCredential\(\)/);
  // 投影给 renderer 的只能是 status（available / configured），不能是密钥本体。
  assert.doesNotMatch(main, /credential:\s*credentialStore\.get\(\)/);
  assert.doesNotMatch(main, /pushStateChange[\s\S]{0,200}credentialStore\.get\(\)/);
  const getUses = matches(main, /credentialStore\.get\(\)([^\n]*)/g);
  for (const tail of getUses) {
    assert.doesNotMatch(tail, /console\.|log\(/, 'a decrypted credential must never reach a log');
  }
  // 密钥不得进入持久化业务状态；它只住在 safeStorage 加密的单独文件里。
  assert.doesNotMatch(read('src/platform/persistence/persisted-schema.js'), /aiApiKey|aiSecret|aiCredential/);
});

test('the icon build encodes current assets in process without launching shell commands', () => {
  for (const file of ['scripts/make-icon.js', 'scripts/make-tray-icons.js', 'scripts/app-icon-png.js',
    'src/platform/electron/tray-bitmap.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /child_process|\b(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)\s*\(|shell:\s*true/,
      `${file} must keep icon encoding in process without a command interpreter`);
  }
  const source = read('scripts/make-icon.js');
  assert.match(source, /decodePNG\(fs\.readFileSync/);
  assert.match(source, /assets\.set\('assets\/icon\.ico', ico\(images\)\)/);
  assert.match(source, /assets\.set\('assets\/icon\.icns', icns\(images\)\)/);
});

test('the main process uses the tested dual-recommendation strategy', () => {
  const main = read('src/main.js');
  assert.match(main, /guidance\.recommendations\.projectRecommendations/);
  assert.match(read('src/capabilities/guidance/domain/recommendations.js'), /selectRecommendationCandidates\(ranked,\s*limit\)/);
});

test('a second instance cannot touch persisted state before it exits', () => {
  const main = read('src/main.js');
  const composition = read('src/bootstrap/create-application.js');
  const appHost = read('src/platform/electron/app-host.js');
  const persistenceAdapter = read('src/platform/persistence/electron-store-adapter.js');
  const profileRedirect = composition.indexOf('appHost.setDataDirectory(directory)');
  const lock = composition.indexOf('appHost.acquireSingleInstanceLock()');
  const adapterConstruction = composition.indexOf('createStateRepository({');
  assert.ok(lock >= 0
    && adapterConstruction > lock);
  assert.match(composition, /if \(!appHost\.acquireSingleInstanceLock\(\)\) \{\s*appHost\.quit\(\);/);
  assert.match(main, /const application = createApplication\(\{[\s\S]*?normalizePersistedState[\s\S]*?\}\);/);
  assert.doesNotMatch(main, /createAppHost|createElectronStoreAdapter|createSecureCredentialStore/);
  assert.match(persistenceAdapter, /authorityFactory/);
  assert.match(persistenceAdapter, /prepareInitial/);
  assert.doesNotMatch(persistenceAdapter, /new Store\(|require\('electron-store'\)|driver\.store\s*=/);
  // After adoption the SQL authority, never a stale JSON mirror, owns every read.
  assert.match(persistenceAdapter, /authority\.read\(\)/);
  // 单实例锁住在 userData 里，所以选目录必须早于抢锁：反过来的话，开发运行
  // 会先去抢日常实例那把锁，于是两边互相 quit，而不是各自开各自的。
  assert.ok(profileRedirect >= 0 && profileRedirect < lock,
    'the data directory must be chosen before the single-instance lock is claimed');
  // 改道只能由显式标记触发；否则一次普通启动就会看不到自己的真实数据。
  assert.match(composition, /const profile = isDevProfile\(argv\) \? 'development' : 'production';/);
  assert.match(composition, /if \(profile === 'development' && !appHost\.hasExplicitUserDataPath\(\)\) \{/);
  // Chromium 的 cookie 与 LocalStorage 挂在 sessionData 上，漏掉它等于只搬走一半。
  assert.match(composition, /appHost\.setDataDirectory\(directory\);/);
  assert.match(appHost, /app\.setPath\('userData', directory\);[\s\S]*?app\.setPath\('sessionData', directory\);/);
});

test('the impulse quick panel receives the same sensory profile as other surfaces', () => {
  const main = read('src/main.js');
  const preload = read('src/preload-impulse.js');
  const feature = read('src/surfaces/impulse/quick-panel.mjs');
  assert.match(main, /impulseWindow\.send\('sensory:profile'/);
  assert.match(preload, /ipcRenderer\.on\('sensory:profile'/);
  assert.match(feature, /client\.onSensoryProfile\(applySensoryProfile\)/);
});

test('the passive pet stays keyboard-focusable and is shown without taking app focus', () => {
  const main = read('src/main.js');
  const petAdapter = read('src/platform/electron/windows/pet-window.js');
  const windowHost = read('src/platform/electron/windows/window-host.js');
  const createStart = main.indexOf('function createPetWindow()');
  const showStart = main.indexOf('function showPet()', createStart);
  const nextFunction = main.indexOf('\nfunction ', showStart + 1);
  const menuStart = main.indexOf("registerIpc('pet:setMenuOpen'");
  const nextHandler = main.indexOf("\nregisterIpc('", menuStart + 1);
  assert.ok(createStart >= 0 && showStart > createStart && nextFunction > showStart);
  assert.ok(menuStart >= 0 && nextHandler > menuStart);

  const createPetWindow = main.slice(createStart, showStart);
  const showPet = main.slice(showStart, nextFunction);
  const setMenuOpen = main.slice(menuStart, nextHandler);
  assert.match(petAdapter, /transparent:\s*true,[\s\S]*?focusable:\s*true/);
  assert.match(petAdapter, /'did-finish-load'/);
  assert.match(createPetWindow, /onLoaded:[\s\S]*?petWindow\.showInactive\(\)/);
  assert.match(showPet, /petWindow\.showInactive\(\)/);
  assert.match(setMenuOpen, /petWindow\.ensureFocusable\(\{ focus: open \}\)/);
  assert.match(windowHost, /showInactive:[\s\S]*?nativeWindow\.showInactive\(\)[\s\S]*?nativeWindow\.show\(\)/);
  assert.doesNotMatch(setMenuOpen, /setFocusable\(Boolean\(open\)\)|setFocusable\(false\)/);
  assert.doesNotMatch(createPetWindow, /petWindow\.show\(\);\s*petWindow\.focus\(\)/);
  assert.doesNotMatch(showPet, /petWindow\.show\(\);\s*petWindow\.focus\(\)/);
});
