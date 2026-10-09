'use strict';
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
const deadline = setTimeout(() => { console.error('inbox bench timed out'); app.exit(1); }, 120000);
async function run() {
  const panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/popover.html'));
  panel.removeAllListeners('blur'); panel.showInactive(); nativeTheme.themeSource = 'light';
  const js = source => panel.webContents.executeJavaScript(source);
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(180); };
  const choose = async (selector, value) => { await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(180); };
  const out = path.resolve('dist/inbox-panel'); fs.mkdirSync(out, { recursive: true });
  const shot = async name => { await pause(100); fs.writeFileSync(path.join(out, `${name}.png`), (await panel.webContents.capturePage()).toPNG()); };
  await js("window.bubu.updateSettings({aiBreakdownEnabled:false,motionMode:'full',stimulationMode:'balanced'})");
  const examples = [
    ['吃完晚饭了', 'log', 'meal'], ['每天散步十分钟', 'routine', 'movement'],
    ['今天有点委屈', 'feeling'], ['想到一个周末出游的点子', 'note'],
    ['整理项目里的重复代码', 'task'], ['现在头脑很清楚', 'state'], ['应该睡觉但是不困', 'unclassified']
  ];
  const ids = {};
  for (const [text, category, routineKind] of examples) {
    const id = await js(`(async()=>{await window.bubu.addImpulse(${JSON.stringify(text)});return (await window.bubu.getState()).impulses.find(i=>i.text===${JSON.stringify(text)}).id})()`);
    ids[category] = id;
    if (category !== 'unclassified') assert.equal((await js(`window.bubu.organizeImpulse(${JSON.stringify({ id, action: 'classify', category, routineKind: routineKind || null, level: category === 'state' ? 65 : null })})`)).ok, true);
  }
  await click('#tabArrange'); await shot('01-tasks');
  assert.ok(await js("(()=>{const a=document.querySelector('.task-filters').getBoundingClientRect(),b=document.querySelector('#btnOpenTaskCreate').getBoundingClientRect();return Math.abs(a.top-b.top)<2 && b.left>=a.right})()"), 'task controls share a row');
  assert.equal(await js("document.querySelector('#inboxStrip')"), null);
  await click('#tabInbox'); await shot('02-inbox');
  assert.equal(await js("document.body.dataset.destination"), 'inbox');
  assert.equal(await js("document.querySelectorAll('.tab-btn .tab-glyph').length"), 7);
  const row = category => `[data-impulse-id="${ids[category]}"]`;
  assert.ok(await js("[...document.querySelectorAll('.inbox-card')].every(row=>[...row.querySelectorAll('[data-inbox-action]')].filter(e=>e.checkVisibility()).length===1)"), 'one visible primary action per card');
  await click(row('task') + ' .inbox-options > summary');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('task') + ' [data-inbox-action=schedule]')}).checkVisibility()`), true);
  await js(`document.querySelector(${JSON.stringify(row('task'))}).scrollIntoView({block:'center'})`); await shot('07-card-actions');
  await js(`(()=>{const e=document.querySelector(${JSON.stringify(row('task') + ' [data-inbox-action=schedule]')});e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))})()`);
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('task') + ' .inbox-options')}).open`), false);
  // Missing routine metadata reveals the editor, and classification rerenders preserve draft/focus.
  // Browsing labels is a local draft: nothing is written until the primary action.
  await choose(row('routine') + ' .inbox-category', 'note');
  assert.equal(await js(`(async()=>(await window.bubu.getState()).impulses.find(i=>i.id===${JSON.stringify(ids.routine)}).classification.category)()`), 'routine');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('routine') + ' .inbox-source')}).textContent`), '未保存');
  await choose(row('routine') + ' .inbox-category', 'routine');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('routine') + ' .inbox-details')}).open`), false, 'complete details stay folded');
  await choose(row('routine') + ' .inbox-kind', '');
  await click(row('routine') + ' [data-inbox-action=routine]');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('routine') + ' .inbox-details')}).open`), true);
  assert.equal(await js("document.activeElement.className"), 'inbox-kind');
  await js(`(()=>{const e=document.querySelector(${JSON.stringify(row('routine') + ' .inbox-title')});e.value='晚饭后散步十分钟';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await choose(row('routine') + ' .inbox-kind', 'movement');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('routine') + ' .inbox-details')}).open`), true);
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('routine') + ' .inbox-title')}).value`), '晚饭后散步十分钟');
  await shot('08-card-settings');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('unclassified') + ' [data-inbox-action=keep]')}).textContent`), '先留存');
  await click(row('unclassified') + ' [data-inbox-pick=feeling]');
  assert.equal(await js(`document.querySelector(${JSON.stringify(row('unclassified') + ' [data-inbox-action=feeling]')}).textContent`), '保存情绪');
  await click(row('log') + ' [data-inbox-action=log]');
  assert.equal(await js(`(async()=>{return (await window.bubu.getInboxHistory({})).items.find(i=>i.id===${JSON.stringify(ids.log)}).resolution.action})()`), 'log');
  await click(row('routine') + ' [data-inbox-action=routine]');
  await click('#tabRoutines'); await shot('09-routines');
  assert.ok(await js("document.querySelector('#tabRoutines #routinesManageCount').textContent==='2'"));
  assert.equal(await js("document.querySelector('.routine-page-title').textContent"), '今天的记录');
  await click('#tabProgress'); await shot('10-review');
  assert.ok(await js("[...document.querySelectorAll('.stat-card')].every(e=>e.querySelector('.stat-label').getBoundingClientRect().bottom<=e.querySelector('.stat-num').getBoundingClientRect().top && parseFloat(getComputedStyle(e.querySelector('.stat-num')).fontSize)>=26)"));
  await click('#tabArrange'); await click('#tabInbox');
  await click(row('feeling') + ' [data-inbox-action=feeling]');
  await click(row('note') + ' [data-inbox-action=keep]');
  await click(row('state') + ' [data-inbox-action=state]');
  await click(row('task') + ' [data-inbox-action=next-step]');
  assert.equal(await js("document.getElementById('breakdownMask').classList.contains('hidden')"), false);
  await js("document.querySelector('#breakdownMask .modal-close').click()"); await pause(100);
  // Keep-all needs two deliberate clicks and moves every pending capture to history.
  for (const text of ['想到的一句话', '另一句']) await js(`window.bubu.addImpulse(${JSON.stringify(text)})`);
  await pause(250);
  await click('#inboxKeepAll');
  assert.match(await js("document.querySelector('#inboxKeepAll').textContent"), /^确认留存 3 条$/);
  assert.equal(await js("document.querySelectorAll('.inbox-card').length"), 3);
  await click('#inboxKeepAll'); await pause(250);
  assert.equal(await js("document.querySelectorAll('.inbox-card').length"), 0);
  await click('[data-inbox-scope=history]'); await shot('03-history');
  assert.equal(await js("document.querySelectorAll('.inbox-card').length"), 9);
  await choose('#inboxCategoryFilter', 'log');
  assert.equal(await js("document.querySelectorAll('.inbox-card').length"), 1);
  assert.equal(await js("document.querySelector('.inbox-label').textContent"), '日常记录');
  await choose('#inboxCategoryFilter', '');
  await click('#tabArchive'); await shot('04-archive');
  await js("document.getElementById('tabArchive').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))");
  assert.equal(await js("document.activeElement.id"), 'tabInbox');
  await click('[data-inbox-scope=pending]');
  panel.setResizable(true); panel.setSize(480, 620); await pause(180); await shot('05-small');
  assert.ok(await js("[document.querySelector('#arrangeNavigation'),document.querySelector('#panelInbox')].every(e=>e.scrollWidth<=e.clientWidth+1)"));
  nativeTheme.themeSource = 'dark'; await shot('06-dark');
  await click('#tabTasks'); await shot('11-small-tasks');
  assert.ok(await js("document.querySelector('#panelTasks').scrollWidth<=document.querySelector('#panelTasks').clientWidth+1"));
  await click('#tabProgress'); await shot('12-small-review');
  assert.ok(await js("document.querySelector('.stats-with-review').scrollWidth<=document.querySelector('.stats-with-review').clientWidth+1"));
  await js("document.querySelector('#dndPill').dispatchEvent(new Event('pointerenter'))"); await pause(150);
  assert.notEqual(await js("getComputedStyle(document.querySelector('#dndPill .header-glyph')).transform"), 'none');
  assert.ok(await js("(async()=>{const button=document.querySelector('#dndPill'),icon=button.querySelector('.header-glyph'),before=getComputedStyle(icon).transform;button.focus();button.click();await Promise.resolve();return getComputedStyle(icon).transform===before})()"), 'focus/click must not reset the live hover transform');
  await pause(650);
  assert.equal(await js("getComputedStyle(document.querySelector('#dndPill .header-glyph')).transform"), 'none');
  await js("window.bubu.updateSettings({motionMode:'reduced'})"); await pause(80);
  await js("document.querySelector('#tabInbox').dispatchEvent(new Event('pointerenter'))"); await pause(60);
  assert.equal(await js("getComputedStyle(document.querySelector('#tabInbox .tab-glyph')).transform"), 'none');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output: out, errors, verified: ['compact task toolbar', 'daily count in tab', 'label before large stats', 'one primary action per card', 'progressive fields and draft persistence', 'Escape disclosures', 'manual category', 'atomic routine/log/mood/state/task', 'history categories', 'keyboard', '480x620 light/dark', 'GSAP hover-focus-click continuity and cleanup/reduced'] }));
}
app.whenReady().then(() => pause(1500)).then(run).then(() => app.exit(0)).catch(error => { console.error(error.stack); app.exit(1); }).finally(() => clearTimeout(deadline));
