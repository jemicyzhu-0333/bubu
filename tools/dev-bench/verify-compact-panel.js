'use strict';
// Screenshot annotations exercised against real IPC on launch.js's temporary profile.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const errors = [];
app.on('browser-window-created', (_, win) => win.webContents.on('console-message', details => {
  if (details.level === 'error') errors.push(details.message);
}));
require('./launch');
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const deadline = setTimeout(() => { console.error('compact panel timed out'); app.exit(1); },120000);
const out = path.resolve(__dirname,'../../dist/compact-panel');
async function run() {
  fs.mkdirSync(out,{recursive:true});
  const panel = BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/popover.html'));
  assert.ok(panel); panel.removeAllListeners('blur'); panel.showInactive();
  console.log('Window dimensions', {outer:panel.getSize(),content:panel.getContentSize()});
  // Windows display scaling can round the native frame by up to 2 DIP.
  assert.ok(panel.getSize().every((value,index)=>Math.abs(value-[560,680][index])<=2));
  const js = code => panel.webContents.executeJavaScript(code);
  const click = async id => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await pause(220); };
  const shot = async name => {
    await pause(200); fs.writeFileSync(path.join(out,name+'.png'),(await panel.webContents.capturePage()).toPNG());
  };
  const visibleFooter = async id => assert.ok(await js(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`),id+' is visible');
  const noOverflow = async selector => assert.ok(await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e.scrollWidth<=e.clientWidth+1})()`),selector+' does not overflow');
  nativeTheme.themeSource='light';
  await js("window.bubu.updateSettings({motionMode:'full',stimulationMode:'balanced',energyCurveEnabled:true})");
  await pause(200);
  await shot('01-now');
  console.log('Motion policy', await js("({hidden:document.hidden,motion:document.body.dataset.motion,stimulation:document.body.dataset.stimulation,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches})"));
  assert.equal(await js("document.getElementById('btnQuickCapture').closest('header')!==null"),true);
  for (const id of ['btnQuickCapture','dndPill','tabCompanion','btnSettings']) {
    await js(`document.getElementById('${id}').dispatchEvent(new Event('pointerenter'))`); await pause(70);
    assert.equal(await js(`getComputedStyle(document.querySelector('#${id} .header-glyph')).transform !== 'none'`),true,id+' feedback');
  }
  await js("document.getElementById('tileEnergy').click();document.getElementById('energyStrip').scrollIntoView({block:'center'})");
  await pause(100);
  assert.equal(await js("document.querySelectorAll('#energyCurvePlot svg .energy-line').length"),2);
  assert.equal(await js("document.querySelectorAll('#energyCurvePlot i').length"),0);
  const face = await js("(()=>{const r=document.querySelectorAll('.energy-checkin-btn')[2].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  panel.webContents.sendInputEvent({type:'mouseMove',...face}); await pause(100);
  assert.ok(await js("Number(document.querySelectorAll('.energy-checkin-btn')[2].style.getPropertyValue('--dock-scale'))>1.2"));
  await shot('02-energy-dock');
  await js("window.bubu.updateSettings({motionMode:'reduced'})"); await pause(100);
  assert.equal(await js("getComputedStyle(document.querySelectorAll('.energy-checkin-btn')[2]).transform"),'none');
  await js("window.bubu.updateSettings({motionMode:'full'})");
  await js("window.bubu.addImpulse('周末给绿萝换盆')");
  await js("window.bubu.addImpulse('把今天的问题留到明天整理')");
  await js("window.bubu.addTask({title:'优化水导激光代码工程',description:'先完成一个小的优化版本。',estimateMinutes:180,tags:['本周'],steps:[{title:'打开项目并检查现有代码与测试'},{title:'记录第一个明显的耗时、重复或异常之处'},{title:'完成一个相关修改，再验证同一段代码'}]})");
  const taskId = await js("(async()=>{const s=await window.bubu.getState();return s.tasks.find(t=>t.title==='优化水导激光代码工程').id})()");
  await js(`window.bubu.setNowTask(${JSON.stringify(taskId)})`);
  await click('tabArrange'); await shot('03-tasks');
  assert.equal(await js("document.getElementById('inboxPager')"),null);
  assert.equal(await js("document.querySelector('#tabInbox .tab-glyph svg')!==null"),true);
  const button = await js("(()=>{const b=document.getElementById('btnOpenTaskCreate'),r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return{height:r.height,icon:i.height,width:r.width}})()");
  assert.ok(button.height<=44&&button.icon===18&&button.width<170);
  await click('tabInbox'); await shot('04-inbox');
  await click('tabToday');
  await js("if(!document.getElementById('energyStrip').hidden)document.getElementById('tileEnergy').click();document.getElementById('panelToday').scrollTop=0");
  await click('btnEditNowTask');
  assert.equal(await js("document.getElementById('editDates').open"),false);
  assert.equal(await js("document.getElementById('editAttributes').open"),false);
  await shot('05-editor'); await visibleFooter('taskEditConfirm');
  await js("document.getElementById('editDates').open=true;document.getElementById('editAttributes').open=true;document.getElementById('editPlannedFor').value='2026-10-02';document.getElementById('editDates').scrollIntoView({block:'start'})");
  await shot('06-editor-options'); await noOverflow('#taskEditMask .modal-body');
  await js("document.getElementById('editDates').open=false;document.getElementById('editAttributes').open=false;document.getElementById('editDescription').value='只做一个可验证的小修改'");
  await click('taskEditConfirm');
  const saved = await js(`(async()=>{const s=await window.bubu.getState();return s.tasks.find(t=>t.id===${JSON.stringify(taskId)})})()`);
  assert.equal(saved.plannedFor,'2026-10-02'); assert.equal(saved.estimateMinutes,180);
  assert.deepEqual(saved.tags,['本周']); assert.equal(saved.description,'只做一个可验证的小修改');
  await click('tabCompanion'); await shot('07-companion');
  const companion = await js("(()=>{const food=document.getElementById('btnOpenFood').getBoundingClientRect(),journey=document.getElementById('btnOpenJourney').getBoundingClientRect();return{oneGrowthBar:document.querySelectorAll('#panelCompanion [role=progressbar]').length===1,sameRow:Math.abs(food.top-journey.top)<2,journeyRight:journey.left>food.left,nested:document.getElementById('journeyPanel').contains(document.getElementById('bondProgress'))}})()");
  assert.deepEqual(companion,{oneGrowthBar:true,sameRow:true,journeyRight:true,nested:true});
  await js("document.getElementById('btnOpenFood').scrollIntoView({block:'end'})");
  await shot('07b-companion-entries');
  for (const selector of ['#btnOpenSkins','#btnOpenWardrobe','#btnOpenFood','#btnOpenJourney']) {
    await js(`document.querySelector('${selector}').dispatchEvent(new Event('pointerenter'))`); await pause(60);
    assert.equal(await js(`getComputedStyle(document.querySelector('${selector} .entry-glyph')).transform!=='none'`),true,selector+' motion');
  }
  await js("document.getElementById('btnOpenJourney').click();document.getElementById('journeyBondTitle').scrollIntoView({block:'center'})");
  await shot('08-journey');
  await js("document.getElementById('journeyPanel').close()");
  await click('btnSettings');
  await js("document.getElementById('settingGroupAi').open=true;document.getElementById('settingGroupAi').scrollIntoView({block:'start'})");
  await shot('09-ai-settings'); await noOverflow('.settings-drawer-scroll');
  await visibleFooter('btnSettingsClose');
  assert.equal(await js("document.getElementById('settingsMask').scrollTop"),0);
  assert.ok(await js("document.getElementById('aiBaseUrlInput').getBoundingClientRect().width>innerWidth-90"));
  await js("document.getElementById('aiModelInput').value='demo-model';document.getElementById('aiModelInput').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('aiBaseUrlInput').value='https://example.invalid/v1';document.getElementById('aiBaseUrlInput').dispatchEvent(new Event('input',{bubbles:true}))");
  await click('aiSaveConfig');
  const settings = await js('(async()=>{const s=await window.bubu.getState();return s.settings})()');
  assert.equal(settings.aiModel,'demo-model'); assert.equal(settings.aiBaseUrl,'https://example.invalid/v1');
  // The disabled AI switch prevents any request; saving configuration is a local operation.
  assert.equal(settings.aiBreakdownEnabled,false);
  panel.setResizable(true); panel.setMinimumSize(0,0); panel.setSize(480,620); await pause(150);
  await shot('10-settings-small'); await noOverflow('.settings-drawer-scroll');
  for (const id of await js("Array.from(document.querySelectorAll('.setting-group')).map(e=>e.id)")) {
    await js(`document.querySelectorAll('.setting-group').forEach(e=>e.open=e.id==='${id}');document.getElementById('${id}').scrollIntoView({block:'start'})`);
    await noOverflow('.settings-drawer-scroll'); await visibleFooter('btnSettingsClose');
  }
  await js("document.getElementById('settingGroupAi').open=true");
  await click('btnSettingsClose'); await click('tabToday');
  await js("document.getElementById('panelToday').scrollTop=0");
  await click('btnStartFocus'); await shot('11-focus-small');
  await visibleFooter('btnPauseFocus');
  assert.ok(await js("document.getElementById('btnPauseFocus').getBoundingClientRect().bottom<=document.getElementById('captureBar').getBoundingClientRect().top"));
  await click('btnPauseFocus'); await shot('12-paused-small');
  nativeTheme.themeSource='dark'; await click('btnSettings'); await shot('13-settings-dark');
  await noOverflow('.settings-drawer-scroll');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({output:out,errors,verified:['native dimensions','header motion','smooth energy','mood Dock','task list','inbox','collapsed editor saves','companion hierarchy and motion','AI form saves','light/dark/small window']}));
}
app.whenReady().then(()=>pause(1400)).then(run).then(()=>app.exit(0))
  .catch(error=>{console.error(error.stack);app.exit(1);}).finally(()=>clearTimeout(deadline));
