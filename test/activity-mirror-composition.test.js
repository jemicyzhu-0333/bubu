'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createActivityMirror } = require('../src/bootstrap/activity-mirror');

function harness({ enabled = true, platform = 'darwin', deferStart = false } = {}) {
  let clock = 1_000_000;
  let idleMs = 1_000;
  const settings = { activityMirrorEnabled: enabled };
  const presented = [], projections = [], dirty = [], clipboard = [], probes = [], servers = [], timers = [], errors = [];
  const mirror = createActivityMirror({
    platform, isPackaged: true, resourcesPath: '/R', appPath: '/A', profile: 'production',
    getSettings: () => settings, readIdleMs: () => idleMs,
    presentMirror: (activity, concurrent) => { presented.push(activity); projections.push(concurrent); },
    publishChange: value => dirty.push(value), writeClipboard: text => clipboard.push(text),
    reportError: (error, channel) => errors.push({ error, channel }),
    now: () => clock, setTimer: callback => { const timer = { callback, cleared: false }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; }, exists: () => true,
    createProbe: ({ command, onSample, onError }) => {
      const probe = { command, onSample, onError, started: 0, stopped: 0,
        start() { this.started += 1; }, stop() { this.stopped += 1; if (this.onStop) this.onStop(); } };
      probes.push(probe);
      return probe;
    },
    createServer: ({ port, onEvent, onError }) => {
      const server = { port, onEvent, onError, stopped: false, stops: 0,
        start() { return deferStart ? new Promise((resolve, reject) => { this.resolveStart = resolve; this.rejectStart = reject; }) : Promise.resolve({ ok: true, port }); },
        stop() { this.stopped = true; this.stops += 1; } };
      servers.push(server);
      return server;
    }
  });
  return { mirror, settings, presented, projections, dirty, clipboard, probes, servers, timers, errors,
    now: () => clock, setIdle: ms => { idleMs = ms; }, advance: ms => { clock += ms; },
    sample: (front, audio = []) => probes.at(-1).onSample({ front, audio }), tick: () => timers.at(-1).callback() };
}

test('the mirror follows the setting: probe and receiver run only while it is on', async () => {
  const h = harness({ enabled: false });
  h.mirror.sync();
  assert.equal(h.probes.length, 0);
  h.settings.activityMirrorEnabled = true;
  h.mirror.sync();
  await Promise.resolve();
  assert.equal(h.probes[0].command.file, path.join('/R', 'activity-probe', 'activity-probe'));
  assert.equal(h.probes[0].started, 1);
  assert.equal(h.servers[0].port, 47614);
  h.settings.activityMirrorEnabled = false;
  h.mirror.sync();
  assert.equal(h.probes[0].stopped, 1);
  assert.equal(h.servers[0].stopped, true);
  assert.equal(h.mirror.projection().activity, 'none');
});

test('samples become one smoothed category for the pet; agent prompts switch at once', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode');
  h.advance(16_000);
  h.sample('com.microsoft.VSCode');
  assert.deepEqual(h.presented, ['coding']);
  assert.equal(h.mirror.projection().activity, 'coding');
  assert.equal(h.servers[0].onEvent({ source: 'claude-code', event: 'prompt' }), true);
  assert.deepEqual(h.presented, ['coding', 'ai']);
  assert.equal(h.servers[0].onEvent({ source: 'Some One', event: 'prompt' }), false);
  h.settings.activityMirrorEnabled = false;
  h.mirror.sync();
  assert.equal(h.presented.at(-1), null, 'turning it off returns the pet to its own state');
  assert.ok(h.dirty.every(value => value.activity === true));
});

