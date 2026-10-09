'use strict';
// electron tools/dev-bench/verify-activity-mirror.js --scenario=menu
// The activity mirror end to end inside Electron: the setting in the real panel, and
// each category arriving at the real pet window as a pose (ARCHITECTURE「活动镜像」).
// OS probes are platform helpers and are exercised on macOS / Windows themselves.
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
const deadline = setTimeout(() => { console.error('activity mirror bench timed out'); app.exit(1); }, 150000);

async function run() {
  const windows = BrowserWindow.getAllWindows();
  const panel = windows.find(win => win.webContents.getURL().endsWith('/popover.html'));
  const pet = windows.find(win => win.webContents.getURL().endsWith('/pet.html'));
  assert.ok(panel && pet, 'panel and pet windows exist');
  panel.removeAllListeners('blur'); panel.showInactive(); nativeTheme.themeSource = 'light';
  const js = source => panel.webContents.executeJavaScript(source);
  const petJs = source => pet.webContents.executeJavaScript(source);
  const out = path.resolve('dist/activity-mirror'); fs.mkdirSync(out, { recursive: true });
  const shot = async (win, name) => { await pause(250); fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };

  // Autonomous cues would cover the poses in screenshots; let any greeting finish first.
  await js("window.bubu.updateSettings({petActivityMode:'off'})");
  await pause(9000);
  // Off by default: no category, nothing read.
  assert.equal(await js('(async()=>(await window.bubu.getState()).settings.activityMirrorEnabled)()'), false);
  await js("document.getElementById('btnSettings').click()"); await pause(250);
  await js("const g=document.getElementById('settingGroupActivityMirror');g.open=true;g.scrollIntoView({block:'start'})");
  assert.equal(await js("document.getElementById('activityMirrorStatus').textContent"), '关闭时不读取任何应用信息。');
  await js("document.getElementById('activityMirrorToggle').click()"); await pause(400);
  assert.equal(await js('(async()=>(await window.bubu.getState()).settings.activityMirrorEnabled)()'), true);
  assert.equal(await js("document.getElementById('activityMirrorToggle').getAttribute('aria-pressed')"), 'true');
  assert.equal(await js("document.getElementById('activityMirrorStatus').textContent"), '暂时没有可以跟随的活动');
  await shot(panel, '01-settings-on');

  // Each category reaches the pet as its own pose; null returns it to its own state.
  const expected = { music: '♪ 听音乐', coding: '⌨ 写代码', ai: '… 和 AI 对话' };
  for (const [activity, label] of Object.entries(expected)) {
    pet.webContents.send('pet:sync', { activityMirror: activity });
    await pause(600);
    assert.equal(await petJs("document.getElementById('activityLabel').textContent"), label);
    await shot(pet, `02-pet-${activity}`);
  }
  pet.webContents.send('pet:sync', { activityMirror: null });
  await pause(400);
  assert.equal(await petJs("document.getElementById('activityLabel').textContent"), '');
  pet.webContents.send('pet:sync', { activityMirror: 'invented' });
  await pause(300);
  assert.equal(await petJs("document.getElementById('activityLabel').textContent"), '', 'unknown categories are ignored');

  await js("document.getElementById('activityMirrorToggle').click()"); await pause(400);
  assert.equal(await js('(async()=>(await window.bubu.getState()).settings.activityMirrorEnabled)()'), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output: out, errors, verified: ['off by default', 'toggle and status', 'music/coding/ai poses on the pet', 'null and unknown categories'] }));
}
app.whenReady().then(() => pause(3000)).then(run).then(() => app.exit(0)).catch(error => { console.error(error.stack); app.exit(1); }).finally(() => clearTimeout(deadline));
