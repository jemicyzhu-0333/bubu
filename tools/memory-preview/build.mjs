import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Production HTML/CSS with synthetic, read-only memory ports. Building this file
// is not browser/native layout evidence and does not touch a user's profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let html = await readFile(path.join(root, 'src/renderer/popover.html'), 'utf8');
html = html.replaceAll('href="../surfaces/', 'href="../src/surfaces/')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('<title>I’m ADHDer</title>', '<title>Memory management · synthetic production UI fixture</title>')
  .replace('</body>', '<script type="module" src="../tools/memory-preview/fixture.mjs"></script></body>');
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/memory-preview.html'), html);
console.log('Built dist/memory-preview.html; read-only synthetic fixture, not executed browser evidence.');
