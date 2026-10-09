'use strict';

const path = require('node:path');
const { existsSync } = require('node:fs');
const { nudgePolicy } = require('../../capabilities/attention');

const FOREGROUND_TIMEOUT_MS = 3000;
const MAX_FOREGROUND_BYTES = 512;
const FOREGROUND_APP_COMMAND = '/usr/bin/lsappinfo info -only name "$(/usr/bin/lsappinfo front)"';

// The packaged helper must be outside app.asar; development uses only the
// repository helper. No fallback to the optional continuous activity collector.
function windowsForegroundCommand({
  appPath = path.resolve(__dirname, '../../..'), resourcesPath = process.resourcesPath,
  isPackaged = path.extname(appPath) === '.asar', exists = existsSync
} = {}) {
  if (isPackaged && typeof resourcesPath !== 'string') return null;
  const script = isPackaged
    ? path.join(resourcesPath, 'nudge-foreground', 'nudge-foreground.ps1')
    : path.join(appPath, 'native', 'windows', 'nudge-foreground.ps1');
  if (!exists(script)) return null;
  // Respect the machine's execution/language policy. A denied script is unknown.
  return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script] };
}

function foregroundIdentity(platform, stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > MAX_FOREGROUND_BYTES) return null;
  const match = platform === 'win32'
    ? /^foreground-v1:([A-Za-z0-9][A-Za-z0-9._ -]{0,199})(?:\r?\n)?$/.exec(stdout)
    : /^"LSDisplayName"[ \t]*=[ \t]*"([^"\r\n\x00-\x1f]{1,200})"(?:\r?\n)?$/.exec(stdout);
  if (!match || match[0] !== stdout || match[1] !== match[1].trim()) return null;
  return platform === 'win32' ? match[1].toLowerCase().replace(/\.exe$/, '') || null : match[1];
}

// One bounded lookup at each delivery/escalation boundary, never a collector.
// The fixed helper emits only process identity; no titles, paths, audio or storage.
function probeForegroundApp({ platform, exec, execFile, whitelist, signal,
  setTimer = setTimeout, clearTimer = clearTimeout, ...paths }) {
  if (!['darwin', 'win32'].includes(platform) || signal?.aborted) return Promise.resolve(null);
  let command = null;
  try {
    if (platform === 'win32') command = windowsForegroundCommand(paths);
  } catch (_) { return Promise.resolve(null); }
  if (platform === 'win32' && !command) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    let canceled = false;
    let child = null;
    let timer = null;
    const kill = () => { try { child?.kill(); } catch (_) {} };
    const finish = (value, cancel = false) => {
      if (settled) return;
      settled = true;
      canceled = cancel;
      if (timer !== null) clearTimer(timer);
      signal?.removeEventListener('abort', abort);
      if (cancel) kill();
      resolve(value);
    };
    const abort = () => finish(null, true);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimer(abort, FOREGROUND_TIMEOUT_MS);
    if (signal?.aborted || settled) return abort();
    const callback = (error, stdout, stderr) => {
      if (settled) return;
      if (error || (stderr !== undefined && stderr !== '')) return finish(null);
      const appName = foregroundIdentity(platform, stdout);
      finish(appName ? { appName, inWhitelist: nudgePolicy.matchesForegroundWhitelist(appName, whitelist, platform) } : null);
    };
    const options = { timeout: FOREGROUND_TIMEOUT_MS, maxBuffer: MAX_FOREGROUND_BYTES, encoding: 'utf8', windowsHide: true };
    try {
      child = platform === 'win32'
        ? execFile(command.file, command.args, { ...options, shell: false }, callback)
        : exec(FOREGROUND_APP_COMMAND, options, callback);
      if (canceled) kill();
    } catch (_) { finish(null); }
  });
}

module.exports = { probeForegroundApp, windowsForegroundCommand };
