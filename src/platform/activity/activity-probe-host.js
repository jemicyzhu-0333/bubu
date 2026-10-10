'use strict';

const path = require('node:path');
const { spawn: spawnProcess, execFile: execFileProcess } = require('node:child_process');
const { parseProbeLine, parseLsappinfoValue, MAX_LINE } = require('./probe-line');

const SAMPLE_INTERVAL_MS = 2_000;
const RESTART_DELAYS_MS = Object.freeze([2_000, 8_000, 30_000]);
const MAX_RESTARTS = 5;
const LSAPPINFO = '/usr/bin/lsappinfo';
const FRONT_BUNDLE_COMMAND = `${LSAPPINFO} info -only bundleid "$(${LSAPPINFO} front)"`;

// Where the helper lives: inside the packaged app's resources, or the repository in development.
function resolveProbeCommand({ platform, isPackaged, resourcesPath, appPath, exists,
  disableDevAudio = process.env.BUBU_DEV_DISABLE_ACTIVITY_AUDIO === '1' }) {
  if (platform === 'darwin') {
    if (!isPackaged && disableDevAudio) return { kind: 'lsappinfo' };
    const file = isPackaged
      ? path.join(resourcesPath, 'activity-probe', 'activity-probe')
      : path.join(appPath, 'build', 'native', 'darwin', 'activity-probe');
    // Without the compiled helper (a development checkout that has not run
    // `npm run native:build`), the front app still comes from lsappinfo; music is off.
    return exists(file) ? { kind: 'helper', file, args: [] } : { kind: 'lsappinfo' };
  }
  if (platform === 'win32') {
    const script = isPackaged
      ? path.join(resourcesPath, 'activity-probe', 'activity-probe.ps1')
      : path.join(appPath, 'native', 'windows', 'activity-probe.ps1');
    if (!exists(script)) return null;
    return { kind: 'helper', file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script] };
  }
  return null;
}

// Runs one helper (or the lsappinfo fallback) and reports parsed samples. A crashing
// helper is restarted with backoff and given up after MAX_RESTARTS; the mirror then
// simply has no samples. Failures never reach the caller as exceptions.
function createActivityProbeHost({
  command, onSample, onError = () => {},
  spawn = spawnProcess, execFile = execFileProcess, setTimer = setTimeout, clearTimer = clearTimeout
}) {
  if (typeof onSample !== 'function') throw new TypeError('activity probe requires a sample sink');
  let child = null;
  let timer = null;
  let running = false;
  let restarts = 0;
  let buffer = '';

  function report(error) { try { onError(error); } catch {} }
  function deliver(sample) { if (running && sample) { try { onSample(sample); } catch (error) { report(error); } } }

  function pollLsappinfo() {
    timer = null;
    if (!running) return;
    execFile('/bin/sh', ['-c', FRONT_BUNDLE_COMMAND], { timeout: 1_500 }, (error, stdout) => {
      if (!running) return;
      deliver(Object.freeze({ front: error ? null : parseLsappinfoValue(stdout), audio: Object.freeze([]) }));
      timer = setTimer(pollLsappinfo, SAMPLE_INTERVAL_MS);
    });
  }

  function consume(chunk) {
    buffer += chunk;
    if (buffer.length > MAX_LINE * 2) buffer = buffer.slice(-MAX_LINE);
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const sample = parseProbeLine(buffer.slice(0, newline).trim());
      // A helper that produces samples again has recovered; only consecutive failures count.
      if (sample) restarts = 0;
      deliver(sample);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }

  function scheduleRestart() {
    if (!running) return;
    if (restarts >= MAX_RESTARTS) { report(new Error('activity probe stopped after repeated failures')); return; }
    const delay = RESTART_DELAYS_MS[Math.min(restarts, RESTART_DELAYS_MS.length - 1)];
    restarts += 1;
    timer = setTimer(() => { timer = null; launch(); }, delay);
  }

  function launch() {
    if (!running) return;
    buffer = '';
    try {
      child = spawn(command.file, command.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
      report(error);
      scheduleRestart();
      return;
    }
    const current = child;
    current.stdout.setEncoding('utf8');
    current.stdout.on('data', chunk => { if (current === child) consume(chunk); });
    current.on('error', error => { if (current === child) report(error); });
    function ended() {
      if (current !== child) return;
      child = null;
      scheduleRestart();
    }
    current.on('exit', ended);
    // A failed spawn emits error + close, but may never emit exit. Keep the same
    // bounded recovery path; ownership prevents exit + close scheduling twice.
    current.on('close', ended);
  }

  function start() {
    if (running || !command) return false;
    running = true;
    restarts = 0;
    if (command.kind === 'lsappinfo') pollLsappinfo();
    else launch();
    return true;
  }

  function stop() {
    running = false;
    if (timer) { clearTimer(timer); timer = null; }
    const current = child;
    child = null;
    if (current) {
      try { current.stdin.end(); } catch {}
      try { current.kill(); } catch {}
    }
  }

  return Object.freeze({ start, stop, isRunning: () => running });
}

module.exports = { createActivityProbeHost, resolveProbeCommand, SAMPLE_INTERVAL_MS, MAX_RESTARTS };
