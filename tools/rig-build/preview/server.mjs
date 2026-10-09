import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only preview stage for `npm run rig:preview`. It recompiles the SVG on
// every /rig.json request, so saving the file and reloading shows the change.
// Serves only the preview page and read-only src/ and assets/ modules.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

function startPreviewServer({ root, svgPath, port = 4178, compile }) {
  const send = (response, status, type, body) => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(response, 200, TYPES['.html'], fs.readFileSync(path.join(HERE, 'index.html')));
    }
    if (url.pathname === '/page.mjs') {
      return send(response, 200, TYPES['.mjs'], fs.readFileSync(path.join(HERE, 'page.mjs')));
    }
    if (url.pathname === '/rig.json') {
      try {
        const result = compile(svgPath);
        return send(response, 200, TYPES['.json'], JSON.stringify({ rig: result.doc, warnings: result.warnings,
          bounds: result.bounds, source: path.basename(svgPath) }));
      } catch (error) {
        return send(response, 200, TYPES['.json'], JSON.stringify({ error: error.message }));
      }
    }
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const allowed = ['src', 'assets'].some(dir => file.startsWith(path.join(root, dir) + path.sep));
    if (!allowed || !TYPES[path.extname(file)] || !fs.existsSync(file)) return send(response, 404, 'text/plain', 'not found');
    return send(response, 200, TYPES[path.extname(file)], fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export { startPreviewServer };
