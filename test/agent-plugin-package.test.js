'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..', 'integrations');
const PLUGIN = path.join(ROOT, 'plugins', 'imadhder-companion');
const read = relative => JSON.parse(fs.readFileSync(path.join(PLUGIN, relative), 'utf8'));
const shared = read('hooks/hooks.json').hooks;
const cursor = read('hooks/cursor-hooks.json');

test('one package carries a manifest for every supported tool, all naming the same plugin', () => {
  const manifests = ['plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.qoder-plugin/plugin.json', '.codebuddy-plugin/plugin.json'].map(read);
  assert.deepEqual([...new Set(manifests.map(manifest => manifest.name))], ['imadhder-companion']);
  assert.equal(read('.cursor-plugin/plugin.json').hooks, './hooks/cursor-hooks.json');
  for (const marketplace of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
    const entry = JSON.parse(fs.readFileSync(path.join(ROOT, marketplace), 'utf8')).plugins[0];
    assert.equal(entry.name, 'imadhder-companion');
    assert.ok(fs.existsSync(path.join(ROOT, entry.source)), `${marketplace} points at the plugin`);
  }
  assert.deepEqual(Object.keys(shared), ['UserPromptSubmit', 'Stop']);
  assert.deepEqual(Object.keys(cursor.hooks), ['beforeSubmitPrompt', 'stop']);
});

function receiver() {
  const seen = [];
  const server = http.createServer((request, response) => {
    let length = 0;
    request.on('data', chunk => { length += chunk.length; });
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, header: request.headers['x-imadhder-agent'], length });
      response.writeHead(204); response.end();
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function runHook(command, env, stdin = '{"prompt":"secret question"}') {
  return new Promise(resolve => {
    const child = execFile('sh', ['-c', command], { env: { PATH: process.env.PATH, ...env }, timeout: 5000 }, (error, stdout) => {
      resolve({ code: error ? error.code : 0, stdout });
    });
    child.stdin.end(stdin);
  });
}

test('the shared hook reports which tool ran it, sends no content, prints nothing and never fails', async () => {
  const { server, seen, port } = await receiver();
  const prompt = shared.UserPromptSubmit[0].hooks[0].command;
  const stop = shared.Stop[0].hooks[0].command;
  const cases = [
    [{ CLAUDE_PLUGIN_ROOT: '/p' }, 'claude-code'],
    [{ CODEBUDDY_PLUGIN_ROOT: '/p', CLAUDE_PLUGIN_ROOT: '/p' }, 'codebuddy'],
    [{ QODER_PLUGIN_ROOT: '/p' }, 'qoder'],
    [{ PLUGIN_ROOT: '/p' }, 'codex'],
    [{}, 'agent']
  ];
  for (const [env, source] of cases) {
    const result = await runHook(prompt, { ...env, IMADHDER_AGENT_PORT: String(port) });
    assert.deepEqual(result, { code: 0, stdout: '' }, `${source}: UserPromptSubmit output would be injected into the agent's context`);
    assert.deepEqual(seen.at(-1), { method: 'POST', url: `/v1/agent/${source}/prompt`, header: '1', length: 0 });
  }
  assert.equal((await runHook(stop, { CLAUDE_PLUGIN_ROOT: '/p', IMADHDER_AGENT_PORT: String(port) })).code, 0);
  assert.equal(seen.at(-1).url, '/v1/agent/claude-code/stop');
  server.close();
  // The app is not running: still a silent success.
  assert.deepEqual(await runHook(prompt, { CLAUDE_PLUGIN_ROOT: '/p', IMADHDER_AGENT_PORT: String(port) }), { code: 0, stdout: '' });
});

test('the Cursor hooks always print the JSON Cursor expects, with or without the app', async () => {
  const { server, seen, port } = await receiver();
  const prompt = cursor.hooks.beforeSubmitPrompt[0].command;
  const stop = cursor.hooks.stop[0].command;
  assert.deepEqual(JSON.parse((await runHook(prompt, { IMADHDER_AGENT_PORT: String(port) })).stdout), { continue: true });
  assert.deepEqual(JSON.parse((await runHook(stop, { IMADHDER_AGENT_PORT: String(port) })).stdout), {});
  assert.deepEqual(seen.map(entry => entry.url), ['/v1/agent/cursor/prompt', '/v1/agent/cursor/stop']);
  server.close();
  assert.deepEqual(JSON.parse((await runHook(prompt, { IMADHDER_AGENT_PORT: String(port) })).stdout), { continue: true });
});
