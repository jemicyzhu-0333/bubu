'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dom } = require('../test-support/manual-growth-dom');
const { createDesktopUpdateFeature } = require('../src/surfaces/popover/features/desktop-updates.mjs');
const { createAiConfiguration } = require('../src/surfaces/popover/features/ai-configuration.mjs');
const { createPopoverShortcutSetting } = require('../src/surfaces/popover/features/shortcut-setting.mjs');
const { createPopoverSettingsDrawer } = require('../src/surfaces/popover/features/settings-drawer.mjs');
const { createAuthorizationSettingsDom } = require('./fixtures/authorization-settings-dom');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function updates(extra = {}) {
  const h = dom(), state = { settings: { autoCheckUpdates: true } };
  let current = { phase: 'available', currentVersion: '1.0', version: '1.1', percent: 0 };
  const timers = new Map(); let timerId = 0;
  const surfaceClient = { getUpdateStatus: async () => current, updateSettings: async () => ({ ok: true }), ...extra };
  const feature = createDesktopUpdateFeature({ ...h, getState: () => state, surfaceClient,
    setTimer: callback => { timers.set(++timerId, callback); return timerId; }, clearTimer: id => timers.delete(id) });
  feature.mount();
  return { ...h, feature, state, surfaceClient, timers, setCurrent(next) { current = { ...current, ...next }; } };
}
test('updater disables duplicate actions immediately and retains cancellation during download', async context => {
  const pending = deferred(), cancel = deferred(); let downloads = 0, cancels = 0;
  const h = updates({ downloadUpdate: () => { downloads++; return pending.promise; }, cancelUpdate: () => { cancels++; return cancel.promise; } });
  context.after(() => h.feature.dispose()); await settle();
  h.$('#appUpdateDownload').emit('click'); h.$('#appUpdateDownload').emit('click');
  assert.equal(downloads, 1); assert.equal(h.$('#appUpdateDownload').disabled, true);
  h.setCurrent({ phase: 'downloading', percent: 12 }); await h.feature.refresh();
  assert.equal(h.$('#appUpdateCancel').hidden, false); assert.equal(h.$('#appUpdateCancel').disabled, false);
  h.$('#appUpdateCancel').emit('click'); h.$('#appUpdateCancel').emit('click');
  assert.equal(cancels, 1); assert.equal(h.$('#appUpdateCancel').disabled, true);
  h.setCurrent({ phase: 'available' }); cancel.resolve({ ok: true }); pending.resolve({ ok: false, reason: 'cancelled' }); await settle();
  assert.equal(h.$('#appUpdateDownload').disabled, false);
});
test('an old failed update read cannot overwrite a newer status or timer', async context => {
  const first = deferred(), second = deferred(); let reads = 0;
  const h = updates({ getUpdateStatus: () => ++reads === 1 ? first.promise : second.promise });
  context.after(() => h.feature.dispose()); h.$('#appUpdateGroup').open = true;
  const refresh = h.feature.refresh(); second.resolve({ phase: 'current', currentVersion: '1.0' }); await refresh;
  assert.equal(h.timers.size, 1); first.reject(new Error('old')); await settle();
  assert.equal(h.$('#appUpdateStatus').textContent, '已是最新版本'); assert.equal(h.timers.size, 1);
});
test('update setting is single-flight, preserves requested value during polling and restores on failure', async context => {
  const pending = deferred(); let saves = 0;
  const h = updates({ updateSettings: () => { saves++; return pending.promise; } }); context.after(() => h.feature.dispose()); await settle();
  h.$('#appUpdateAuto').checked = false; h.$('#appUpdateAuto').emit('change');
  assert.equal(h.$('#appUpdateAuto').disabled, true);
  await h.feature.refresh(); assert.equal(h.$('#appUpdateAuto').checked, false);
  h.$('#appUpdateAuto').checked = true; h.$('#appUpdateAuto').emit('change');
  assert.equal(saves, 1); assert.equal(h.$('#appUpdateAuto').checked, false);
  pending.reject(new Error('disk')); await settle(); await h.feature.refresh();
  assert.equal(h.$('#appUpdateAuto').checked, true); assert.equal(h.$('#appUpdateAuto').disabled, false);
  assert.equal(h.$('#appUpdateStatus').textContent, '设置未保存，请重试');
});
test('successful update preference receipt survives a lagging projection', async context => {
  const h = updates(); context.after(() => h.feature.dispose()); await settle();
  h.$('#appUpdateAuto').checked = false; h.$('#appUpdateAuto').emit('change'); await settle(); await h.feature.refresh();
  assert.equal(h.$('#appUpdateAuto').checked, false);
  h.state.settings.autoCheckUpdates = false; await h.feature.refresh();
  h.state.settings.autoCheckUpdates = true; await h.feature.refresh(); assert.equal(h.$('#appUpdateAuto').checked, true);
});
test('update confirmation does not survive collapse or dismissal and late commands cannot cross remount', async context => {
  const pending = deferred(); let checks = 0, installs = 0;
  const h = updates({ checkForUpdates: () => { checks++; return pending.promise; }, installUpdate: async () => { installs++; return { ok: true }; } });
  context.after(() => h.feature.dispose()); await settle();
  await h.$('#appUpdateCheck').emit('click'); h.feature.dispose(); h.feature.mount();
  h.setCurrent({ phase: 'downloaded' }); await h.feature.refresh();
  h.$('#appUpdateInstall').emit('click'); assert.equal(h.$('#appUpdateConfirm').hidden, false);
  h.$('#appUpdateGroup').open = false; await h.$('#appUpdateGroup').emit('toggle');
  assert.equal(h.$('#appUpdateConfirm').hidden, true);
  await h.$('#appUpdateConfirmYes').emit('click'); assert.equal(installs, 0);
  h.$('#appUpdateInstall').emit('click'); h.feature.dismiss(); assert.equal(h.$('#appUpdateConfirm').hidden, true);
  pending.resolve({ ok: false, reason: 'check-failed', state: { phase: 'error', currentVersion: 'old' } }); await settle();
  assert.equal(checks, 1); assert.equal(h.$('#appUpdateVersion').textContent, '当前版本 1.0');
});
test('updater command transport errors remain readable after polling and permit retry', async context => {
  let count = 0;
  const h = updates({ checkForUpdates: async () => { count++; throw new Error('private'); } });
  context.after(() => h.feature.dispose()); await settle();
  h.$('#appUpdateCheck').emit('click'); await settle(); await h.feature.refresh();
  assert.equal(h.$('#appUpdateStatus').textContent, '暂时无法完成，请稍后重试');
  assert.equal(h.$('#appUpdateCheck').disabled, false);
  h.$('#appUpdateCheck').emit('click'); await settle(); assert.equal(count, 2);
});
function ai(extra = {}) {
  const h = createAuthorizationSettingsDom(); let saves = 0;
  const state = { settings: { aiModel: 'synthetic-model', aiBaseUrl: '' }, ai: { credential: { configured: false } } };
  const feature = createAiConfiguration({ ...h, getState: () => state, surfaceClient: {
    updateSettings: async () => { saves++; return { ok: true }; }, ...extra } });
  feature.mount(); feature.render(); return { ...h, feature, saves: () => saves };
}
test('AI configuration starts without a saved banner and ignores IME confirmation Enter', async context => {
  const h = ai(); context.after(() => h.feature.dispose());
  assert.equal(h.$('#aiConfigStatus').textContent, '');
  h.fire('#aiModelInput', 'keydown', { key: 'Enter', isComposing: true });
  h.fire('#aiModelInput', 'keydown', { key: 'Enter', keyCode: 229 }); await settle(); assert.equal(h.saves(), 0);
  h.fire('#aiModelInput', 'keydown', { key: 'Enter' }); await settle(); assert.equal(h.saves(), 1);
});
test('credential management controls visibly disable for the full save and recover after failure', async context => {
  const pending = deferred(), h = ai({ updateSettings: () => pending.promise }); context.after(() => h.feature.dispose());
  const saving = h.feature.save();
  assert.equal(h.$('#aiImportCredential').disabled, true); assert.equal(h.$('#aiClearCredential').disabled, true);
  pending.reject(new Error('failure')); await saving;
  assert.equal(h.$('#aiImportCredential').disabled, false); assert.equal(h.$('#aiClearCredential').disabled, false);
});
function shortcut(extra = {}) {
  const h = dom(); const state = { settings: { quickPanelEnabled: true, quickPanelShortcut: 'Alt+Space' } };
  const feature = createPopoverShortcutSetting({ ...h, getState: () => state, surfaceClient: {
    describeQuickPanelShortcut: async () => ({ enabled: true, registered: true, configuredLabel: 'Alt+Space', label: 'Alt+Space' }),
    updateSettings: async () => ({ ok: true }), ...extra } }); feature.mount(); return { ...h, feature };
}
test('shortcut Escape stops recording without escaping to the enclosing drawer', async context => {
  const h = shortcut(); context.after(() => h.feature.dispose()); await settle();
  await h.$('#quickPanelRecorder').emit('click'); let stopped = false;
  await h.$('#quickPanelRecorder').emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(h.$('#quickPanelRecorder').attributes['aria-pressed'], 'false');
});
test('shortcut save failure is visible, single-flight and retryable', async context => {
  const pending = deferred(); let saves = 0;
  const h = shortcut({ updateSettings: () => { saves++; return pending.promise; } }); context.after(() => h.feature.dispose()); await settle();
  await h.$('[data-toggle="quickPanelEnabled"]').emit('click');
  await h.$('[data-toggle="quickPanelEnabled"]').emit('click');
  assert.equal(saves, 1); assert.equal(h.$('#quickPanelRecorder').disabled, true);
  pending.reject(new Error('private failure')); await settle();
  assert.equal(h.$('#quickPanelEffective').textContent, '未保存，请重试');
  assert.equal(h.$('#quickPanelRecorder').disabled, false);
});
function calibration(client, extra = {}) {
  const h = createAuthorizationSettingsDom();
  const feature = createPopoverSettingsDrawer({ ...h, getState: () => ({ settings: {} }), surfaceClient: client,
    sessionDuration: {}, syncPressedButtons() {}, fallbackReasonText: () => '', motionReduced: () => false,
    clearDecorativeMotion() {}, renderExpiryPreview() {}, activeLandingPrompt: () => null,
    rememberLandingReturnFocus() {}, renderLanding() {}, ...extra });
  feature.mount(); return { ...h, feature };
}
test('calibration reset blocks repeat submits, handles rejection, and needs a new confirmation for retry', async context => {
  const pending = deferred(); let resets = 0;
  const h = calibration({ resetEnergyCalibration: () => { resets++; return pending.promise; } }); context.after(() => h.feature.dispose());
  h.fire('#btnResetEnergyCalibration', 'click'); h.fire('#btnResetEnergyCalibration', 'click'); h.fire('#btnResetEnergyCalibration', 'click');
  assert.equal(resets, 1); assert.equal(h.$('#btnResetEnergyCalibration').disabled, true);
  pending.reject(new Error('private')); await settle();
  assert.equal(h.$('#energyCalibrationFeedback').textContent, '没能重置，稍后再试。');
  assert.equal(h.$('#btnResetEnergyCalibration').disabled, false);
  h.fire('#btnResetEnergyCalibration', 'click'); assert.equal(resets, 1);
});
test('collapse and remount suppress late calibration reset feedback', async context => {
  const pending = deferred();
  const h = calibration({ resetEnergyCalibration: () => pending.promise }); context.after(() => h.feature.dispose());
  h.fire('#btnResetEnergyCalibration', 'click'); h.fire('#btnResetEnergyCalibration', 'click');
  h.fire('#settingGroupPlanning', 'toggle'); pending.resolve({ ok: true, changed: true }); await settle();
  assert.equal(h.$('#energyCalibrationFeedback').textContent, '');
  const next = deferred(); const other = calibration({ resetEnergyCalibration: () => next.promise }); context.after(() => other.feature.dispose());
  other.fire('#btnResetEnergyCalibration', 'click'); other.fire('#btnResetEnergyCalibration', 'click');
  other.feature.dispose(); other.feature.mount(); other.$('#energyCalibrationFeedback').textContent = 'new visit';
  next.resolve({ ok: true, changed: true }); await settle();
  assert.equal(other.$('#energyCalibrationFeedback').textContent, 'new visit');
});