test('the panel shows install text for the bundled plugin and when each tool last signalled', async () => {
  const h = harness();
  const projection = h.mirror.projection();
  assert.deepEqual(projection.tools.map(tool => tool.id), ['claude-code', 'codex', 'cursor', 'qoder', 'codebuddy', 'agent']);
  assert.equal(projection.tools[0].command, `claude plugin marketplace add "${path.join('/R', 'integrations')}" && claude plugin install imadhder-companion@imadhder`);
  assert.equal(projection.tools.find(tool => tool.id === 'qoder').command, `qoder plugins install "${path.join('/R', 'integrations', 'plugins', 'imadhder-companion')}"`);
  assert.ok(projection.tools.every(tool => tool.lastSignalAt === null), 'nothing is assumed installed');
  const windows = harness({ platform: 'win32' }).mirror.projection().tools;
  assert.deepEqual(windows.map(tool => tool.id), ['claude-code', 'qoder', 'codebuddy', 'agent'], 'only steps known to work on Windows');
  assert.match(windows[0].command, /; claude plugin install/, 'PowerShell 5.1 has no &&');

  h.mirror.sync();
  await Promise.resolve();
  assert.equal(h.servers[0].onEvent({ source: 'qoder', event: 'stop' }), true);
  assert.equal(h.servers[0].onEvent({ source: 'deepseek-harness', event: 'prompt' }), true, 'any bounded tool name is accepted');
  assert.ok(Number.isFinite(h.mirror.projection().tools.find(tool => tool.id === 'qoder').lastSignalAt));

  const handlers = new Map();
  h.mirror.register((channel, handler) => handlers.set(channel, handler));
  assert.deepEqual(handlers.get('activity:copy-plugin-command')(null, { tool: 'cursor' }), { ok: true });
  assert.equal(h.clipboard[0], `mkdir -p ~/.cursor/plugins/local/imadhder-companion && cp -R "${path.join('/R', 'integrations', 'plugins', 'imadhder-companion')}/." ~/.cursor/plugins/local/imadhder-companion/`);
});

test('a cancelled receiver completion cannot overwrite a newer run', async () => {
  const h = harness({ deferStart: true });
  h.mirror.sync();
  const oldServer = h.servers[0];
  h.settings.activityMirrorEnabled = false;
  h.mirror.sync();
  h.settings.activityMirrorEnabled = true;
  h.mirror.sync();
  const currentServer = h.servers[1];
  currentServer.resolveStart({ ok: true, port: currentServer.port });
  await Promise.resolve();
  assert.equal(h.mirror.projection().receiver, 'listening');
  const changes = h.dirty.length;

  oldServer.resolveStart({ ok: false, reason: 'port-in-use' });
  await Promise.resolve();
  assert.equal(h.mirror.projection().receiver, 'listening');
  assert.equal(h.dirty.length, changes, 'old completion does not publish the current receiver');
  assert.equal(currentServer.stopped, false);
});

test('a cancelled listener that opens late is stopped without completing the newer start', async () => {
  const h = harness({ deferStart: true });
  h.mirror.sync();
  const oldServer = h.servers[0];
  h.mirror.dispose();
  h.mirror.sync();
  const changes = h.dirty.length;
  oldServer.resolveStart({ ok: true, port: oldServer.port });
  await Promise.resolve();
  assert.equal(oldServer.stops, 2, 'close a listener that finished opening after its first stop');
  assert.equal(h.servers[1].stopped, false);
  assert.equal(h.mirror.projection().receiver, 'starting');
  assert.equal(h.dirty.length, changes);
  h.servers[1].resolveStart({ ok: true, port: h.servers[1].port });
  await Promise.resolve();
  assert.equal(h.mirror.projection().receiver, 'listening');
});

test('callbacks retained after stop cannot revive activity or source history', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode');
  h.servers[0].onEvent({ source: 'claude-code', event: 'prompt' });
  h.settings.activityMirrorEnabled = false;
  h.mirror.sync();
  const changes = h.dirty.length;
  const presentations = h.presented.length;

  h.probes[0].onSample({ front: 'com.microsoft.VSCode', audio: [] });
  h.advance(16_000);
  h.probes[0].onSample({ front: 'com.microsoft.VSCode', audio: [] });
  assert.equal(h.servers[0].onEvent({ source: 'qoder', event: 'prompt' }), false);
  assert.equal(h.mirror.onAgentEvent({ source: 'codex', event: 'prompt' }), false);
  h.advance(31_000);
  h.timers[0].callback();
  h.probes[0].onError(new Error('late probe error'));
  h.servers[0].onError(new Error('late receiver error'));
  assert.equal(h.mirror.current(), 'none');
  assert.ok(h.mirror.projection().tools.every(tool => tool.lastSignalAt === null));
  assert.equal(h.dirty.length, changes);
  assert.equal(h.presented.length, presentations);
  assert.equal(h.errors.length, 0);
  assert.equal(h.timers[0].cleared, true);
});

