'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ELECTRON = "process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json')('electron')";
const STATE = '__bubuInstalledUpgradeTest';
const CONFIRM = '为语言与外观设置升级数据 / Upgrade data for language and appearance';
const REPORT = '升级已完成 / Upgrade complete';

async function openSession(url) {
  assert.match(url, /^ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+$/);
  const socket = new WebSocket(url), pending = new Map(), events = [], waiters = [];
  let id = 0;
  const failAll = () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('upgrade inspector disconnected')); }
    pending.clear();
  };
  socket.addEventListener('close', failAll);
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error || message.result?.exceptionDetails) request.reject(new Error('upgrade inspector command failed'));
      else request.resolve(message.result);
    } else if (message.method === 'Debugger.paused') {
      const waiter = waiters.shift();
      if (waiter) { clearTimeout(waiter.timer); waiter.resolve(message.params); }
      else { assert.ok(events.length < 16, 'upgrade inspector pause bound'); events.push(message.params); }
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('upgrade inspector connection timeout')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('upgrade inspector connection failed')); }, { once: true });
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('upgrade inspector request timeout')); }, method === 'Runtime.evaluate' ? 120000 : 15000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  return {
    call,
    async evaluate(expression) { return (await call('Runtime.evaluate', { expression, returnByValue: true })).result?.value; },
    paused() {
      if (events.length) return Promise.resolve(events.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, timer: setTimeout(() => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); reject(new Error('installed entry pause timeout')); }, 15000) };
        waiters.push(waiter);
      });
    },
    close() {
      for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.resolve(null); }
      failAll(); socket.close();
    }
  };
}
function dialogStubExpression(userDataPath) {
  return `(() => {
    const e = ${ELECTRON};
    if (!e.app || typeof e.dialog.showMessageBox !== 'function' || e.app.isReady()) throw new Error('upgrade-hook-too-late');
    const source = ${JSON.stringify(userDataPath)};
    const state = globalThis.${STATE} = { phase: 'installed', calls: [], relaunches: 0, error: null, resolve: null };
    const reject = code => { state.error = code; throw new Error(code); };
    e.dialog.showMessageBox = options => {
      if (options.title !== '小步 · bubu' || options.defaultId !== 0 || options.cancelId !== 0 || options.noLink !== true) return reject('unexpected-dialog-options');
      const confirm = options.type === 'question' && options.message === ${JSON.stringify(CONFIRM)}
        && JSON.stringify(options.buttons) === JSON.stringify(['退出 / Quit', '备份并升级 / Back up and upgrade'])
        && options.checkboxLabel === '已了解需保留备份 / I understand the backup must be kept' && options.checkboxChecked === false
        && typeof options.detail === 'string' && options.detail.includes('18 → 19') && options.detail.includes(source);
      const report = options.type === 'info' && options.message === ${JSON.stringify(REPORT)}
        && JSON.stringify(options.buttons) === JSON.stringify(['确定 / OK']);
      if (confirm && state.phase === 'installed') state.phase = 'confirm';
      else if (report && state.phase === 'approved') state.phase = 'report';
      else return reject('unexpected-dialog-sequence');
      state.calls.push(state.phase);
      return new Promise(resolve => { state.resolve = resolve; });
    };
    e.dialog.showErrorBox = () => { state.error = 'unexpected-native-error-dialog'; };
    e.app.relaunch = options => {
      if (state.phase !== 'reported' || state.relaunches !== 0 || !Array.isArray(options?.args)
        || !options.args.includes('--user-data-dir=' + source)) return reject('unexpected-relaunch');
      state.relaunches++; process.stdout.write('BUBU_UPGRADE_TEST_RELAUNCH\\n');
    };
    return true;
  })()`;
}
function responseExpression(approved, report = false) {
  return `(() => { const s = globalThis.${STATE};
    if (!s || s.error || s.phase !== ${JSON.stringify(report ? 'report' : 'confirm')} || typeof s.resolve !== 'function') throw new Error('unexpected-consent-response');
    const resolve = s.resolve; s.resolve = null; s.phase = ${JSON.stringify(report ? 'reported' : approved ? 'approved' : 'declined')};
    setTimeout(() => resolve(${JSON.stringify({ response: report || !approved ? 0 : 1, checkboxChecked: !report && approved })}), 100); return true;
  })()`;
}
async function interceptInstalledEntry(session, userDataPath, { source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8'), hookExpression = dialogStubExpression(userDataPath) } = {}) {
  await session.call('Debugger.enable');
  const breakpoint = await session.call('Debugger.setBreakpointByUrl', { urlRegex: '[/\\\\]app\\.asar[/\\\\]src[/\\\\]main\\.js$', lineNumber: 0 });
  await session.call('Runtime.runIfWaitingForDebugger');
  let entry;
  for (let attempt = 0; attempt < 6; attempt++) {
    const paused = await session.paused();
    assert.ok(paused?.callFrames?.length, 'installed main pause required');
    const scriptId = paused.callFrames[0].location.scriptId;
    const actual = (await session.call('Debugger.getScriptSource', { scriptId })).scriptSource;
    if (actual === source) { entry = paused; break; }
    await session.call('Debugger.resume');
  }
  assert.ok(entry, 'paused executable main must match exact candidate source bytes');
  assert.equal(await session.evaluate(hookExpression), true);
  await session.call('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
  await session.call('Debugger.resume');
  return createHash('sha256').update(source).digest('hex');
}
module.exports = { openSession, dialogStubExpression, responseExpression, interceptInstalledEntry, ELECTRON, STATE, CONFIRM, REPORT };
