'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); }

const launcher = read('tools/pet-frames/capture.js');
const html = read('tools/pet-frames/frames.html');
const renderer = read('tools/pet-frames/frames.mjs');
const pkg = JSON.parse(read('package.json'));

test('the native frame module publishes readiness before returning its lazy capture API', () => {
  const previous = global.document;
  const status = {};
  global.document = {
    documentElement: { dataset: {} },
    createElement: () => ({}),
    querySelector: selector => selector === '#status' ? status : null
  };
  try {
    const { frameCapture } = require('./frames.mjs');
    assert.equal(global.document.documentElement.dataset.captureReady, 'true');
    assert.equal(frameCapture.total, 113);
    assert.equal(frameCapture.plannedFrames, 551);
    assert.equal(typeof frameCapture.prepare, 'function');
    assert.match(status.textContent, /113/);
  } finally {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  }
});

test('capture evaluation expressions are valid classic scripts, not top-level-await modules', () => {
  const vm = require('node:vm');
  for (const source of [launcher, read('scripts/expression-gallery.js')]) {
    for (const match of source.matchAll(/executeJavaScript\(\s*`([^`]+)`\s*\)/g)) {
      const expression = match[1].replace(/\$\{index\}/g, '0');
      assert.doesNotThrow(() => new vm.Script(expression));
    }
  }
});

test('the capture tool stays outside the shipped app', () => {
  // 正向发布输入仍只有三项；额外排除原始生图不扩大发布范围。
  assert.deepEqual(pkg.build.files.filter(pattern => !pattern.startsWith('!')), ['src/**/*', 'assets/**/*', 'package.json']);
  const { FileMatcher } = require('app-builder-lib/internal');
  const accepts = new FileMatcher(ROOT, '/unused-destination', value => value, pkg.build.files).createFilter();
  const capture = path.join(ROOT, 'tools', 'pet-frames', 'capture.js');
  assert.equal(accepts(capture, fs.statSync(capture)), false);
  assert.equal(pkg.build.files.some(pattern => pattern.startsWith('tools')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'tools', 'pet-frames', 'capture.js')), true);
  // 但它仍要过语法检查，否则独立出去就等于脱离门禁。
  assert.equal(pkg.scripts.lint, 'node scripts/check-syntax.js');
  assert.ok(require('../../scripts/check-syntax').syntaxFiles(ROOT).includes(capture));
  assert.equal(pkg.scripts.frames, 'electron tools/pet-frames/capture.js');
});

test('the capture tool is an explicit dev entry with no preload, IPC, or network', () => {
  // 与开发画廊同一条约束：不接生产 main，也不新增任何能力面。
  assert.doesNotMatch(launcher, /require\('\.\.\/\.\.\/src\/main'\)|require\("\.\.\/\.\.\/src\/main"\)/);
  assert.doesNotMatch(launcher, /preload\s*:|ipcMain|ipcRenderer|webviewTag|enableRemoteModule/);
  assert.doesNotMatch(`${html}\n${renderer}`, /window\.bubu|ipcRenderer|require\s*\(/);

  assert.match(launcher, /contextIsolation:\s*true/);
  assert.match(launcher, /nodeIntegration:\s*false/);
  assert.match(launcher, /sandbox:\s*true/);
  // 弹窗、导航与 webview 全部拒绝。
  assert.match(launcher, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(launcher, /will-navigate['"],\s*event => event\.preventDefault\(\)/);
  assert.match(launcher, /will-attach-webview['"],\s*event => event\.preventDefault\(\)/);

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
});

test('capturing never reads or writes the app data directory', () => {
  // 取帧只该产出图片。碰 userData 就意味着它可能改到日常那份真实状态。
  assert.doesNotMatch(launcher, /getPath\(|setPath\(|electron-store|config\.json/);
  // 产物落在 dist/，而 dist/ 已被 .gitignore 忽略：这些图是一次性证据，
  // 不是需要入库维护的基线。
  assert.match(launcher, /'dist', 'pet-frames'/);
  assert.match(read('.gitignore'), /^dist\/$/m);
  // 重新生成只能清理上一份 manifest 列出的 PNG，且要防止 ../ 越界。
  assert.match(launcher, /previous\.entries/);
  assert.match(launcher, /target\.startsWith\(outputRoot\)/);
  assert.doesNotMatch(launcher, /rmSync\([^\n]*recursive:\s*true/);
});

test('the strips come from the production drawing path, not a lookalike', () => {
  // 这是整个工具成立的前提：如果它自己另画一套，截出来的图只能证明它自己。
  for (const dependency of [
    '../../src/content/expressions.mjs',
    '../../src/content/behaviors.mjs',
    '../../src/content/session-activities.mjs',
    '../../src/content/scenes.mjs',
    '../../src/core/pet-stage.mjs',
    '../../src/core/pet-expression.mjs',
    '../../src/core/pet-face.mjs',
    '../../src/core/pet-art.mjs',
    '../../src/core/pet-action-art.mjs',
    '../../src/core/pet-scene-art.mjs'
  ]) assert.ok(renderer.includes(dependency), `frames.html 必须加载 ${dependency}`);

  assert.match(renderer, /art\.applyBodyPose\(/);
  assert.match(renderer, /art\.paintBodySprite\(/);
  assert.match(renderer, /art\.paintFaceSprite\(/);
  assert.match(renderer, /expressionEngine\.sampleExpressionPose\(/);
  assert.match(renderer, /actionArt\.paintActionLayer\(/);
  assert.match(renderer, /actionArt\.drawActionOverlay\(/);
  assert.match(renderer, /sceneArt\.drawBackdrop\(/);
  assert.match(renderer, /sceneArt\.drawSessionBackdrop\(/);
});

test('the capture output covers and separates every visual family', () => {
  assert.match(renderer, /planActionSheet\(behaviors\.PET_ACTIONS, 'action'\)/);
  assert.match(renderer, /planActionSheet\(sessionContent\.SESSION_ACTIVITIES, 'session'\)/);
  assert.match(renderer, /planSceneSheet\(sceneContent\.SCENES\)/);
  assert.match(launcher, /expression:\s*'expressions'/);
  assert.match(launcher, /action:\s*'actions'/);
  assert.match(launcher, /session:\s*'sessions'/);
  assert.match(launcher, /scene:\s*'scenes'/);
  assert.match(launcher, /entries:\s*captured/);
  assert.match(launcher, /frames:\s*plannedFrames/);
  // 逐项释放条带，防止 109 张 base64 长期常驻。
  assert.match(renderer, /release\(index\)/);
  assert.match(launcher, /frameCapture\.release/);
});

test('capture output is reproducible and traceable to a commit', () => {
  // 取帧固定 devicePixelRatio：跟随当前显示器会让两次产物尺寸不同，那样图就
  // 无法互相比较。
  assert.match(renderer, /const CAPTURE_DPR = 2;/);
  assert.match(renderer, /resolvePetStage\(\{ devicePixelRatio: CAPTURE_DPR \}\)/);
  // 验收要求截图证据能绑定到受测代码；记不到 commit 时必须如实写 null。
  assert.match(launcher, /rev-parse', 'HEAD'/);
  assert.match(launcher, /commit: null, dirty: null/);
  assert.match(launcher, /manifest\.json/);
  // 体检失败要非零退出，否则它接不进任何门禁。
  assert.match(launcher, /app\.exit\(1\)/);
});
