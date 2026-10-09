'use strict';

// 端侧取帧入口：`npm run frames`。
//
// 它是显式的开发工具，不接生产 main、不注册 preload、不开 IPC、不联网，也不
// 读写任何用户数据目录 —— 所以它既不会污染日常那份状态，也不进发布包。
//
// 产物落在 `dist/pet-frames/`（`dist/` 已在 .gitignore 里）：32 个表达、
// 40 个特殊行为、12 个会话动作和 25 个场景分类输出，外加一份 manifest。
// manifest 里记环境与 commit 是因为验收要求截图证据
// 必须能绑定到受测代码上；一张不知道出自哪个 commit 的截图证明不了任何事。

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const outArgument = process.argv.find(argument => argument.startsWith('--out='));
const OUT_DIR = outArgument
  ? path.resolve(process.cwd(), outArgument.slice('--out='.length))
  : path.join(ROOT, 'dist', 'pet-frames');

function gitDescribe() {
  // 取不到 commit 不该让取帧失败（可能是从 tarball 跑的），但必须在 manifest
  // 里如实写成 null，而不是留一个看起来像真值的占位串。
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return { commit, dirty: dirty.length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

function cleanPreviousCapture() {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = Array.isArray(previous.entries)
      ? previous.entries
      : Array.isArray(previous.expressions) ? previous.expressions : [];
    const outputRoot = `${path.resolve(OUT_DIR)}${path.sep}`;
    for (const entry of entries) {
      if (!entry || typeof entry.file !== 'string' || !entry.file.endsWith('.png')) continue;
      const target = path.resolve(OUT_DIR, entry.file);
      // 只删除上一份 manifest 明确列出且仍位于输出目录内的 PNG。
      // 即使用户手改了 manifest，也不能用 ../ 逃出 dist 删除其他文件。
      if (target.startsWith(outputRoot) && fs.existsSync(target)) fs.unlinkSync(target);
    }
  } catch {
    // 旧 manifest 损坏时不猜测要删什么；新文件仍可安全覆盖。
  }
}

async function capture() {
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    backgroundColor: '#11131c',
    title: 'I’m ADHDer 表情取帧（开发）',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true
    }
  });
  hardenWindow(window);
  await window.loadFile(path.join(__dirname, 'frames.html'));

  // 取帧是同步完成的，所以 ready 标记一旦为真，全部条带就已经画好了 ——
  // 不需要靠固定延时去猜。
  const ready = await window.webContents.executeJavaScript(
    "import('./frames.mjs').then(() => document.documentElement.dataset.captureReady === 'true').catch(error => { throw new Error(error.stack || error.message); })"
  );
  if (!ready) throw new Error('frame capture did not reach ready state');

  const total = await window.webContents.executeJavaScript(`import('./frames.mjs').then(({ frameCapture }) => frameCapture.total)`);
  const counts = await window.webContents.executeJavaScript(
    `import('./frames.mjs').then(({ frameCapture }) => JSON.parse(JSON.stringify(frameCapture.counts)))`
  );
  const plannedFrames = await window.webContents.executeJavaScript(
    `import('./frames.mjs').then(({ frameCapture }) => frameCapture.plannedFrames)`
  );
  const stage = await window.webContents.executeJavaScript(
    `import('./frames.mjs').then(({ frameCapture }) => JSON.parse(JSON.stringify(frameCapture.stage)))`
  );
  if (!Number.isInteger(total) || total <= 0) throw new Error('frame capture reported no entries');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  cleanPreviousCapture();
  const captured = [];
  const failing = [];
  const kindDirectories = Object.freeze({
    expression: 'expressions',
    action: 'actions',
    session: 'sessions',
    scene: 'scenes'
  });

  for (let index = 0; index < total; index += 1) {
    // 逐个绘制、搬运、释放：109 张 base64 条带若同时常驻会占数百 MB。
    await window.webContents.executeJavaScript(`import('./frames.mjs').then(({ frameCapture }) => frameCapture.prepare(${index}))`);
    const metadata = await window.webContents.executeJavaScript(
      `import('./frames.mjs').then(({ frameCapture }) => JSON.parse(JSON.stringify(frameCapture.metadata(${index}))))`
    );
    const dataUrl = await window.webContents.executeJavaScript(
      `import('./frames.mjs').then(({ frameCapture }) => frameCapture.dataUrl(${index}))`
    );
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const directory = kindDirectories[metadata.kind];
    if (!directory) throw new Error(`unknown capture kind: ${metadata.kind}`);
    const fileName = path.join(directory, `${metadata.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.png`);
    const outputPath = path.join(OUT_DIR, fileName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
    await window.webContents.executeJavaScript(`import('./frames.mjs').then(({ frameCapture }) => frameCapture.release(${index}))`);

    captured.push({ ...metadata, file: fileName });
    const mark = metadata.health.ok ? '✔' : '✘';
    process.stdout.write(`${mark} ${metadata.kind.padEnd(10)} ${metadata.id.padEnd(22)} ${String(metadata.frames.length).padStart(2)} 帧  ${fileName}\n`);
    if (!metadata.health.ok) {
      failing.push(metadata.id);
      for (const fault of metadata.health.faults) process.stdout.write(`    ${fault}\n`);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    ...gitDescribe(),
    versions: {
      app: require(path.join(ROOT, 'package.json')).version,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    host: { platform: process.platform, arch: process.arch, release: os.release() },
    stage,
    skin: 'pink',
    counts: {
      expressions: counts.expression,
      actions: counts.action,
      sessions: counts.session,
      scenes: counts.scene,
      entries: captured.length,
      frames: plannedFrames
    },
    entries: captured,
    expressions: captured.filter(entry => entry.kind === 'expression'),
    actions: captured.filter(entry => entry.kind === 'action'),
    sessions: captured.filter(entry => entry.kind === 'session'),
    scenes: captured.filter(entry => entry.kind === 'scene')
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const frames = captured.reduce((count, entry) => count + entry.frames.length, 0);
  process.stdout.write(`\n${captured.length} 项 / ${frames} 帧（表达 ${counts.expression}、特殊行为 ${counts.action}、会话动作 ${counts.session}、场景 ${counts.scene}） → ${path.relative(process.cwd(), OUT_DIR)}\n`);

  window.destroy();
  return failing;
}

app.whenReady().then(async () => {
  const failing = await capture();
  if (failing.length > 0) {
    // 非零退出，这样它能直接接进门禁；只是这些判据全是确定性的渲染故障，
    // “姿态好不好看”依旧只能靠人看条带。
    process.stderr.write(`\n健全性体检未通过：${failing.join(', ')}\n`);
    app.exit(1);
    return;
  }
  app.quit();
}).catch(error => {
  process.stderr.write(`frame capture failed: ${error && error.stack ? error.stack : error}\n`);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
