'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createActivityMirror } = require('../src/bootstrap/activity-mirror');
const { createActivityProbeHost } = require('../src/platform/activity/activity-probe-host');

// Exercise the actual production probe adapter/parser and composition. The OS
// process is an injected byte stream; this is not a native macOS/Windows claim.
for (const platform of ['darwin', 'win32']) {
  test(`${platform} probe byte stream and agent events produce independent concurrent signals`, async () => {
    let now = 1_000_000;
    let hook;
    let evaluate;
    let child;
    const presented = [];
    const settings = { activityMirrorEnabled: true };
    const mirror = createActivityMirror({ platform, isPackaged: true, resourcesPath: '/resources', appPath: '/app',
      profile: 'development', getSettings: () => settings, readIdleMs: () => 100,
      presentMirror: (primary, concurrent) => presented.push({ primary, concurrent }),
      publishChange: () => {}, writeClipboard: () => {}, now: () => now, exists: () => true,
      setTimer: callback => { evaluate = callback; return 1; }, clearTimer: () => {},
      createProbe: options => createActivityProbeHost({ ...options,
        spawn: () => {
          child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stdout.setEncoding = () => {};
          child.stdin = { end: () => {} };
          child.kill = () => {};
          return child;
        }
      }),
      createServer: ({ onEvent }) => {
        hook = onEvent;
        return { start: async () => ({ ok: true, port: 47615 }), stop: () => {} };
      }
    });
    mirror.sync();
    await Promise.resolve();
    const front = platform === 'darwin' ? 'com.microsoft.VSCode' : 'Code';
    const audio = platform === 'darwin' ? 'com.spotify.client' : 'Spotify';
    const line = JSON.stringify({ v: 1, front, audio: [audio] }) + '\n';
    child.stdout.emit('data', line.slice(0, 18));
    child.stdout.emit('data', line.slice(18));
    now += 15_000;
    child.stdout.emit('data', line);
    assert.deepEqual(presented.at(-1), { primary: 'coding', concurrent: { v: 1, music: true, coding: true, ai: false } });
    assert.equal(hook({ source: 'codex', event: 'prompt' }), true);
    assert.deepEqual(presented.at(-1), { primary: 'ai', concurrent: { v: 1, music: true, coding: true, ai: true } });
    assert.equal(hook({ source: 'cursor', event: 'prompt' }), true);
    assert.equal(hook({ source: 'codex', event: 'stop' }), true);
    now += 90_001;
    child.stdout.emit('data', line);
    assert.deepEqual(mirror.projection().concurrent, { v: 1, music: true, coding: true, ai: true });
    const valid = mirror.projection().concurrent;
    child.stdout.emit('data', '{"v":2,"front":"ChatGPT","audio":[]}\n');
    assert.deepEqual(mirror.projection().concurrent, valid, 'invalid protocol input is discarded before classification');
    now += 60_001;
    evaluate();
    assert.deepEqual(mirror.projection().concurrent, { v: 1, music: false, coding: false, ai: true }, 'stalled probe does not erase an independent hook');
    settings.activityMirrorEnabled = false;
    mirror.sync();
    child.stdout.emit('data', line);
    assert.equal(hook({ source: 'cursor', event: 'prompt' }), false);
    assert.deepEqual(presented.at(-1), { primary: null, concurrent: { v: 1, music: false, coding: false, ai: false } });
  });
}
