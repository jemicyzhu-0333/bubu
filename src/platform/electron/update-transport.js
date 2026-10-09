'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createUpdateTransport({ app = require('electron').app, platform = process.platform, arch = process.arch, resourcesPath = process.resourcesPath,
  loadUpdater = () => require('electron-updater') } = {}) {
  const version = app.getVersion();
  const reason = !app.isPackaged ? 'development-build'
    : !['darwin', 'win32'].includes(platform) ? 'unsupported-platform'
      : !fs.existsSync(path.join(resourcesPath, 'app-update.yml')) ? 'feed-unconfigured' : null;
  if (reason) return { currentVersion: version, unavailableReason: reason, transport: {} };
  const { autoUpdater } = loadUpdater();
  // Pin 6.x semantics. Download and installation each require an explicit user action.
  autoUpdater.channel = `latest-${arch}`;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  let active = 0, closed = false, failureListener = null;
  const handleError = () => failureListener?.();
  const clean = () => { if (closed && active === 0) autoUpdater.removeListener('error', handleError); };
  autoUpdater.on('error', handleError);
  const transport = {
    subscribeFailure(listener) { failureListener = listener; return () => { failureListener = null; }; },
    async check() {
      active += 1;
      let available = false;
      const listener = () => { available = true; };
      autoUpdater.on('update-available', listener);
      try {
        const result = await autoUpdater.checkForUpdates();
        if (!result?.updateInfo?.version) throw new Error('empty-update-result');
        return { available, version: String(result.updateInfo.version).slice(0, 80) };
      } finally { autoUpdater.removeListener('update-available', listener); active -= 1; clean(); }
    },
    download(progress) {
      active += 1;
      const { CancellationToken } = require('builder-util-runtime');
      const token = new CancellationToken();
      const listener = info => progress(info.percent);
      autoUpdater.on('download-progress', listener);
      const promise = Promise.resolve().then(() => autoUpdater.downloadUpdate(token))
        .finally(() => { autoUpdater.removeListener('download-progress', listener); active -= 1; clean(); });
      return { promise, cancel: () => token.cancel() };
    },
    install: () => autoUpdater.quitAndInstall(false, true),
    dispose: () => { closed = true; clean(); }
  };
  return { currentVersion: version, unavailableReason: null, transport };
}
module.exports = { createUpdateTransport };