test('old probe, receiver and timer callbacks do not modify the new run', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.mirror.dispose();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode');
  h.advance(16_000);
  const changes = h.dirty.length;
  h.timers[0].callback();
  assert.equal(h.mirror.current(), 'none', 'old timer does not advance the new pending category');
  h.probes[0].onSample({ front: 'com.openai.chat', audio: [] });
  assert.equal(h.servers[0].onEvent({ source: 'qoder', event: 'prompt' }), false);
  assert.equal(h.dirty.length, changes);
  h.timers[1].callback();
  assert.equal(h.mirror.current(), 'coding', 'the new sample and timer still work');
  assert.ok(h.mirror.projection().tools.every(tool => tool.lastSignalAt === null));
  assert.equal(h.servers[1].onEvent({ source: 'codex', event: 'prompt' }), true);
  assert.equal(h.mirror.current(), 'ai');
});

test('disposal invalidates callbacks before stopping the adapters', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode');
  let accepted;
  h.probes[0].onStop = () => { accepted = h.servers[0].onEvent({ source: 'codex', event: 'prompt' }); };
  const changes = h.dirty.length;
  h.mirror.dispose();
  assert.equal(accepted, false);
  assert.equal(h.mirror.current(), 'none');
  assert.deepEqual(h.presented, []);
  assert.equal(h.dirty.length, changes);
  assert.equal(h.mirror.projection().receiver, 'off');
});

test('a rejected stale start is ignored while a current start still reports failure', async () => {
  const h = harness({ deferStart: true });
  h.mirror.sync();
  h.mirror.dispose();
  h.mirror.sync();
  h.servers[0].rejectStart(new Error('cancelled start'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.errors.length, 0);
  const failure = new Error('current start failed');
  h.servers[1].rejectStart(failure);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.errors, [{ error: failure, channel: 'activity:start' }]);
});

test('audio plus front AI share one immutable projection and removing audio leaves AI untouched', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.openai.chat', ['com.spotify.client']);
  h.advance(15_000);
  h.sample('com.openai.chat', ['com.spotify.client']);
  assert.equal(h.mirror.current(), 'ai', 'legacy priority category is unchanged');
  assert.deepEqual(h.projections.at(-1), { v: 1, music: true, coding: false, ai: true });
  assert.ok(Object.isFrozen(h.projections.at(-1)));
  const previous = h.projections.at(-1);
  h.advance(1_000);
  h.sample('com.openai.chat');
  h.advance(30_000);
  h.sample('com.openai.chat');
  assert.deepEqual(h.projections.at(-1), { v: 1, music: false, coding: false, ai: true });
  assert.equal(h.mirror.current(), 'ai');
  assert.equal(previous.music, true, 'older delivered snapshots cannot be mutated by a new sample');
  assert.equal(h.mirror.projection().concurrent, h.projections.at(-1), 'panel and pet consume one projection');
});

test('music can enter under AI without a legacy category change; repeat signals do not replay a presentation', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode');
  h.servers[0].onEvent({ source: 'codex', event: 'prompt' });
  assert.deepEqual(h.projections.at(-1), { v: 1, music: false, coding: false, ai: true });
  h.advance(1_000);
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.advance(15_000);
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  assert.deepEqual(h.projections.at(-1), { v: 1, music: true, coding: true, ai: true });
  const count = h.projections.length;
  h.advance(1_000);
  h.servers[0].onEvent({ source: 'codex', event: 'prompt' });
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  assert.equal(h.projections.length, count, 'unchanged booleans do not cause an immediate presentation');
  assert.equal(h.mirror.projection().tools.find(tool => tool.id === 'codex').lastSignalAt, h.now());
});

