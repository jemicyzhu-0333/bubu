'use strict';

// Synthetic Electron layout evidence, not human-input or OS-compositor signoff.
// Run with the locked Electron dependency on an authorized desktop/CI runner:
// electron scripts/verify-reminder-layout.cjs dist/reminder-layout
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { cornerLayout } = require('../src/platform/electron/windows/nudge-window');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist/reminder-layout'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-reminder-'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
fs.mkdirSync(output, { recursive: true });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/);
const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
const report = { sourceCommit, sourceDirty, workflowCommit: process.env.GITHUB_SHA || null,
  platform: process.platform, arch: process.arch, versions: process.versions,
  scope: 'Synthetic production-renderer layout and injected keyboard events; no business profile or human input', cases: [] };
let current = null, preferences = null, revision = 0, dismissals = 0;
function owns(event) { return current && !current.isDestroyed() && event.sender === current.webContents; }
ipcMain.handle('settings:get-interface', event => owns(event) ? preferences : null);
ipcMain.handle('nudge:pointer-interactive', event => owns(event));
ipcMain.handle('nudge:dismiss', event => {
  assert.ok(owns(event), 'fixture sender');
  dismissals++;
  return { handled: false }; // Exercise the real failure status without any canonical command.
});
app.on('window-all-closed', () => {});
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} });
const watchdog = setTimeout(() => { report.error = 'Layout probe timed out'; finish(1); }, 180000);
function finish(code) {
  clearTimeout(watchdog);
  fs.writeFileSync(path.join(output, 'layout.json'), JSON.stringify(report, null, 2));
  app.exit(code);
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function painted() {
  await current.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
function measure() {
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  };
  const controls = [...document.querySelectorAll('.nudge-action, #closeBtn')];
  const elementInfo = element => element ? {
    tag: element.tagName, id: element.id, role: element.getAttribute('role'), tabIndex: element.tabIndex,
    rect: rect(element), visible: visible(element), scrollTop: element.scrollTop, scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
  } : null;
  function visible(element) {
    const r = element.getBoundingClientRect(), tolerance = 1;
    if (!(r.width > 0 && r.height > 0) || r.left < -tolerance || r.top < -tolerance
        || r.right > innerWidth + tolerance || r.bottom > innerHeight + tolerance) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      // Root/body overflow may propagate to the viewport. Their moving border
      // rectangles are not clipping edges after root scrolling; checked above.
      if (parent === document.body || parent === document.documentElement) continue;
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)
          && (r.top < bounds.top - tolerance || r.bottom > bounds.bottom + tolerance)) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)
          && (r.left < bounds.left - tolerance || r.right > bounds.right + tolerance)) return false;
    }
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return hit === element || element.contains(hit);
  }
  return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    bodyScrollHeight: document.body.scrollHeight,
    container: rect(document.getElementById('container')), bubble: rect(document.getElementById('bubble')),
    copyScrollHeight: document.getElementById('bubbleCopy').scrollHeight,
    copyClientHeight: document.getElementById('bubbleCopy').clientHeight,
    copy: rect(document.getElementById('bubbleCopy')), actions: rect(document.getElementById('nudgeActions')),
    footer: rect(document.querySelector('.nudge-footer')), language: document.documentElement.lang,
    status: document.getElementById('nudgeStatus').textContent,
    active: controls.indexOf(document.activeElement),
    activeElement: elementInfo(document.activeElement), documentHasFocus: document.hasFocus(),
    scrollRegions: ['bubble', 'bubbleCopy', 'nudgeStatus'].map(id => elementInfo(document.getElementById(id))),
    controls: controls.map(element => ({ text: element.textContent, rect: rect(element), visible: visible(element), disabled: element.disabled })) };
}
async function read() { return current.webContents.executeJavaScript(`(${measure.toString()})()`); }
function scenarios() {
  const all = [];
  for (const level of [2, 3]) for (const locale of ['zh-CN', 'en']) for (const zoom of [1, 1.25, 1.5, 2]) {
    all.push({ level, locale, zoom, long: true, error: true, small: false, corner: 'br' });
  }
  for (const level of [2, 3]) all.push({ level, locale: 'zh-CN', zoom: 1, long: false, error: false, small: false, corner: 'br' });
  for (const level of [2, 3]) for (const locale of ['zh-CN', 'en']) for (const zoom of [1, 2]) {
    all.push({ level, locale, zoom, long: true, error: true, small: true, corner: 'br' });
  }
  for (const corner of ['bl', 'tr', 'tl']) all.push({ level: 3, locale: 'en', zoom: 1, long: true, error: true, small: false, corner });
  return all;
}
async function verifyCase(fixture, index) {
  const workArea = fixture.small ? { x: 0, y: 0, width: 320, height: 240 } : { x: 0, y: 0, width: 1280, height: 800 };
  const layout = cornerLayout({ workArea, level: fixture.level });
  preferences = { revision: ++revision, locale: fixture.locale, resolvedLocale: fixture.locale,
    theme: fixture.locale === 'en' ? 'dark' : 'light' };
  current = new BrowserWindow({ width: layout.width, height: layout.height, show: false, frame: false,
    useContentSize: true, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(root, 'src/preload-nudge.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  current.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try { allowed = ['file:', 'data:', 'blob:'].includes(new URL(details.url).protocol); } catch (_) {}
    callback({ cancel: !allowed });
  });
  current.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  current.webContents.session.setPermissionCheckHandler(() => false);
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', event => event.preventDefault());
  current.webContents.on('will-attach-webview', event => event.preventDefault());
  await current.loadFile(path.join(root, 'src/renderer/nudge-corner.html'));
  current.webContents.setZoomFactor(fixture.zoom);
  const line = fixture.locale === 'en' ? 'Stand up and stretch. A longer reminder with enough room for every action.' : '起身活动。长提醒的正文可以滚动，操作始终可达。';
  current.webContents.send('nudge:init', { level: fixture.level, corner: fixture.corner, character: 'robot',
    message: fixture.long ? Array.from({ length: 12 }, () => line).join('\n') : '起身活动',
    motionMode: 'reduced', stimulationMode: 'balanced', keyboardShortcut: 'Ctrl+Shift+N',
    actions: [{ id: 'complete-routine', label: '已完成', primary: true },
      { id: 'defer-15', label: '稍后（+15 分钟）' }, { id: 'skip-routine-today', label: '跳过本次' }] });
  current.show(); current.focus();
  await painted();
  const beforeCopy = dismissals;
  await current.webContents.executeJavaScript('document.getElementById("bubbleCopy").click()');
  await wait(30);
  assert.equal(dismissals, beforeCopy, 'copy clicks must not dismiss');
  if (fixture.error) {
    await current.webContents.executeJavaScript('document.querySelector(".nudge-action").click()');
    await wait(40); await painted();
  }
  const initial = await read();
  const item = { fixture, layout: { width: layout.width, height: layout.height }, initial, focused: [], keyboard: [], keyboardElements: [] };
  report.cases.push(item);
  assert.equal(initial.language, fixture.locale);
  assert.equal(initial.controls.length, 4);
  assert.ok(initial.horizontalOverflow <= 1, 'no horizontal clipping');
  assert.ok(initial.copy.height >= 20, 'at least one line of reminder copy stays readable');
  if (fixture.long) assert.ok(initial.copyScrollHeight > initial.copyClientHeight, 'long copy has its own scroll range');
  if (!fixture.small && fixture.zoom === 1) assert.ok(initial.controls.every(control => control.visible), 'ordinary-size actions fit without scrolling');
  if (fixture.error) assert.ok(initial.status, 'failure feedback remains available');
  for (let control = 0; control < 4; control++) {
    await current.webContents.executeJavaScript(`document.querySelectorAll('.nudge-action, #closeBtn')[${control}].focus()`);
    await painted();
    const view = await read(); item.focused.push(view);
    assert.ok(view.controls[control].visible, `control ${control} is reachable at this size and zoom`);
  }
  const beforeKeyboard = dismissals;
  const sequence = [0, 1, 2, ...(fixture.error ? ['nudgeStatus'] : []), 3, 'bubbleCopy'];
  for (const reverse of [false, true]) {
    current.webContents.send('nudge:focus-controls'); await painted();
    for (let press = 0; press <= sequence.length; press++) {
      const view = await read();
      const actual = view.active >= 0 ? view.active : view.activeElement?.id;
      item.keyboard.push(actual);
      item.keyboardElements.push({ reverse, activeElement: view.activeElement, documentHasFocus: view.documentHasFocus,
        scrollRegions: view.scrollRegions });
      const expected = sequence[(reverse ? sequence.length - press % sequence.length : press) % sequence.length];
      assert.equal(actual, expected, 'keyboard reading/action order and wrap');
      assert.ok(view.activeElement.visible, 'every keyboard destination is fully visible');
      current.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: reverse ? ['shift'] : [] });
      current.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: reverse ? ['shift'] : [] });
      await wait(30); await painted();
    }
  }
  item.reading = [];
  for (const id of ['bubbleCopy', ...(fixture.error ? ['nudgeStatus'] : [])]) {
    await current.webContents.executeJavaScript(`{ const region = document.getElementById('${id}'); region.focus(); region.scrollTop = 0; }`);
    await painted();
    const before = (await read()).activeElement;
    assert.equal(before.id, id);
    assert.ok(before.visible && before.clientHeight >= 18, 'reading region has a visible line');
    if (before.scrollHeight > before.clientHeight) {
      for (const keyCode of ['PageDown', 'PageUp']) {
        current.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        current.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        await wait(250); await painted();
        const after = (await read()).activeElement;
        item.reading.push({ id, keyCode, before, after });
        assert.equal(after.id, id, 'reading retains focus');
        if (keyCode === 'PageDown') {
          assert.ok(after.scrollTop > before.scrollTop, 'PageDown reveals hidden reading content');
          item.reading.at(-1).downScrollTop = after.scrollTop;
        } else {
          assert.ok(after.scrollTop < item.reading.at(-2).after.scrollTop, 'PageUp returns toward reading start');
        }
      }
    } else item.reading.push({ id, before, fitsWithoutScroll: true });
  }
  assert.equal(dismissals, beforeKeyboard, 'keyboard reading and navigation never dismiss');
  const horizontal = (await read()).scrollRegions;
  assert.ok(horizontal.every(region => region.scrollWidth <= region.clientWidth + 1), 'no inner horizontal scrolling');
  await current.webContents.executeJavaScript('document.scrollingElement.scrollTop = 0; document.body.scrollTop = 0');
  await painted();
  const screenshot = `${String(index).padStart(2, '0')}-L${fixture.level}-${fixture.locale}-${fixture.zoom}-${fixture.small ? 'small' : 'regular'}-${fixture.corner}.png`;
  fs.writeFileSync(path.join(output, screenshot), (await current.webContents.capturePage()).toPNG());
  item.screenshot = screenshot; item.passed = true;
  current.destroy(); current = null;
}