test('stepper boundaries use the same bounded values for availability and commands', () => {
  const { settingsStepperPatch } = require('../src/surfaces/popover/features/settings-stepper.mjs');
  const duration = { clampFocusMinutes: value => Math.max(5, Math.min(120, value)) };
  for (const [key, field, min, max, delta] of [['pomodoro','pomodoroMinutes',5,120,5],['break','breakMinutes',1,30,1],
    ['softReminder','softReminderEvery',5,60,5],['hydration','hydrationEvery',15,180,15],
    ['focusMaxLevel','focusMaxLevel',1,4,1],['restMaxLevel','restMaxLevel',1,4,1]]) {
    assert.deepEqual(settingsStepperPatch(key,-delta,{[field]:min},duration),{[field]:min});
    assert.deepEqual(settingsStepperPatch(key,delta,{[field]:max},duration),{[field]:max});
  }
  assert.deepEqual(settingsStepperPatch('workStart',1,{workStartHour:9,workEndHour:10},duration),{workStartHour:9});
  assert.deepEqual(settingsStepperPatch('workEnd',-1,{workStartHour:9,workEndHour:10},duration),{workEndHour:10});
});
test('drawer animation-frame focus callbacks never focus a closed or superseded drawer', context => {
  const queued = [], previous = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => queued.push(callback);
  context.after(() => { if (previous) global.requestAnimationFrame = previous; else delete global.requestAnimationFrame; });
  const h = calibration({}); context.after(() => h.feature.dispose()); let behind = 0, close = 0;
  h.$('#btnSettings').focus = () => behind++; h.$('#btnSettingsClose').focus = () => close++;
  h.feature.open(); h.feature.close(); h.feature.open(); while (queued.length) queued.shift()();
  assert.equal(behind,0); assert.equal(close,2);
  h.feature.close(); h.feature.dispose(); while (queued.length) queued.shift()(); assert.equal(behind,0);
});
const { createActivityMirrorSettings } = require('../src/surfaces/popover/features/activity-mirror-settings.mjs');
function activity(extra = {}) {
  const h = dom(); const state = { settings: { activityMirrorEnabled: false }, activityMirror: { enabled:false,activity:'none',receiver:'ready',tools:[] } };
  const feature = createActivityMirrorSettings({ ...h, getState:()=>state, escapeHTML:value=>value,
    surfaceClient:{ updateSettings:async()=>({ok:true}),copyAgentPluginCommand:async()=>({ok:true}),...extra } });
  feature.mount({subscribe(){return()=>{}}}); return {...h,feature};
}
test('activity mirror exposes rejected save and copy failures without unhandled errors or duplicate writes',async context=>{
  const pending=deferred();let saves=0;
  const h=activity({updateSettings:()=>{saves++;return pending.promise;},copyAgentPluginCommand:async()=>({ok:false})});context.after(()=>h.feature.dispose());
  h.$('#activityMirrorToggle').emit('click');h.$('#activityMirrorToggle').emit('click');
  assert.equal(saves,1);assert.equal(h.$('#activityMirrorToggle').disabled,true);
  pending.resolve({ok:false});await settle();
  assert.equal(h.$('#activityMirrorStatus').textContent,'设置没有保存，请重试。');assert.equal(h.$('#activityMirrorToggle').disabled,false);
  h.feature.render({activityMirror:{enabled:true,activity:'none',receiver:'listening',tools:[{id:'synthetic',label:'Synthetic',steps:[],command:'fixture'}]}});
  const button=h.$('#activityHookCopy');
  h.$('#activityHookList').emit('click',{target:{closest:()=>button}});await settle();
  assert.equal(h.$('#activityHookState').textContent,'操作失败，请重试');assert.equal(button.disabled,false);
});
test('activity mirror lost receipt across remount stays guarded until a fresh projection verifies it',async context=>{
  const pending=deferred();const h=activity({updateSettings:()=>pending.promise});context.after(()=>h.feature.dispose());
  await h.$('#activityMirrorToggle').emit('click');h.feature.dispose();h.feature.mount({subscribe(){return()=>{}}});
  pending.reject(new Error('old'));await settle();assert.equal(h.$('#activityMirrorStatus').textContent,'设置结果暂未确认，重新打开后可核对。');assert.equal(h.$('#activityMirrorStatus').hidden,false);assert.equal(h.$('#activityMirrorToggle').disabled,true);
});
test('Escape dismisses only the update restart confirmation and returns focus to its trigger',async context=>{
  const h=updates();context.after(()=>h.feature.dispose());await settle();h.setCurrent({phase:'downloaded'});await h.feature.refresh();
  await h.$('#appUpdateInstall').emit('click');let stopped=false;
  await h.$('#appUpdateConfirm').emit('keydown',{key:'Escape',preventDefault(){},stopPropagation(){stopped=true;}});
  assert.equal(stopped,true);assert.equal(h.$('#appUpdateConfirm').hidden,true);assert.equal(h.$('#appUpdateInstall').focusCount,1);
});
test('a failed first update status read leaves a usable explicit retry',async context=>{
  let reads=0;
  const h=updates({getUpdateStatus:async()=>{if(++reads===1)throw Error('unavailable');return {phase:'current',currentVersion:'1.0'};},checkForUpdates:async()=>({ok:true})});
  context.after(()=>h.feature.dispose());await settle();assert.equal(h.$('#appUpdateStatus').textContent,'暂时无法读取更新状态');
  assert.equal(h.$('#appUpdateCheck').disabled,false);await h.$('#appUpdateCheck').emit('click');await settle();
  assert.equal(h.$('#appUpdateStatus').textContent,'已是最新版本');
});
test('a later independent setting save cannot hide an older failed setting or its retry',async context=>{
  const first=deferred(),second=deferred();let calls=0;
  const h=calibration({updateSettings:()=>++calls===1?first.promise:second.promise});context.after(()=>h.feature.dispose());
  h.fire('[data-toggle="aiMemoryEnabled"]','click');h.fire('[data-toggle="soundEnabled"]','click');
  second.resolve({ok:true});await settle();assert.equal(h.$('#settingsSaveStatus').textContent,'正在保存…');
  first.reject(Error('first'));await settle();assert.equal(h.$('#settingsSaveStatus').textContent,'未保存，请重试');
  h.fire('[data-toggle="aiMemoryEnabled"]','click');await settle();assert.equal(h.$('#settingsSaveStatus').textContent,'');
});
test('missing settings and credential receipts never present an invented successful save',async context=>{
  const h=ai({updateSettings:async()=>undefined,importAiCredential:async()=>undefined});context.after(()=>h.feature.dispose());
  await h.feature.save();assert.equal(h.$('#aiConfigStatus').dataset.state,'error');
  h.fire('#aiImportCredential','click');await settle();assert.match(h.$('#aiConfigStatus').textContent,/未导入/);
  const drawer=calibration({updateSettings:async()=>undefined});context.after(()=>drawer.feature.dispose());
  drawer.fire('[data-toggle="aiMemoryEnabled"]','click');await settle();assert.equal(drawer.$('#settingsSaveStatus').textContent,'未保存，请重试');
  const keys=shortcut({updateSettings:async()=>undefined});context.after(()=>keys.feature.dispose());await settle();
  keys.$('[data-toggle="quickPanelEnabled"]').emit('click');await settle();assert.equal(keys.$('#quickPanelEffective').textContent,'未保存，请重试');
});
test('recorded shortcut saves only the owner chord then refreshes the effective fallback without rewriting configuration', async context => {
  const events = [];
  let configured = 'Alt+Space';
  const h = shortcut({
    updateSettings: async patch => { events.push(['save', patch]); configured = patch.quickPanelShortcut; return { ok: true }; },
    describeQuickPanelShortcut: async () => {
      events.push(['describe']);
      return { enabled: true, registered: true, usedFallback: true, configuredLabel: configured, label: 'Control+Space' };
    }
  });
  context.after(() => h.feature.dispose()); await settle(); events.length = 0;
  await h.$('#quickPanelRecorder').emit('click');
  await h.$('#quickPanelRecorder').emit('keydown', { key: ' ', code: 'Space', altKey: true, shiftKey: true, preventDefault() {} });
  await settle();
  assert.deepEqual(events, [['save', { quickPanelShortcut: 'Alt+Shift+Space' }], ['describe']]);
  assert.equal(h.$('#quickPanelRecorder').textContent, 'Alt+Shift+Space');
  assert.match(h.$('#quickPanelEffective').textContent, /现在生效：Control\+Space.*你设的 Alt\+Shift\+Space/);
  assert.match(h.$('#btnQuickCapture').title, /Control\+Space/);
  await h.feature.refresh();
  assert.equal(events.filter(([event]) => event === 'save').length, 1);
});
test('a normally closed settings drawer restores the trigger after its frame', context => {
  const queued = [], previous = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => queued.push(callback);
  context.after(() => { if (previous) global.requestAnimationFrame = previous; else delete global.requestAnimationFrame; });
  const h = calibration({}); context.after(() => h.feature.dispose()); let returned = 0;
  h.$('#btnSettings').focus = () => returned++;
  h.$('#btnSettingsClose').focus = () => {};
  h.feature.open(); while (queued.length) queued.shift()();
  assert.equal(h.$('#appShell').inert, true);
  h.feature.close(); assert.equal(returned, 0); assert.equal(h.$('#appShell').inert, false);
  while (queued.length) queued.shift()(); assert.equal(returned, 1);
});
test('matching effective shortcut is quiet while recorder and capture retain accessible chord labels', async context => {
  const h = shortcut(); context.after(() => h.feature.dispose()); await settle();
  assert.equal(h.$('#quickPanelRecorder').textContent, 'Alt+Space');
  assert.equal(h.$('#quickPanelEffective').textContent, '');
  assert.equal(h.$('#btnQuickCapture').title, '快捷行动 Alt+Space');
  assert.equal(h.$('#btnQuickCapture').attributes['aria-label'], '打开快捷行动面板，快捷键 Alt+Space');
  await h.$('#quickPanelRecorder').emit('click');
  assert.match(h.$('#quickPanelEffective').textContent, /Esc 取消/);
  await h.$('#quickPanelRecorder').emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(h.$('#quickPanelEffective').textContent, '');
});
test('nonmatching, disabled and unavailable shortcuts retain meaningful effective status', async context => {
  const descriptions = [
    [{ enabled: true, registered: true, usedFallback: true, configuredLabel: 'Alt+Space', label: 'Control+Space' }, /现在生效：Control\+Space.*你设的 Alt\+Space/],
    [{ enabled: true, registered: true, usedFallback: false, configuredLabel: 'Alt+Space', label: 'Control+Space' }, /现在生效：Control\+Space/],
    [{ enabled: false, registered: false, configuredLabel: 'Alt+Space', label: '' }, /已关闭.*快速记录/],
    [{ enabled: true, registered: false, configuredLabel: 'Alt+Space', label: '' }, /组合键都被占用了/]
  ];
  for (const [description, expected] of descriptions) {
    const h = shortcut({ describeQuickPanelShortcut: async () => description });
    context.after(() => h.feature.dispose()); await settle();
    assert.match(h.$('#quickPanelEffective').textContent, expected);
  }
});

