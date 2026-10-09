'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

let galleryWindow = null;
const captureArgument = process.argv.find(argument => argument.startsWith('--capture='));
const capturePath = captureArgument
  ? path.resolve(process.cwd(), captureArgument.slice('--capture='.length))
  : null;

function hardenGalleryWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

async function createGalleryWindow() {
  galleryWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#11131c',
    title: 'I’m ADHDer 表达画廊（开发）',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: Boolean(capturePath)
    }
  });
  hardenGalleryWindow(galleryWindow);
  await galleryWindow.loadFile(
    path.join(__dirname, '..', 'src', 'renderer', 'expression-gallery.html'),
    capturePath ? { query: { capture: 'static' } } : undefined
  );
  if (capturePath) {
    const ready = await galleryWindow.webContents.executeJavaScript(
      "import('./expression-gallery.mjs').then(() => document.documentElement.dataset.galleryReady === 'true').catch(error => { throw new Error(error.stack || error.message); })"
    );
    if (!ready) throw new Error('expression gallery did not reach capture-ready state');
    // capturePage() 默认只抓当前 viewport。先把离屏窗口扩到完整文档高度，确保
    // 32 张卡全部进入同一份证据，而不是只留下首屏 10 张左右。
    const contentSize = await galleryWindow.webContents.executeJavaScript(`({
      width: Math.ceil(document.documentElement.scrollWidth),
      height: Math.ceil(document.documentElement.scrollHeight)
    })`);
    galleryWindow.setContentSize(Math.max(720, contentSize.width), Math.max(520, contentSize.height));
    // macOS 的离屏窗口在改变 viewport 后可能丢弃 canvas 合成层；按新尺寸同步重绘
    // 全部卡片，再给 Chromium 一个 compositor turn。
    const repainted = await galleryWindow.webContents.executeJavaScript(
      `import('./expression-gallery.mjs').then(({ galleryDebug }) => galleryDebug.repaint(0))`
    );
    if (repainted !== 32) throw new Error(`expression gallery repainted ${repainted} cards`);
    // 超高 offscreen viewport 在 macOS 上可能不合成 Canvas backing store；将生产路径
    // 已绘出的像素固化为 data URL 图片后再截图，避免得到只有卡片外框的空画廊。
    const rasterized = await galleryWindow.webContents.executeJavaScript(
      `import('./expression-gallery.mjs').then(({ galleryDebug }) => galleryDebug.rasterize())`
    );
    if (rasterized !== 32) throw new Error(`expression gallery rasterized ${rasterized} cards`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const image = await galleryWindow.webContents.capturePage();
    fs.mkdirSync(path.dirname(capturePath), { recursive: true });
    fs.writeFileSync(capturePath, image.toPNG());
    process.stdout.write(`expression gallery captured: ${capturePath}\n`);
    galleryWindow.destroy();
    galleryWindow = null;
    app.quit();
    return;
  }
  galleryWindow.show();
  galleryWindow.on('closed', () => { galleryWindow = null; });
}

app.whenReady().then(async () => {
  await createGalleryWindow();
  app.on('activate', () => {
    if (!capturePath && !galleryWindow) void createGalleryWindow();
  });
}).catch(error => {
  process.stderr.write(`expression gallery failed: ${error.message}\n`);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
