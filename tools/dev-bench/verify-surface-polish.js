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
const deadline = setTimeout(() => { console.error('verification timed out'); app.exit(1); }, 60000);
const out = path.resolve(__dirname, '../../dist/surface-polish');
async function run() {
  fs.mkdirSync(out, { recursive: true });
  const find = name => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/' + name + '.html'));
  const panel = find('popover'), pet = find('pet');
  // Layout verification stays visible while the developer uses another app.
  // Production blur behavior is covered by window-host tests.
  panel.removeAllListeners('blur');
  const js = code => panel.webContents.executeJavaScript(code);
  const shot = async (name, win = panel) => {
    assert.ok(win.isVisible(), `${name}: window must be visible before capture`);
    await pause(400); fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());
  };
  nativeTheme.themeSource = 'light';
  await pet.webContents.executeJavaScript('window.imAdhder.pet_openPanel()'); await pause(500);
  panel.showInactive();
  await js("window.imAdhder.updateSettings({motionMode:'full',stimulationMode:'balanced'})");
  await js("window.imAdhder.addImpulse('周末给阳台的绿萝换一个花盆')");
  await js("window.imAdhder.addImpulse('明天问问朋友有没有空一起吃饭。'.repeat(20))");
  await js("document.getElementById('tabTasks').click()"); await pause(400);
  assert.ok(await js("document.getElementById('inboxStrip').getBoundingClientRect().height<115"));
  const preview = await js("document.getElementById('inboxStripPreview').textContent");
  await js("document.getElementById('inboxNext').click()"); await pause(300);
  assert.notEqual(await js("document.getElementById('inboxStripPreview').textContent"),preview);
  assert.equal(await js("document.getElementById('reviewCount').textContent"),'');
  for (const id of ['btnReviewInbox','dndPill','btnQuickCapture','btnSettings']) {
    assert.ok(await js(`(async()=>{ const {gsap}=await import('../../node_modules/gsap/index.js'); const b=document.getElementById('${id}'); b.dispatchEvent(new PointerEvent('pointerover',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); return gsap.getTweensOf(b.querySelector('.header-glyph')).length>0; })()`));
  }
  await shot('tasks-light');
  nativeTheme.themeSource = 'dark'; await shot('tasks-dark');
  nativeTheme.themeSource = 'light';
  await js("document.getElementById('tabToday').click();document.getElementById('btnChooseCandidates').click()"); await pause(400);
  assert.ok(await js("document.querySelector('#candidateGrid > button.candidate-card')!==null"));
  assert.equal(await js("document.querySelectorAll('#candidateGrid p, #candidateGrid button button').length"),0);
  await js("document.getElementById('candidatePanel').scrollIntoView({block:'center'})"); await shot('candidates');
  await js("document.querySelector('#candidateGrid > button').click()"); await pause(200);
  assert.equal(await js("document.getElementById('candidatePanel').getAttribute('aria-hidden')"),'true');
  await js("document.getElementById('tabProgress').click()"); await pause(350);
  await js("document.querySelector('.timeline-help').open=true;document.querySelector('.timeline-help').scrollIntoView({block:'end'})");
  assert.ok(await js("(()=>{const p=document.querySelector('.timeline-help p'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return s.position==='static'&&r.width>100&&r.bottom<=document.querySelector('.capture-bar').getBoundingClientRect().top})()"));
  await shot('timeline-help');
  panel.setResizable(true); panel.setMinimumSize(0,0); panel.setSize(460,680); await pause(250);
  assert.ok(await js('innerWidth<=460'), `narrow test must really resize the native window: ${JSON.stringify(panel.getBounds())}`);
  await js("document.getElementById('tabTasks').click()"); await shot('tasks-narrow');
  assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
  await js("document.getElementById('btnSettings').click()"); await shot('settings');
  await js("window.imAdhder.updateSettings({motionMode:'reduced'})");
  assert.equal(await js("(async()=>{const{gsap}=await import('../../node_modules/gsap/index.js');const b=document.getElementById('btnSettings');b.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await new Promise(r=>setTimeout(r,30));return gsap.getTweensOf(b.querySelector('.header-glyph')).length})()"),0);
  await js("window.imAdhder.updateSettings({motionMode:'full'});window.imAdhder.hidePopover()");
  await pet.webContents.executeJavaScript("document.getElementById('petHit').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))"); await shot('pet-menu',pet);
  await pet.webContents.executeJavaScript("document.querySelector('[data-act=impulse]').click()"); await pause(650);
  const quick=find('impulse'); assert.ok(quick?.isVisible()); await shot('quick-idle',quick);
  await quick.webContents.executeJavaScript("document.querySelector('.quick-candidate').click()"); await pause(450);
  await js('window.imAdhder.openImpulse()'); await pause(550);
  assert.equal(await quick.webContents.executeJavaScript('document.body.dataset.mode'),'active');
  assert.ok(await quick.webContents.executeJavaScript("document.querySelector('.action-row').getBoundingClientRect().bottom<innerHeight"));
  await shot('quick-active',quick);
  nativeTheme.themeSource='dark';await shot('quick-dark',quick);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({output:out,errors,verified:['four header GSAP responses','compact quote carousel','direct candidate selection','timeline help containment','narrow/light/dark surfaces','quick idle and active']}));
}
app.whenReady().then(()=>pause(1700)).then(run).then(()=>app.exit(0)).catch(e=>{console.error(e.stack);app.exit(1);}).finally(()=>clearTimeout(deadline));
