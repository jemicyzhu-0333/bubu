'use strict';
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const errors=[];
app.on('browser-window-created',(_,win)=>win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);}));
require('./launch');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('quiet panel timed out');app.exit(1);},120000);
async function run(){
  const panel=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/popover.html'));
  panel.removeAllListeners('blur');panel.showInactive();nativeTheme.themeSource='light';
  const js=code=>panel.webContents.executeJavaScript(code).catch(error=>{console.error('Failed script:',code,errors);throw error;});
  const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(180);};
  const out=path.resolve(__dirname,'../../dist/quiet-panel');fs.mkdirSync(out,{recursive:true});
  const shot=async name=>{await pause(150);fs.writeFileSync(path.join(out,name+'.png'),(await panel.webContents.capturePage()).toPNG());};
  const bounded=async selector=>assert.ok(await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return r.left>=16&&r.right<=innerWidth-16&&r.top>=16&&r.bottom<=innerHeight-16&&e.scrollWidth<=e.clientWidth+1})()`),selector+' is bounded');
  await js("window.imAdhder.updateSettings({motionMode:'full',stimulationMode:'balanced'})");
  await js("window.imAdhder.addImpulse('给小猫补充食物，周末整理客厅，记下今天想到的一个很长很长很长的待办事项')");
  await click('#tabArrange');await shot('01-tasks');
  assert.equal(await js("document.querySelector('#panelInbox').hidden"),true);
  await click('#btnOpenTaskCreate');await shot('02-create');
  await bounded('#taskCreateMask .modal');
  assert.equal(await js("document.querySelectorAll('.date-segments button').length"),3);
  await click('[data-when=tomorrow]');
  await click('#createAddStep');
  await js("document.getElementById('taskInput').value='测试紧凑新任务';document.querySelector('#createSteps textarea').value='先打开文件';document.querySelector('#createSteps textarea').dispatchEvent(new Event('input',{bubbles:true}))");
  const before=await js("document.querySelector('#taskCreateMask .modal').getBoundingClientRect().height");
  await click('.create-assist .inline-help summary');await shot('03-help');
  assert.equal(await js("document.querySelector('#panelHelpTooltip').matches(':popover-open')"),true);
  assert.equal(await js("document.querySelector('#taskCreateMask .modal').getBoundingClientRect().height"),before);
  panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await pause(100);
  assert.equal(await js("document.querySelector('#panelHelpTooltip').matches(':popover-open')"),false);
  assert.equal(await js("document.getElementById('taskCreateMask').classList.contains('hidden')"),false);
  await click('#taskCreateConfirm');
  const task=await js("(async()=>{const s=await window.imAdhder.getState();return s.tasks.find(t=>t.title==='测试紧凑新任务')})()");
  assert.ok(task.plannedFor);assert.equal(task.steps[0].title,'先打开文件');
  await click('#tabProgress');await shot('04-review');
  assert.equal(await js("document.querySelector('.history-overview')"),null);
  await click('#btnReviewInbox');await bounded('#reviewInbox');await shot('05-review-dialog');
  await click('#reviewCards button');
  assert.equal(await js("document.getElementById('reviewInbox').open"),false);
  assert.equal(await js("document.getElementById('reviewMask').classList.contains('hidden')"),false);
  await bounded('#reviewMask .modal');await click('#reviewClose');await click('#btnReviewInbox');
  panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await pause(100);
  assert.equal(await js("document.getElementById('reviewInbox').open"),false);
  await click('#tabCompanion');await pause(500);await shot('06-companion');
  assert.equal(await js("getComputedStyle(document.querySelector('.companion-ambience span')).transform!=='none'"),true);
  await js("window.imAdhder.updateSettings({motionMode:'reduced'})");await pause(100);
  assert.equal(await js("getComputedStyle(document.querySelector('.companion-ambience span')).transform"),'none');
  for(const [button,dialog] of [['#btnOpenFood','#foodShopPanel'],['#btnOpenJourney','#journeyPanel']]){
    await click(button);await bounded(dialog);await shot(dialog.slice(1));
    if(dialog==='#foodShopPanel'){
      await click('#foodShopPanel .inline-help summary');
      assert.equal(await js("document.querySelector('#panelHelpTooltip').matches(':popover-open')"),true);
      panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await pause(80);
      assert.equal(await js("document.getElementById('foodShopPanel').open"),true);
    }
    await click(dialog+' [data-dialog-close]');
  }
  for(const [button,drawer,close] of [['#btnOpenSkins','#skinDrawer','#btnSkinClose'],['#btnOpenWardrobe','#wardrobeDrawer','#btnWardrobeClose']]){
    await click(button);await bounded(drawer);await shot(drawer.slice(1));await click(close);
  }
  await click('#btnSettings');await js("document.getElementById('settingGroupAi').open=true;document.getElementById('settingGroupAi').scrollIntoView({block:'start'})");await bounded('#settingsDrawer');await shot('11-settings');
  panel.setResizable(true);panel.setSize(480,620);await pause(150);await bounded('#settingsDrawer');await shot('12-small');
  nativeTheme.themeSource='dark';await shot('13-dark');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({output:out,errors,verified:['task save','segmented dates','independent inbox page','help top layer and Escape','review dialog','companion motion/reduced','bounded collection/skin/wardrobe/settings','small/dark']}));
}
app.whenReady().then(()=>pause(1500)).then(run).then(()=>app.exit(0)).catch(e=>{console.error(e.stack);app.exit(1);}).finally(()=>clearTimeout(deadline));
