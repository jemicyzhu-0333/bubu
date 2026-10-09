import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Builds a production-markup/CSS fixture for a permitted browser or native
// Electron review. It does not execute a browser, use user data or call a model.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let html = await readFile(path.join(root, 'src/renderer/popover.html'), 'utf8');
html = html.replaceAll('href="../surfaces/', 'href="../src/surfaces/')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('<title>I’m ADHDer</title>', '<title>AI collaboration · synthetic production UI fixture</title>')
  .replace('</body>', '<script type="module" src="../tools/collaboration-preview/fixture.mjs"></script></body>');
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/collaboration-preview.html'), html);
console.log('Built dist/collaboration-preview.html; synthetic fixture only, not executed browser evidence.');