test('source-specific stop preserves another agent prompt and its independent deadline', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  const event = (source, type) => h.servers[0].onEvent({ source, event: type });
  event('codex', 'prompt');
  h.advance(1_000);
  event('cursor', 'prompt');
  event('codex', 'stop');
  h.advance(90_001);
  h.tick();
  assert.equal(h.mirror.projection().concurrent.ai, true, 'expired codex reading grace cannot cancel cursor');
  assert.equal(h.mirror.current(), 'ai');
  h.advance(510_000);
  h.tick();
  assert.deepEqual(h.projections.at(-1), { v: 1, music: false, coding: false, ai: false });
  h.advance(30_000);
  h.tick();
  assert.equal(h.mirror.current(), 'none', 'legacy primary keeps its normal release grace');
});

test('stale helper output expires without fresh samples, with main-process idle read on every evaluation', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.advance(15_000);
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.advance(30_001);
  h.tick();
  assert.equal(h.mirror.projection().concurrent.music, true, 'brief missing samples release smoothly');
  h.advance(30_000);
  h.tick();
  assert.deepEqual(h.mirror.projection().concurrent, { v: 1, music: false, coding: false, ai: false });
  h.servers[0].onEvent({ source: 'codex', event: 'prompt' });
  assert.equal(h.mirror.projection().concurrent.ai, true, 'independent hooks still work without probe output');
  h.setIdle(120_000);
  h.tick();
  assert.equal(h.mirror.projection().concurrent.ai, false, 'an old active-keyboard sample cannot override current idle');
});

test('switching off clears all concurrent sources; late callbacks and re-enabling cannot restore them', async () => {
  const h = harness();
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.advance(15_000);
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.servers[0].onEvent({ source: 'codex', event: 'prompt' });
  const oldProbe = h.probes[0], oldServer = h.servers[0], oldTimer = h.timers[0];
  h.settings.activityMirrorEnabled = false;
  h.mirror.sync();
  const empty = { v: 1, music: false, coding: false, ai: false };
  assert.deepEqual(h.projections.at(-1), empty);
  h.settings.activityMirrorEnabled = true;
  h.mirror.sync();
  await Promise.resolve();
  oldProbe.onSample({ front: 'com.openai.chat', audio: ['com.spotify.client'] });
  oldServer.onEvent({ source: 'codex', event: 'prompt' });
  h.advance(60_000);
  oldTimer.callback();
  h.tick();
  assert.deepEqual(h.mirror.projection().concurrent, empty);
  assert.ok(h.mirror.projection().tools.every(tool => tool.lastSignalAt === null));
});

test('the existing popover query forwards the immutable concurrent projection without persisting it', async () => {
  const { createPopoverStateQuery } = require('../src/application');
  const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
  const { localDayKey } = require('../src/core/calendar');
  const { SKINS } = require('../src/skins.mjs');
  const { FOODS, PET_APPEARANCE_ITEMS } = require('../src/pet-content');
  const h = harness();
  const state = normalizePersistedState({}, { now: h.now() });
  const before = structuredClone(state);
  h.mirror.sync();
  await Promise.resolve();
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.advance(15_000);
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.mirror.onAgentEvent({ source: 'codex', event: 'prompt' });
  const query = createPopoverStateQuery({ readSnapshot: () => state, readRevision: () => 1,
    readSession: () => state.focusSession, clock: { now: h.now, dayKey: localDayKey },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({ network: false }),
    pomodoroView: () => ({ status: 'idle', running: false }), schemaVersion: state.schemaVersion,
    readActivityMirror: () => h.mirror.projection() });
  const result = query.execute();
  assert.deepEqual(result.activityMirror.concurrent, { v: 1, music: true, coding: true, ai: true });
  assert.ok(Object.isFrozen(result.activityMirror) && Object.isFrozen(result.activityMirror.concurrent));
  assert.deepEqual(state, before);
  assert.equal(Object.hasOwn(state, 'activityMirrorConcurrent'), false);
  assert.equal(Object.hasOwn(state.settings, 'activityMirrorConcurrent'), false);
});
