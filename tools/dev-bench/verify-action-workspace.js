'use strict';
// Real renderer + IPC, exclusively on launch.js's isolated profile.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const errors = [];
app.on('browser-window-created', (_, win) => win.webContents.on('console-message', details => {
  if (details.level === 'error') errors.push(details.message);
}));
require('./launch');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('action workspace timed out'); app.exit(1); }, 120000);
const out = path.resolve(__dirname, '../../dist/action-workspace');
async function run() {
  fs.mkdirSync(out, { recursive: true });
  const panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/popover.html'));
  assert.ok(panel);
  panel.removeAllListeners('blur');
  panel.setResizable(true); panel.setMinimumSize(0, 0); panel.setSize(640, 760); panel.showInactive();
  const js = code => panel.webContents.executeJavaScript(code);
  const click = async id => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await pause(180); };
  const shot = async name => {
    await pause(250);
    fs.writeFileSync(path.join(out, name + '.png'), (await panel.webContents.capturePage()).toPNG());
  };
  nativeTheme.themeSource = 'light';
  if (process.argv.includes('--scenario=focus-landing')) {
    await pause(180);
    assert.equal(await js('document.body.dataset.actionState'), 'landing');
    assert.equal(await js("document.getElementById('quickStartMask').getAttribute('aria-hidden')"), 'false');
    await shot('14-landing');
    await js("const input=document.getElementById('landingNote');input.value='挑一个例子放进第一部分';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-focus-landing=save]').click()");
    await pause(250);
    const state = await js('window.bubu.getState()');
    assert.equal(state.focusLandingPrompt, null);
    assert.equal(state.tasks.find(task=>task.id===state.nowTaskId).nextAction, '挑一个例子放进第一部分');
    assert.equal(await js("document.getElementById('nowNextAction').textContent"), '挑一个例子放进第一部分');
    await shot('15-return');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ output: out, errors, verified: ['persisted handoff', 'save next action through IPC', 'return to ready'] }));
    return;
  }
  await pause(180); await shot('01-empty');
  assert.equal(await js('document.body.dataset.actionState'), 'empty');
  await js("window.bubu.addTask({title:'准备周五的分享',steps:[{title:'打开上次的文档，写下三个小标题'},{title:'挑一个例子放进第一部分'}]})");
  await js("(async()=>{const s=await window.bubu.getState();await window.bubu.setNowTask(s.tasks.find(t=>t.title==='准备周五的分享').id)})()");
  await pause(200); await shot('02-ready');
  assert.equal(await js('document.body.dataset.actionState'), 'ready');
  assert.equal(await js("document.getElementById('durationPicker').open"), false);
  assert.ok(await js("document.getElementById('nowNextAction').textContent.includes('三个小标题')"));
  await click('btnStartFocus');
  assert.equal(await js('document.body.dataset.actionState'), 'focus');
  await shot('03-focus');
  panel.setSize(460, 680); await pause(150); await shot('16-narrow-focus');
  assert.ok(await js("document.getElementById('btnPauseFocus').getBoundingClientRect().bottom <= document.getElementById('captureBar').getBoundingClientRect().top"), 'pause stays above capture in a short window');
  panel.setSize(640, 760); await pause(150);
  await click('btnPauseFocus');
  assert.equal(await js('document.body.dataset.actionState'), 'paused');
  await shot('04-paused');
  // Capture while paused, then return through nested navigation: neither loses execution state.
  await js("document.getElementById('captureInput').value='周末给绿萝换盆';document.getElementById('captureBar').requestSubmit()");
  await pause(150);
  await click('tabArrange');
  assert.equal(await js('document.body.dataset.destination'), 'tasks');
  await shot('06-tasks');
  await click('tabRoutines'); await shot('07-routines');
  await click('tabToday'); await click('tabArrange');
  assert.equal(await js('document.body.dataset.destination'), 'routines', 'arrangement remembers its selected child');
  await click('tabToday');
  assert.equal(await js('document.body.dataset.actionState'), 'paused');
  await click('btnResumeFocus');
  assert.equal(await js('document.body.dataset.actionState'), 'focus');
  await click('btnStopFocus'); await shot('05-stopped');
  await click('tabProgress'); await shot('08-review');
  await click('tabCompanion'); await shot('09-companion');
  await click('btnSettings'); await shot('10-settings'); await click('btnSettingsClose');
  await click('tabTasks'); await click('btnOpenTaskCreate'); await shot('11-create');
  await js("document.getElementById('taskCreateMask').querySelector('.modal-close').click()");
  nativeTheme.themeSource = 'dark'; await click('tabToday'); await shot('12-dark');
  panel.setSize(460, 680); await pause(150); await shot('13-narrow');
  assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
  assert.ok(await js("document.getElementById('captureInput').getBoundingClientRect().bottom<=innerHeight"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output: out, errors, verified: ['execution and capture', 'nested navigation', 'light/dark/narrow layout'] }));
}
app.whenReady().then(() => pause(1500)).then(run).then(() => app.exit(0))
  .catch(error => { console.error(error.stack); app.exit(1); }).finally(() => clearTimeout(deadline));
