import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { parseCaptureOptions, LIMITS } from './options.mjs';
import { runOwnedProcess } from './supervisor.mjs';
import { createCaptureReport, finalizeReport } from './report.mjs';
import { sourceIdentity, hostMetadata, saveCapture, safeMessage } from './evidence.mjs';
const require = createRequire(import.meta.url);
const ordinaryCleanupUnknown = result => result.code === 0 && result.stopReason === 'exited'
  && result.cleanup.rootReaped === true && result.cleanup.descendantsEvidence === 'normal-Windows-descendants-unverified'
  && result.cleanup.errors.length === 1 && result.cleanup.errors[0] === 'Windows descendants unverified after root exit; retain owned directories';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'];
export function captureEnvironment(source, home) {
  const result = Object.fromEntries(ENV_KEYS.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
  return { ...result, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'), LOCALAPPDATA: path.join(home, 'LocalAppData'),
    XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'),
    TEMP: home, TMP: home, TMPDIR: home, BUBU_DEV_REALTIME_PET: '1' };
}
export function installedElectron(root, platform = process.platform) {
  const dir = path.join(root, 'node_modules/electron');
  const expected = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron';
  const entry = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
  if (entry !== expected) throw new Error('pinned-electron-binary-path-unavailable');
  const file = path.join(dir, 'dist', expected), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('pinned-electron-binary-type-rejected');
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  if (fs.readFileSync(path.join(dir, 'dist/version'), 'utf8').trim().replace(/^v/, '') !== version)
    throw new Error('pinned-electron-version-mismatch');
  return file;
}
export async function runCapture(argv, {
  root = ROOT, env = process.env, runProcess = runOwnedProcess, now = () => performance.now(),
  log = console.log, signals = process, makeRunId = randomUUID,
  profileFactory = (options, directory) => require('../dev-bench/profile-fixture').createDisposableProfile(options, {
    allocateDirectory: () => { const fixture = path.join(directory, 'fixture'); fs.mkdirSync(fixture, { mode: 0o700 }); return fixture; }
  }),
  removeProfile = profile => require('../dev-bench/profile-fixture').removeDisposableProfile(profile),
  removeRunDirectory = directory => fs.rmSync(directory, { recursive: true, force: true }),
  resolveElectron = installedElectron, identify = sourceIdentity,
} = {}) {
  const runId = makeRunId(), started = now();
  let options, privateRoot = null, profile = null, processResult = null, report, cleanupConfirmed = true;
  let output = path.join(root, 'dist/pet-realtime-capture', `capture-${runId}.json.gz`);
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('user-interrupted'));
  signals.on('SIGINT', interrupt); signals.on('SIGTERM', interrupt);
  try {
    report = createCaptureReport({ runId, environment: hostMetadata(), options: {} });
    report.source = identify(root, { files: ['package.json', 'package-lock.json'] });
    options = parseCaptureOptions(argv);
    if (options.help) { log('npm run pet:realtime:capture -- [--prepare] [--no-screenshots] [--out=NEW_FILE.json.gz]'); return { code: 0, help: true }; }
    report.options = { prepare: options.prepare, screenshots: options.screenshots, limits: LIMITS };
    if (options.out) output = options.out;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (fs.existsSync(output)) throw new Error('capture-output-exists');
    log('Explicit preparation limit: 300s; collector/root supervision limit: 180s (Windows descendant cleanup may remain unverified). Local capture makes no model/provider or paid AI API calls; --prepare downloads pinned dependencies.');
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('capture-requires-existing-Node-24-or-newer');
    privateRoot = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'bubu-rt-')));
    const home = path.join(privateRoot, 'home'); fs.mkdirSync(home, { mode: 0o700 });
    const childEnv = captureEnvironment(env, home);
    const userconfig = path.join(privateRoot, 'empty.npmrc'); fs.writeFileSync(userconfig, '', { flag: 'wx', mode: 0o600 });
    childEnv.npm_config_userconfig = userconfig;
    const globalconfig = path.join(privateRoot, 'global.npmrc'); fs.writeFileSync(globalconfig, '', { flag: 'wx', mode: 0o600 });
    childEnv.npm_config_globalconfig = globalconfig;
    childEnv.npm_config_cache = path.join(privateRoot, 'npm-cache');
    childEnv.electron_config_cache = path.join(privateRoot, 'electron-cache');
    report.preparation = { requested: options.prepare, limitMs: LIMITS.preparationMs, steps: [], elapsedMs: 0 };
    const preparationStart = now();
    async function step(name, args, cwd = root) {
      const remaining = LIMITS.preparationMs - (now() - preparationStart) - 5000;
      if (remaining <= 0) throw new Error('preparation-deadline');
      const result = await runProcess(process.execPath, args, { cwd, env: childEnv, timeoutMs: remaining,
        cleanupMs: 5000, signal: abort.signal });
      cleanupConfirmed &&= result.cleanup.confirmed;
      report.preparation.steps.push({ name, elapsedMs: result.elapsedMs, code: result.code, signal: result.signal,
        stopReason: result.stopReason, cleanup: result.cleanup,
        diagnostic: result.code === 0 ? null : safeMessage(result.startError || result.stderr || name + '-failed') });
      report.preparation.elapsedMs = now() - preparationStart;
      if (result.code !== 0 || !['exited', null].includes(result.stopReason) || (!result.cleanup.confirmed && !ordinaryCleanupUnknown(result))) throw new Error(name + '-failed');
    }
    const locks = ['package-lock.json', 'research/animation-0.1.0/package-lock.json'];
    const lockHashes = locks.map(file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'));
    if (options.prepare) {
      for (const directory of [root, path.join(root, 'research/animation-0.1.0')])
        for (const file of ['.npmrc', 'npm-shrinkwrap.json']) if (fs.existsSync(path.join(directory, file))) throw new Error('unapproved-project-npm-configuration');
      const npmCLI = env.npm_execpath;
      if (typeof npmCLI !== 'string' || !path.isAbsolute(npmCLI) || !/npm-cli\.js$/.test(npmCLI)) throw new Error('prepare-requires-npm-run-entry');
      const args = [npmCLI, 'ci', '--ignore-scripts', `--cache=${childEnv.npm_config_cache}`, `--userconfig=${userconfig}`, `--globalconfig=${globalconfig}`];
      await step('root-lockfile-ci', args);
      await step('research-lockfile-ci', args, path.join(root, 'research/animation-0.1.0'));
      await step('pinned-electron-install', [path.join(root, 'node_modules/electron/install.js')]);
    }
    for (let i = 0; i < locks.length; i++) if (createHash('sha256').update(fs.readFileSync(path.join(root, locks[i]))).digest('hex') !== lockHashes[i])
      throw new Error('preparation-lockfile-changed');
    // Only explicit preparation restores the exact approved gzip, using Node built-ins.
    if (options.prepare) await step('hash-checked-Node-D2-materializer', [path.join(root, 'tools/pet-realtime-capture/materialize-d2.mjs')]);
    await step('existing-foundation-preflight', [path.join(root, 'research/animation-0.1.0/animation-foundation-v1/integration/verify-portability.mjs')]);
    report.source = identify(root);
    report.preparation.elapsedMs = now() - preparationStart;
    if (report.preparation.elapsedMs > LIMITS.preparationMs) throw new Error('preparation-deadline');
    const electron = resolveElectron(root);
    profile = profileFactory({ scenario: 'realtime-capture' }, privateRoot);
    require('./fixture-policy.cjs').assertCaptureFixtureState(profile.initial);
    const { createCaptureHandoff } = require('./handoff.cjs');
    const { requestFile, reportFile, token } = createCaptureHandoff({ runDirectory: privateRoot, runId,
      profileProof: profile, source: report.source, screenshots: options.screenshots });
    childEnv.BUBU_CAPTURE_TOKEN = token;
    const collectionStart = now();
    processResult = await runProcess(electron, [path.join(root, 'tools/pet-realtime-capture/electron-main.cjs'), '--dev',
      `--user-data-dir=${profile.userDataPath}`, `--capture-request=${requestFile}`],
    { cwd: root, env: childEnv, timeoutMs: LIMITS.collectionMs - 5000, cleanupMs: 5000, signal: abort.signal });
    cleanupConfirmed &&= processResult.cleanup.confirmed;
    if (fs.existsSync(reportFile)) {
      const stat = fs.lstatSync(reportFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.decodedBytes) throw new Error('partial-report-rejected');
      const collected = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (collected.runId !== runId || collected.source?.commit !== report.source.commit) throw new Error('partial-run-identity-mismatch');
      const preparation = report.preparation; report = collected; report.preparation = preparation;
    } else {
      if (processResult.stderr || processResult.startError) report.errors.push(safeMessage(processResult.startError || processResult.stderr));
      throw new Error('application-did-not-produce-report');
    }
    report.launch = { code: processResult.code, signal: processResult.signal, stopReason: processResult.stopReason,
      elapsedMs: now() - collectionStart, cleanup: processResult.cleanup, hardLimitMs: LIMITS.collectionMs };
    if (processResult.code !== 0 || !['exited', null].includes(processResult.stopReason) || (!processResult.cleanup.confirmed && !ordinaryCleanupUnknown(processResult))) throw new Error('application-execution-incomplete');
    if (!report.endSource || report.endSource.criticalDigest !== report.source.criticalDigest
      || report.endSource.commit !== report.source.commit || report.endSource.dirty !== report.source.dirty)
      throw new Error('source-changed-or-end-identity-missing');
    report.status = !cleanupConfirmed ? 'capture-complete-cleanup-unverified'
      : report.capture?.status === 'completed' ? 'completed' : 'completed-with-observations';
  } catch (error) {
    report ??= createCaptureReport({ runId, source: {}, environment: {}, options: {} });
    if (report.errors.length < LIMITS.errors) report.errors.push(safeMessage(error));
    report.status = abort.signal.aborted ? 'interrupted' : 'partial-or-setup-failed';
    report.launch ??= processResult ? { code: processResult.code, signal: processResult.signal, stopReason: processResult.stopReason, cleanup: processResult.cleanup } : { executed: false };
    if (options?.out || fs.existsSync(output)) output = path.join(root, 'dist/pet-realtime-capture', `failure-${runId}.json.gz`);
  } finally {
    signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', interrupt);
    function retainAfterCleanupFailure(code) {
      cleanupConfirmed = false;
      report.directoryCleanup = { confirmed: false, code };
      if (report.errors.length < LIMITS.errors) report.errors.push({ name: 'Error', message: code });
      if (['completed', 'completed-with-observations'].includes(report.status)) report.status = 'capture-complete-cleanup-unverified';
    }
    if (profile && cleanupConfirmed) {
      try { removeProfile(profile); report.fixtureRemoved = true; }
      catch { report.fixtureRemoved = false; retainAfterCleanupFailure('fixture-cleanup-rejected'); }
    }
    if (privateRoot && cleanupConfirmed) {
      try { removeRunDirectory(privateRoot); }
      catch { retainAfterCleanupFailure('run-directory-cleanup-incomplete'); }
    }
    if (!cleanupConfirmed) { report.retainedOwnedDirectories = true; report.fixtureRemoved = false; }
  }
  if (report) {
    report.totalElapsedMs = now() - started;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    let final;
    try { final = finalizeReport(report); }
    catch (error) { final = finalizeReport(createCaptureReport({ runId, source: report.source, environment: report.environment,
      options: { failedPackageValidation: safeMessage(error), status: report.status } })); final.status = 'partial-package-validation-failed'; }
    const saved = saveCapture(output, final);
    log(`Capture ${final.status}; native/GPU/OS-input/visual acceptance NOT granted. Send this file: ${output}`);
    return { code: final.status === 'completed' ? 0 : 2, output, ...saved };
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runCapture(process.argv.slice(2)).then(result => { process.exitCode = result.code; }).catch(error => {
    console.error(safeMessage(error).message); process.exitCode = 2;
  });
