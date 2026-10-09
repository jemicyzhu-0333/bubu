'use strict';
// Disposable native Electron loader/crypto/network probe; no release provider,
// installer, credentials or user profile. Loopback HTTP exists only in this probe.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { CancellationToken } = require('builder-util-runtime');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-updater-runtime-'));
app.setPath('userData', directory);
app.setPath('sessionData', directory);
const { autoUpdater } = require('electron-updater');
autoUpdater.logger = null;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallEvent = 'manual';
autoUpdater.disableWebInstaller = true;
autoUpdater.disableDifferentialDownload = true;
const { publicKey, signedInfo } = require('../test/fixtures/update-channel');
autoUpdater.updateManifestPublicKey = publicKey;
const { createBoundedUpdateNetwork } = require('../src/platform/electron/update-network-bounds');
async function verifyNativeNetwork() {
  const server = http.createServer((request, response) => {
    if (request.url === '/stall') return;
    if (request.url === '/redirect') { response.writeHead(302, { location: '/ok' }); response.end(); return; }
    if (request.url === '/error') { response.writeHead(404); response.write('error'); return; }
    if (request.url === '/large') { response.write('1234567890'); response.end('1234567890'); return; }
    response.end('hello');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const network = createBoundedUpdateNetwork(autoUpdater.httpExecutor, { metadataLimit: 16 });
  const request = (pathname, timeoutMs = 2000) => network.run(() => network.executor.request({
    protocol: 'http:', hostname: '127.0.0.1', port: server.address().port, path: pathname, redirect: 'manual'
  }), { timeoutMs });
  try {
    assert.equal(await request('/ok'), 'hello');
    assert.equal(await request('/redirect'), 'hello');
    await assert.rejects(request('/large'));
    // Let the underlying aborted official promise settle before a fresh scope.
    await new Promise(resolve => setTimeout(resolve, 30));
    for (let i = 0; i < 3; i++) await assert.rejects(request('/error'));
    const token = new CancellationToken();
    const destination = path.join(directory, 'download-fixture');
    await network.run(() => network.executor.download(new URL(`http://127.0.0.1:${server.address().port}/ok`), destination, {
      cancellationToken: token, sha512: createHash('sha512').update('hello').digest('base64')
    }), { timeoutMs: 2000, token, maxBytes: 5 });
    assert.equal(fs.readFileSync(destination, 'utf8'), 'hello');
    await assert.rejects(request('/stall', 60));
  } finally {
    network.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
async function verifyNativeWindow() {
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    await window.loadURL('data:text/html,<input value=fixture-draft>');
    const before = await window.webContents.executeJavaScript('document.querySelector("input").value');
    window.setEnabled(false); assert.equal(window.isEnabled(), false);
    assert.equal(await window.webContents.executeJavaScript('document.querySelector("input").value'), before);
    window.setEnabled(true); assert.equal(window.isEnabled(), true);
  } finally { window.destroy(); }
}
app.whenReady().then(async () => {
  assert.equal(require('electron-updater/package.json').version, '7.0.0-alpha.9');
  const info = signedInfo();
  await autoUpdater.verifyManifestSignature(info);
  await assert.rejects(autoUpdater.verifyManifestSignature({ ...info, version: '0.0.1-dev.999' }));
  assert.equal(autoUpdater.autoInstallEvent, 'manual');
  await verifyNativeNetwork();
  const windowSmoke = !process.argv.includes('--loader-network-only');
  if (windowSmoke) await verifyNativeWindow();
  console.log(JSON.stringify({ ok: true, platform: process.platform, arch: process.arch,
    electron: process.versions.electron, node: process.versions.node, updater: '7.0.0-alpha.9',
    commonJsLoadsEsm: true, nativeNetworkBounds: true, nativeWindowEnableRoundTrip: windowSmoke,
    draftBytesUnchanged: windowSmoke, signaturePositiveAndTamper: true, nativeInstalledUpdate: false }));
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
app.once('quit', () => fs.rmSync(directory, { recursive: true, force: true }));
