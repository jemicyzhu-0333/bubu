'use strict';

const http = require('node:http');

// The bundled plugin (integrations/) sends this header to this port; a development
// profile listens one port up so it never collides with an installed app
// (set BUBU_AGENT_PORT=47615 in the tool to test against it).
const SIGNAL_HEADER = 'X-Bubu-Agent';
const PORTS = Object.freeze({ production: 47614, development: 47615 });
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const ROUTE = /^\/v1\/agent\/([a-z0-9-]{1,32})\/([a-z]{1,16})$/;

// Loopback-only receiver for agent hooks (ARCHITECTURE「活动镜像」). It accepts exactly
// `POST /v1/agent/<source>/<event>` with the signal header, no Origin and no body, and
// answers 204. A web page cannot reach it: the custom header forces a CORS preflight
// that is never granted, and any request carrying Origin is refused. The worst a local
// process can do is make the companion look busy, and the rate limit bounds even that.
function createAgentSignalServer({ port, onEvent, onError = () => {}, createServer = http.createServer, now = Date.now }) {
  if (!Number.isInteger(port) || typeof onEvent !== 'function') throw new TypeError('agent signal server requires a port and an event sink');
  let server = null;
  let pending = null;
  let recent = [];

  function limited(at) {
    recent = recent.filter(time => at - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) return true;
    recent.push(at);
    return false;
  }

  function handle(request, response, owner) {
    const reply = status => { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end(); };
    const match = ROUTE.exec(request.url || '');
    const length = Number(request.headers['content-length'] || 0);
    if (server !== owner || request.method !== 'POST' || !match || request.headers.origin !== undefined
        || request.headers[SIGNAL_HEADER.toLowerCase()] !== '1' || length > 0 || request.headers['transfer-encoding']) {
      request.resume();
      reply(request.method === 'OPTIONS' ? 405 : 404);
      return;
    }
    if (limited(now())) { reply(429); return; }
    let accepted = false;
    try { accepted = onEvent({ source: match[1], event: match[2] }) === true; } catch (error) { try { onError(error); } catch {} }
    reply(accepted ? 204 : 404);
  }

  function start() {
    if (server) return Promise.resolve({ ok: true, port });
    if (pending) return pending.promise;
    const current = { server: null, resolve: null, promise: null };
    pending = current;
    current.promise = new Promise((resolve, reject) => {
      current.resolve = resolve;
      try {
        const candidate = createServer((request, response) => handle(request, response, candidate));
        current.server = candidate;
        candidate.on('error', error => {
          if (pending !== current && server !== candidate) return;
          try { onError(error); } catch {}
          if (pending === current) {
            pending = null;
            resolve({ ok: false, reason: error && error.code === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed' });
          }
        });
        candidate.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
          if (pending !== current) { candidate.close(); return; }
          pending = null;
          server = candidate;
          resolve({ ok: true, port });
        });
      } catch (error) {
        if (pending === current) pending = null;
        reject(error);
      }
    });
    return current.promise;
  }

  function stop() {
    const current = server;
    const starting = pending;
    server = null;
    pending = null;
    recent = [];
    if (starting) {
      starting.resolve({ ok: false, reason: 'stopped' });
      if (starting.server) starting.server.close();
    }
    if (current) current.close();
  }

  return Object.freeze({ start, stop, isListening: () => server !== null });
}

function agentSignalPort(profile) {
  return profile === 'development' ? PORTS.development : PORTS.production;
}

module.exports = { createAgentSignalServer, agentSignalPort, SIGNAL_HEADER, PORTS, RATE_LIMIT };