app.whenReady().then(async () => {
  for (const [index, fixture] of scenarios().entries()) {
    const before = report.cases.length;
    try { await verifyCase(fixture, index); }
    catch (error) {
      const item = report.cases[before] || { fixture };
      if (report.cases.length === before) report.cases.push(item);
      item.passed = false; item.error = error.stack || String(error);
      if (current && !current.isDestroyed()) {
        try {
          item.errorScreenshot = `failure-${String(index).padStart(2, '0')}.png`;
          fs.writeFileSync(path.join(output, item.errorScreenshot), (await current.webContents.capturePage()).toPNG());
        } catch (_) { delete item.errorScreenshot; }
        current.destroy(); current = null;
      }
    }
  }
  report.failedCount = report.cases.filter(item => !item.passed).length;
  report.passed = report.failedCount === 0;
  if (!report.passed) report.error = `${report.failedCount} of ${report.cases.length} layout scenarios failed`;
  finish(report.passed ? 0 : 1);
}).catch(async error => {
  report.passed = false; report.error = error.stack || String(error);
  if (current && !current.isDestroyed()) {
    try {
      fs.writeFileSync(path.join(output, 'failure.png'), (await current.webContents.capturePage()).toPNG());
      report.errorScreenshot = 'failure.png';
    } catch (_) {}
    current.destroy();
  }
  finish(1);
});
