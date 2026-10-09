import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

// Loopback-only, read-only gallery: no Electron bridge, user data, uploads or remote assets.
export function startGalleryServer({ root = ROOT, baseline = null, port = 4186 } = {}) {
  const roots = { current: path.resolve(root), baseline: baseline ? path.resolve(baseline) : null };
  const server = http.createServer((request, response) => {
    const send = (status, type, body) => { response.writeHead(status, { 'content-type': type,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(body); };
    if (request.method !== 'GET') return send(405, 'text/plain', 'read only');
    let name;
    try { name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch { return send(400, 'text/plain', 'invalid path'); }
    if (name === '/config.json') return send(200, TYPES['.json'], JSON.stringify({ baselineAvailable: Boolean(roots.baseline) }));
    const segments = name.split('/').filter(Boolean);
    let file;
    if (segments[0] in roots && roots[segments[0]] && ['src', 'assets'].includes(segments[1])) {
      const base = roots[segments.shift()];
      file = path.resolve(base, ...segments);
      if (!file.startsWith(base + path.sep)) return send(403, 'text/plain', 'outside source root');
    } else {
      file = path.resolve(HERE, name === '/' ? 'index.html' : '.' + name);
      if (!file.startsWith(HERE + path.sep)) return send(403, 'text/plain', 'outside gallery');
    }
    if (!TYPES[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'text/plain', 'not found');
    return send(200, TYPES[path.extname(file)], fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => { server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server)); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const server = await startGalleryServer({ baseline: argument('baseline'), port: Number(argument('port') || 4186) });
  console.log(`Usagi production-render gallery: http://127.0.0.1:${server.address().port}`);
}
