'use strict';

const assert = require('node:assert/strict');
const { readDisposableProfile } = require('./profile-fixture');

async function verifyManualGrowth({ readState, completeStep, completeTask }, before) {
  const task = before.tasks.find(item => item.id === before.nowTaskId);
  assert.ok(task?.steps[0], 'the growth scenario needs an explicit manual step');
  const result = await completeStep(task.id, task.steps[0].id);
  assert.equal(result.ok, true);
  assert.equal(result.awarded, 30);
  assert.equal(result.advanceGranted, true);
  const afterStep = await readState();
  assert.equal(afterStep.level, before.level + 1);
  assert.equal(afterStep.xp, 0);
  assert.equal(afterStep.tasks.find(item => item.id === task.id).steps[0].done, true);
  assert.equal(afterStep.foodTickets, before.foodTickets + 3);
  assert.deepEqual(afterStep.feedState.foodInventory, before.feedState.foodInventory);
  assert.equal((await completeStep(task.id, task.steps[0].id)).ok, false);
  const afterRetry = await readState();
  for (const key of ['level', 'xp', 'foodTickets', 'tasks']) assert.deepEqual(afterRetry[key], afterStep[key]);
  assert.deepEqual(afterRetry.feedState.foodInventory, before.feedState.foodInventory);

  assert.equal((await completeTask(task.id)).ok, true);
  const afterTask = await readState();
  assert.equal(afterTask.tasks.find(item => item.id === task.id).done, true);
  for (const key of ['level', 'xp', 'foodTickets']) assert.equal(afterTask[key], afterStep[key]);
  assert.deepEqual(afterTask.feedState.foodInventory, before.feedState.foodInventory);
  assert.equal((await completeTask(task.id)).ok, false);
  const afterTaskRetry = await readState();
  for (const key of ['level', 'xp', 'foodTickets', 'tasks']) assert.deepEqual(afterTaskRetry[key], afterTask[key]);
  assert.deepEqual(afterTaskRetry.feedState.foodInventory, before.feedState.foodInventory);
  return { taskId: task.id, level: afterTask.level, xp: afterTask.xp, foodTickets: afterTask.foodTickets,
    foodInventory: afterTask.feedState.foodInventory };
}

function verifyPersistedScenario(profile, persisted, growth, expectedTasks) {
  const { state, revision } = persisted;
  assert.equal(state.schemaVersion, 19);
  assert.ok(revision >= profile.revision);
  assert.deepEqual(state.tasks.map(task => [task.id, task.title]), profile.initial.tasks.map(task => [task.id, task.title]));
  if (expectedTasks) assert.deepEqual(state.tasks, expectedTasks, 'shutdown must retain the last scoped task projection');
  if (profile.scenario === 'form-usagi') {
    assert.equal(state.currentSkin, 'usagi');
    assert.deepEqual(state.unlockedSkins, ['pink'], 'a default form must not add a synthetic unlock');
  }
  if (growth) {
    assert.equal(state.level, growth.level);
    assert.equal(state.xp, growth.xp);
    assert.equal(state.pet.foodTickets, growth.foodTickets);
    assert.deepEqual(state.pet.foodInventory, growth.foodInventory);
    const task = state.tasks.find(item => item.id === growth.taskId);
    assert.equal(task.done, true);
    assert.equal(task.steps[0].done, true);
    assert.equal(state.rewardLedger.events.filter(event => event.source === 'growth-unit' && event.awardedReward > 0).length, 1);
    assert.equal(state.rewardLedger.events.filter(event => event.source === 'growth-first' && event.awardedReward > 0).length, 1);
    assert.equal(state.rewardLedger.events.filter(event => event.source === 'task-complete').at(-1).awardedReward, 0);
    if (profile.scenario === 'flame-near') assert.ok(state.unlockedSkins.includes('flame'));
  }
}

