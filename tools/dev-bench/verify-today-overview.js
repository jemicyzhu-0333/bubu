'use strict';
// electron tools/dev-bench/verify-today-overview.js --scenario=menu
// The 现在 page's 「今天」 row: energy, routines and inbox tiles with one detail panel at a time.
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
const deadline = setTimeout(() => { console.error('today overview bench timed out'); app.exit(1); }, 120000);
const hm = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

async function run() {
  const panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/popover.html'));
  panel.removeAllListeners('blur'); panel.showInactive(); nativeTheme.themeSource = 'light';
  const js = source => panel.webContents.executeJavaScript(source);
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(200); };
  const hidden = selector => js(`document.querySelector(${JSON.stringify(selector)}).hidden`);
  const out = path.resolve('dist/today-overview'); fs.mkdirSync(out, { recursive: true });
  const shot = async name => { await pause(150); fs.writeFileSync(path.join(out, `${name}.png`), (await panel.webContents.capturePage()).toPNG()); };
  const now = new Date();
  await js(`window.bubu.addRoutine({title:'吃药',kind:'medication',schedule:{frequency:'daily',timesOfDay:['${hm(new Date(now - 300000))}'],windowMinutes:60}})`);
  await js(`window.bubu.addRoutine({title:'喝水',kind:'custom',schedule:{frequency:'daily',timesOfDay:['${hm(new Date(+now + 3 * 3600000))}'],windowMinutes:60}})`);
  for (const text of ['吃完晚饭了', '想到一个周末出游的点子', '整理项目里的重复代码']) await js(`window.bubu.addImpulse(${JSON.stringify(text)})`);
  await pause(400);
  await click('#tabToday');
  // The headline is an action, never the tab name; tiles are on the first screen.
  assert.notEqual(await js("document.querySelector('#nowCardTitle').textContent"), '现在');
  assert.ok(await js("document.querySelector('#todayOverview').getBoundingClientRect().top < document.querySelector('.today-page').getBoundingClientRect().bottom"), 'today tiles start on the first screen');
  assert.equal(await js("document.querySelector('#todayInboxCount').textContent"), '3');
  assert.equal(await hidden('#routinesStrip'), false, 'a due routine is shown unasked');
  assert.equal(await hidden('#energyStrip'), true, 'energy never unfolds on its own');
  await shot('01-routine-due');
  await click('#tileEnergy');
  assert.deepEqual([await hidden('#energyStrip'), await hidden('#routinesStrip')], [false, true]);
  await shot('02-energy');
  await click('#tileEnergy');
  assert.deepEqual([await hidden('#energyStrip'), await hidden('#routinesStrip')], [true, true]);
  nativeTheme.themeSource = 'dark'; await click('#tileRoutines'); await shot('03-dark');
  panel.setResizable(true); panel.setSize(480, 620); await pause(250);
  assert.ok(await js("document.querySelector('#panelToday').scrollWidth <= document.querySelector('#panelToday').clientWidth + 1"), 'no horizontal overflow at 480 DIP');
  await js("document.querySelector('#todayOverview').scrollIntoView({block:'start'})"); await shot('04-narrow');
  await click('#tileInbox');
  assert.equal(await js('document.body.dataset.destination'), 'inbox');
  assert.equal(await js('document.activeElement.id'), 'tabInbox');
  // During focus the 现在 page keeps only the action and the timer.
  await click('#tabToday'); await click('#btnStartFocus'); await pause(300);
  assert.equal(await js("getComputedStyle(document.querySelector('#todayOverview')).display"), 'none');
  await shot('05-focus');
  await click('#btnStopFocus');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output: out, errors, verified: ['action headline', 'tiles on first screen', 'due routine shown, energy folded', 'one panel at a time', 'light/dark', '480 DIP', 'inbox shortcut and focus', 'hidden during focus'] }));
}
app.whenReady().then(() => pause(2500)).then(run).then(() => app.exit(0)).catch(error => { console.error(error.stack); app.exit(1); }).finally(() => clearTimeout(deadline));