test('actual settings drawer reopen retries mirror verification without replaying the unresolved write', async context => {
  const previousFrame = global.requestAnimationFrame; global.requestAnimationFrame = () => {};
  context.after(() => { global.requestAnimationFrame = previousFrame; });
  let writes = 0, reads = 0, verify = false;
  const h = calibration({}, { onOpen: () => mirror.onSettingsOpen() });
  const state = { revision: 2, settings: { activityMirrorEnabled: false }, activityMirror: { enabled: false, activity: 'none', receiver: 'off', tools: [] } };
  const m = dom();
  const mirror = createActivityMirrorSettings({ ...m, getState: () => state, escapeHTML: value => value,
    surfaceClient: { updateSettings: async () => { writes++; throw Error('lost receipt'); } } });
  mirror.mount({ subscribe() { return () => {}; }, async refresh() { reads++; if (!verify) throw Error('read unavailable'); return state; } });
  context.after(() => { mirror.dispose(); h.feature.dispose(); });
  h.feature.open(); m.$('#activityMirrorToggle').emit('click'); await settle();
  assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(m.$('#activityMirrorToggle').disabled, true);
  verify = true; h.feature.close(); h.feature.open(); await settle();
  assert.equal(reads, 2); assert.equal(writes, 1); assert.equal(m.$('#activityMirrorToggle').disabled, false);
});
