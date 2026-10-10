'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { companion } = require('../capabilities');
const { ACTIVITY_APPS } = require('../content/activity-apps');
const { createActivityProbeHost, resolveProbeCommand } = require('../platform/activity/activity-probe-host');
const { createAgentSignalServer, agentSignalPort } = require('../platform/activity/agent-signal-server');
const { AGENT_PLUGIN_NAME, AGENT_PLUGIN_TOOLS } = require('../content/agent-plugin');

const { activityMirror, concurrentActivity } = companion;
const EVALUATE_EVERY_MS = 5_000;
const REPRESENT_EVERY_MS = 30_000;

// Composition of the activity mirror (ARCHITECTURE「活动镜像」): the OS probe and the
// receiver for the bundled AI-tool plugin feed the pure classifiers; only coarse
// categories reach the pet and the panel. It runs only while the setting is on, keeps
// nothing on disk, never edits another tool's configuration and never names an app
// outside this process. No business rule here.
function createActivityMirror({
  appHost = null, platform = process.platform, isPackaged = appHost ? appHost.isPackaged() : false,
  resourcesPath = process.resourcesPath, appPath = appHost ? appHost.appPath() : process.cwd(), profile,
  getSettings, readIdleMs, presentMirror, publishChange, reportError = () => {},
  writeClipboard = text => require('electron').clipboard.writeText(text),
  now = Date.now, setTimer = setInterval, clearTimer = clearInterval, exists = fs.existsSync,
  createProbe = createActivityProbeHost, createServer = createAgentSignalServer
}) {
  for (const [name, port] of Object.entries({ getSettings, readIdleMs, presentMirror, publishChange, writeClipboard })) {
    if (typeof port !== 'function') throw new TypeError(`activity mirror requires ${name}`);
  }
  const tools = AGENT_PLUGIN_TOOLS.filter(tool => tool.platforms.includes(platform));
  const marketplace = isPackaged ? path.join(resourcesPath, 'integrations') : path.join(appPath, 'integrations');
  const pluginDir = path.join(marketplace, 'plugins', AGENT_PLUGIN_NAME);
  // When each source last reached us: the honest answer to "is this tool wired up".
  const lastSignal = new Map();
  let probe = null;
  let server = null;
  let timer = null;
  let run = null;
  let receiver = 'off';
  let sample = null;
  let agents = concurrentActivity.EMPTY_AGENT_SIGNALS;
  let concurrent = null;
  let primary = 'none';
  let presentedAt = 0;

  function report(channel, owner = run) {
    return error => { if (owner === run) { try { reportError(error, channel); } catch {} } };
  }

  function present(force = false) {
    const at = now();
    if (!force && at - presentedAt < REPRESENT_EVERY_MS) return;
    presentedAt = at;
    presentMirror(primary === 'none' ? null : primary,
      concurrent ? concurrent.projection : concurrentActivity.EMPTY_CONCURRENT_ACTIVITY);
  }

  function evaluate() {
    const at = now();
    let idleMs = Infinity;
    try { idleMs = readIdleMs(); } catch (error) { report('activity:idle')(error); }
    const previousConcurrent = concurrent ? concurrent.projection : concurrentActivity.EMPTY_CONCURRENT_ACTIVITY;
    concurrent = concurrentActivity.advanceConcurrentActivity(concurrent,
      { sample, agents, idleMs, now: at, catalog: ACTIVITY_APPS, platform });
    agents = concurrent.agents;
    const previous = primary;
    primary = concurrentActivity.primaryConcurrentActivity(concurrent.projection);
    const changed = primary !== previous || ['music', 'coding', 'ai'].some(key => previousConcurrent[key] !== concurrent.projection[key]);
    if (changed) {
      present(true);
      publishChange({ activity: true });
    } else if (primary !== 'none' || Object.values(concurrent.projection).includes(true)) present();
    return changed;
  }

  function onSample(next) {
    sample = Object.freeze({ front: next.front, audio: Object.freeze([...(next.audio || [])]), at: now() });
    evaluate();
  }

  function onAgentEvent(raw) {
    if (!run) return false;
    const event = activityMirror.normalizeAgentEvent(raw, now());
    if (!event) return false;
    agents = concurrentActivity.recordAgentSignal(agents, event, event.at);
    // The panel only lists bundled tools; unknown slugs must not create an
    // unbounded diagnostic history alongside the bounded active source set.
    const knownTool = tools.some(tool => tool.id === event.source);
    if (knownTool) lastSignal.set(event.source, event.at);
    const changed = evaluate();
    if (knownTool && !changed) publishChange({ activity: true });
    return true;
  }

  async function start(current) {
    const command = resolveProbeCommand({ platform, isPackaged, resourcesPath, appPath, exists });
    probe = createProbe({ command, onSample: next => { if (run === current) onSample(next); }, onError: report('activity:probe', current) });
    if (command) probe.start();
    timer = setTimer(() => { if (run === current) evaluate(); }, EVALUATE_EVERY_MS);
    if (!tools.length) return;
    const currentServer = createServer({ port: agentSignalPort(profile),
      onEvent: raw => run === current && onAgentEvent(raw), onError: report('activity:agent', current) });
    server = currentServer;
    receiver = 'starting';
    const listening = await currentServer.start();
    if (run !== current) { currentServer.stop(); return; }
    receiver = listening.ok ? 'listening' : listening.reason;
    publishChange({ activity: true });
  }

  function stop() {
    // Invalidate ownership before adapters can deliver queued callbacks while stopping.
    run = null;
    if (probe) probe.stop();
    if (server) server.stop();
    if (timer) clearTimer(timer);
    probe = null; server = null; timer = null;
    receiver = 'off'; sample = null; agents = concurrentActivity.EMPTY_AGENT_SIGNALS; lastSignal.clear();
    const wasActive = primary !== 'none' || (concurrent && Object.values(concurrent.projection).includes(true));
    concurrent = null;
    primary = 'none';
    presentedAt = 0;
    if (wasActive) presentMirror(null, concurrentActivity.EMPTY_CONCURRENT_ACTIVITY);
  }

  // Follows the setting: on starts the probe and the receiver, off stops both at once.
  function sync() {
    const enabled = getSettings().activityMirrorEnabled === true;
    if (enabled && !probe) {
      run = {};
      start(run).catch(report('activity:start'));
    } else if (!enabled && probe) stop();
    else return;
    publishChange({ activity: true });
  }

  function installText(tool) {
    const separator = platform === 'win32' ? '; ' : ' && ';
    return tool.commands.map(command => command.replace('{marketplace}', marketplace).replace('{plugin}', pluginDir)).join(separator);
  }

  // Panel projection: the category, whether the receiver is up, and per-tool install text
  // with the last time that tool actually signalled.
  function projection() {
    const enabled = getSettings().activityMirrorEnabled === true;
    return Object.freeze({
      enabled,
      activity: enabled ? primary : 'none',
      concurrent: enabled && concurrent ? concurrent.projection : concurrentActivity.EMPTY_CONCURRENT_ACTIVITY,
      receiver: enabled ? receiver : 'off',
      port: agentSignalPort(profile),
      tools: Object.freeze(tools.map(tool => Object.freeze({
        id: tool.id, label: tool.label, steps: tool.steps, command: installText(tool),
        lastSignalAt: lastSignal.get(tool.id) ?? null
      })))
    });
  }

  function copyPluginCommand({ tool: id }) {
    const tool = tools.find(candidate => candidate.id === id);
    if (!tool) return { ok: false, reason: 'tool-unsupported' };
    writeClipboard(installText(tool));
    return { ok: true };
  }

  function register(registerIpc) {
    if (typeof registerIpc !== 'function') throw new TypeError('activity mirror requires an IPC registrar');
    registerIpc('activity:copy-plugin-command', (_event, payload) => copyPluginCommand(payload));
  }

  return Object.freeze({ sync, register, projection, onAgentEvent, current: () => primary, dispose: stop });
}

module.exports = { createActivityMirror };
