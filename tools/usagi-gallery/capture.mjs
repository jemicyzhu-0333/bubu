import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function connectBrowser({ url = 'http://127.0.0.1:4186/?capture=1', chromium = '/usr/bin/chromium', port = 9338 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'usagi-gallery-chrome-'));
  const child = spawn(chromium, ['--headless=new', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, '--remote-allow-origins=http://127.0.0.1', `--user-data-dir=${profile}`,
    '--window-size=1500,1100', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 100; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (tabs[0]?.webSocketDebuggerUrl) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!tabs?.[0]?.webSocketDebuggerUrl) throw new Error('Chromium debugging endpoint unavailable');
  const socket = new WebSocket(tabs[0].webSocketDebuggerUrl); await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => { const data = JSON.parse(event.data);
    if (data.id) { const callback = pending.get(data.id); pending.delete(data.id); if (callback) data.error ? callback.reject(data.error) : callback.resolve(data.result); }
    else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url });
  for (let i = 0; i < 200; i++) { if (await evaluate('Boolean(window.usagiGallery?.ready)')) break;
    if (errors.length) throw new Error(JSON.stringify(errors)); await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!await evaluate('Boolean(window.usagiGallery?.ready)')) throw new Error('Gallery did not become ready');
  return { send, evaluate, errors, async close() { await send('Browser.close').catch(() => {}); socket.close(); child.kill();
    // Chrome profile stays in the OS temporary area; it never uses a user's browser profile.
  } };
}

async function main() {
  const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const out = path.resolve(argument('out') || 'dist/usagi-gallery'); fs.mkdirSync(out, { recursive: true });
  const browser = await connectBrowser({ url: argument('url') || 'http://127.0.0.1:4186/?capture=1', port: Number(argument('port') || 9338) });
  try {
    const catalog = await browser.evaluate('window.usagiGallery.catalog');
    const kinds = (argument('kinds') || 'action,session,expression,scene').split(',');
    const variants = (argument('variants') || 'dango,baseline,current').split(',');
    const filter = argument('ids')?.split(','); const entries = [];
    for (const kind of kinds) for (const item of catalog[kind]) {
      if (filter && !filter.includes(item.id)) continue;
      const options = { variants, frames: Number(argument('frames') || 9), dense: process.argv.includes('--dense'),
        dpr: 2, scene: argument('scene') || 'cozy-room', view: argument('view') || 'auto', outfit: !process.argv.includes('--bare') };
      const result = await browser.evaluate(`window.usagiGallery.renderStrip(${JSON.stringify(kind)},${JSON.stringify(item.id)},${JSON.stringify(options)})`);
      for (const strip of result.strips) {
        const file = `${kind}/${item.id}-${strip.variant}.png`; fs.mkdirSync(path.join(out, kind), { recursive: true });
        fs.writeFileSync(path.join(out, file), Buffer.from(strip.dataUrl.split(',')[1], 'base64'));
      }
      entries.push(...result.metadata);
      console.log(`${kind} ${item.id}: ${result.metadata.map(m => `${m.variant} ${m.summary.uniqueFrames}/${m.summary.frames} body, ${m.face.uniqueFrames}/${m.face.frames} face`).join(' | ')}`);
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
        renderer: 'Actual createPetRenderer + Canvas/Path2D', browser: await browser.send('Browser.getVersion'),
        baselineCommit: argument('baseline-commit') || null,
        baselineRef: argument('baseline-ref') || 'unversioned-local-source', entries, errors: browser.errors }, null, 2));
    }
    await browser.evaluate(`window.usagiGallery.setSelection('action','type-keyboard')`);
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(out, 'gallery-page.png'), Buffer.from(screenshot.data, 'base64'));
    console.log(`Captured ${entries.length} entry/variant sequences → ${out}`);
  } finally { await browser.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
