'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createMacUpdateHandoff } = require('./mac-update-handoff');
const { createBoundedUpdateNetwork } = require('./update-network-bounds');
const { updateReleasePolicy: { validateEmbeddedPolicy, validateFeed, validateOffer, UPDATER_VERSION } } = require('../../capabilities/app-maintenance');
const { PERSISTED_SCHEMA_VERSION } = require('../persistence/persisted-schema');

function createUpdateTransport({ app = require('electron').app, platform = process.platform, arch = process.arch,
  resourcesPath = process.resourcesPath, buildIdentity = require('../../../package.json').bubuUpdate,
  loadUpdater = () => require('electron-updater'), loadNativeUpdater = () => require('electron').autoUpdater, networkOptions, setTimer = setTimeout, clearTimer = clearTimeout, updaterVersion = () => require('electron-updater/package.json').version } = {}) {
  const version = app.getVersion();
  let policy;
  let reason = !app.isPackaged ? 'development-build'
    : !['darwin', 'win32'].includes(platform) ? 'unsupported-platform'
      : !fs.existsSync(path.join(resourcesPath, 'app-update.yml')) ? 'feed-unconfigured' : null;
  if (!reason) {
    try {
      policy = validateEmbeddedPolicy(buildIdentity, { version, platform, arch });
      if (policy.schemaVersion !== PERSISTED_SCHEMA_VERSION) throw new Error('update-schema-migration-required');
      if (updaterVersion() !== UPDATER_VERSION) throw new Error('update-runtime-incompatible');
    } catch (error) { reason = error.message; }
  }
  if (reason) return { currentVersion: version, channel: null, unavailableReason: reason, transport: {} };
  const { autoUpdater } = loadUpdater();
  const network = createBoundedUpdateNetwork(autoUpdater.httpExecutor, networkOptions);
  autoUpdater.httpExecutor = network.executor;
  const macHandoff = platform === 'darwin' ? createMacUpdateHandoff(loadNativeUpdater(), () => failureListener?.('handoff-unknown')) : null;
  // Official v7 APIs. Set manual before Electron ready: neither quit, launch, nor
  // OS shutdown is permission to install a cached package.
  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallEvent = 'manual';
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.channel = policy.channel;
  autoUpdater.allowPrerelease = policy.track === 'testing';
  // The upstream channel setter enables downgrade. Reset it AFTER setting channel.
  autoUpdater.allowDowngrade = false;
  autoUpdater.requestHeaders = null;
  const systemSupported = autoUpdater.isUpdateSupported;
  autoUpdater.isUpdateSupported = info => { validateOffer(info, policy); return systemSupported(info); };
  let active = 0, closed = false, failureListener = null, offered = null, packageLimit = null, downloaded = false;
  let windowsHandedOff = false, windowsHandoffTimer = null;
  const handleError = () => {
    clearTimer(windowsHandoffTimer);
    failureListener?.(windowsHandedOff || macHandoff?.hasHandedOff() ? 'handoff-unknown' : 'install-failed');
  };
  const clean = () => { if (closed && active === 0) autoUpdater.removeListener('error', handleError); };
  autoUpdater.on('error', handleError);
  async function verifyFeed() {
    const config = await autoUpdater.configOnDisk.value;
    validateFeed(config, policy);
    const { normalizePublicKeyList, parsePublicKey } = require('builder-util-runtime');
    const keys = normalizePublicKeyList(config.updateManifestPublicKey);
    if (!keys.length || keys.length > 4) throw new Error('update-signature-unconfigured');
    keys.forEach(parsePublicKey);
    // Never accept a remote trust list. The local signed application's config is authoritative.
    autoUpdater.updateManifestPublicKey = keys;
    if (closed) throw new Error('closed');
  }
  const transport = {
    subscribeFailure(listener) { failureListener = listener; return () => { failureListener = null; }; },
    async check() {
      if (closed) throw new Error('closed');
      active += 1; offered = null; downloaded = false;
      try {
        await verifyFeed();
        const result = await network.run(() => autoUpdater.checkForUpdates(), { timeoutMs: 30_000 });
        if (closed || !result?.updateInfo?.version) throw new Error('empty-update-result');
        validateOffer(result.updateInfo, policy);
        if (result.isUpdateAvailable === true) {
          offered = result.updateInfo.version;
          packageLimit = result.updateInfo.files.find(file => file.url.endsWith(platform === 'darwin' ? '.zip' : '.exe')).size;
        }
        return { available: offered !== null, version: result.updateInfo.version };
      } finally { active -= 1; clean(); }
    },
    download(progress) {
      if (closed || !offered) throw new Error('no-update');
      active += 1;
      const { CancellationToken } = require('builder-util-runtime');
      const token = new CancellationToken();
      const listener = info => { if (!closed && !token.cancelled) progress(info.percent); };
      autoUpdater.on('download-progress', listener);
      const promise = Promise.resolve().then(async () => {
        if (closed || token.cancelled) throw new Error('cancelled');
        await verifyFeed();
        const result = await network.run(() => autoUpdater.downloadUpdate(token), { timeoutMs: 10 * 60_000, token, maxBytes: packageLimit });
        if (closed || token.cancelled || !result?.updateFile) throw new Error('download-incomplete');
        downloaded = true;
      }).finally(() => { autoUpdater.removeListener('download-progress', listener); active -= 1; clean(); });
      return { promise, cancel: () => { downloaded = false; token.cancel(); } };
    },
    install({ canHandoff = () => true } = {}) {
      if (closed || !downloaded || !offered || !canHandoff()) throw new Error('not-ready');
      if (macHandoff) return macHandoff.install(canHandoff);
      // The official Windows API may schedule quit before an asynchronous spawn
      // error arrives. Once invoked, no public API proves it safe to reopen work.
      windowsHandedOff = true;
      windowsHandoffTimer = setTimer(handleError, 120_000);
      try { autoUpdater.quitAndInstall({ isSilent: false, isForceRunAfter: true, waitUntilNextLaunch: false }); }
      catch (_) { const error = new Error('handoff-unknown'); error.code = 'handoff-unknown'; throw error; }
    },
    dispose: () => { closed = true; downloaded = false; clearTimer(windowsHandoffTimer); macHandoff?.close(); network.close(); clean(); }
  };
  return { currentVersion: version, channel: policy.track, unavailableReason: null, transport };
}
module.exports = { createUpdateTransport };