async function inspect({ app, BrowserWindow, profile, errors, soakMs }) {
  const userDataPath = app.getPath('userData');
  assert.equal(userDataPath, profile.userDataPath);
  const windows = BrowserWindow.getAllWindows();
  const pages = await Promise.all(windows.map(async window => ({
    url: window.webContents.getURL(),
    ready: await window.webContents.executeJavaScript('document.readyState')
  })));
  for (const page of ['popover', 'impulse', 'pet']) {
    assert.ok(pages.some(entry => entry.url.endsWith(`/${page}.html`) && entry.ready === 'complete'));
  }
  const popover = windows.find(window => window.webContents.getURL().endsWith('/popover.html'));
  const before = await popover.webContents.executeJavaScript('window.bubu.getState()');
  assert.ok(before.tasks.length > 0);
  assert.equal(before.schemaVersion, 19);
  assert.deepEqual(before.tasks.map(task => task.id), profile.initial.tasks.map(task => task.id));
  const reentries = await popover.webContents.executeJavaScript(`import('./popover.mjs').then(async module => {
    module.popoverSurface.dispose();
    for (let index = 0; index < 3; index += 1) {
      const surface = module.createPopoverSurface({ document, window });
      await surface.ready;
      surface.dispose();
      surface.dispose();
    }
    const active = module.createPopoverSurface({ document, window });
    await active.ready;
    return 3;
  })`);
  assert.equal(reentries, 3);
  if (profile.scenario === 'form-usagi') {
    assert.equal(before.level, 1);
    assert.equal(before.skins.find(skin => skin.id === 'usagi').unlocked, true);
    assert.equal(before.skins.find(skin => skin.id === 'usagi').progress, null);
    assert.equal(await popover.webContents.executeJavaScript("window.bubu.switchSkin('pink')"), true);
    assert.equal(await popover.webContents.executeJavaScript("window.bubu.switchSkin('usagi')"), true);
    const chosen = await popover.webContents.executeJavaScript('window.bubu.getState()');
    assert.equal(chosen.currentSkin, 'usagi');
  }
  let growth = null;
  if (['level-up', 'flame-near'].includes(profile.scenario)) {
    growth = await verifyManualGrowth({
      readState: () => popover.webContents.executeJavaScript('window.bubu.getState()'),
      completeStep: (taskId, stepId) => popover.webContents.executeJavaScript(
        `window.bubu.completeStep(${JSON.stringify(taskId)}, ${JSON.stringify(stepId)})`),
      completeTask: taskId => popover.webContents.executeJavaScript(`window.bubu.completeTask(${JSON.stringify(taskId)})`)
    }, before);
  }
  const pet = windows.find(window => window.webContents.getURL().endsWith('/pet.html'));
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < soakMs) {
    const sample = await pet.webContents.executeJavaScript("import('../surfaces/pet/entry.mjs').then(({ runtime }) => runtime.sample())");
    assert.ok(sample.bodySpriteCacheSize <= sample.bodySpriteCacheCapacity);
    assert.ok(sample.sceneParticleCount <= 240);
    assert.ok(sample.overlayParticleCount <= 160);
    assert.deepEqual(errors, []);
    const metric = app.getAppMetrics().find(entry => entry.pid === pet.webContents.getOSProcessId());
    assert.ok(metric);
    samples.push({ atMs: Date.now() - startedAt, animNow: sample.animNow, workingSetKb: metric.memory.workingSetSize, sceneParticles: sample.sceneParticleCount });
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.deepEqual(errors, []);
  const finalState = await popover.webContents.executeJavaScript('window.bubu.getState()');
  return { userDataPath, tasks: before.tasks.length, pages, reentries, soakMs, samples, errors, growth, expectedTasks: finalState.tasks };
}

function finishSmoke({ app, profile, report, readProfile = readDisposableProfile, log = console.log, finish }) {
  // Main's synchronous will-quit disposer was registered during startup, before
  // this listener. It closes storage before we reopen the disposable authority.
  app.once('will-quit', event => {
    event.preventDefault();
    try {
      const persisted = readProfile(profile);
      verifyPersistedScenario(profile, persisted, report.growth, report.expectedTasks);
      const { expectedTasks, ...summary } = report;
      log(JSON.stringify({ ...summary, persistedRevision: persisted.revision }, null, 2));
      finish(null);
    } catch (error) { finish(error); }
  });
  app.quit();
}

function runSmoke({ app, BrowserWindow } = require('electron')) {
  const errors = [];
  const soakArgument = process.argv.find(argument => argument.startsWith('--soak-ms='));
  const soakMs = soakArgument ? Number(soakArgument.slice('--soak-ms='.length)) : 0;
  if (!Number.isFinite(soakMs) || soakMs < 0 || soakMs > 1800000) throw new Error('soak duration must be between 0 and 1800000ms');
  const capturePhaseMs = process.argv.includes('--capture-phases') ? 30_000 : 0;
  const fail = error => { console.error(error.stack || error); app.exit(1); };
  const deadline = setTimeout(() => fail(new Error('isolated Electron startup timed out')), 20000 + soakMs + capturePhaseMs);
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', details => {
      if (details.level === 'error') errors.push(details.message);
    });
    window.webContents.on('did-fail-load', (_event, code, description) => errors.push(`${code}: ${description}`));
    window.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  });
  try {
    const { profile } = require('./launch');
    app.whenReady().then(() => setTimeout(() => {
      inspect({ app, BrowserWindow, profile, errors, soakMs }).then(report => {
        finishSmoke({ app, profile, report, finish(error) {
          clearTimeout(deadline);
          if (error) fail(error); else app.exit(0);
        } });
      }).catch(error => { clearTimeout(deadline); fail(error); });
    }, 2000)).catch(error => { clearTimeout(deadline); fail(error); });
  } catch (error) { clearTimeout(deadline); fail(error); }
}

if (require.main === module) runSmoke();
module.exports = { verifyManualGrowth, verifyPersistedScenario, finishSmoke, runSmoke };
