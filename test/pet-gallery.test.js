'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const expressions = require('../src/content/expressions.mjs');
const expressionEngine = require('../src/core/pet-expression.mjs');
const stageEngine = require('../src/core/pet-stage.mjs');
const faceRig = require('../src/core/pet-face.mjs');
const art = require('../src/core/pet-art.mjs');
const gallery = require('../src/core/pet-gallery.mjs');

test('P5：32 表达内容同时支持 CommonJS 与开发画廊浏览器加载', () => {
  const { createRendererModuleLoader } = require('../test-support/renderer-modules');
  const sandbox = { window: {} };
  const api = createRendererModuleLoader(vm.createContext(sandbox))(path.join(ROOT, 'src/content/expressions.mjs')).default;
  assert.equal(api.EXPRESSIONS.length, 32);
  assert.doesNotThrow(() => api.assertExpressionLibrary());
  assert.deepEqual(Object.keys(sandbox.window), []);
});

test('P5：每张画廊卡片可独立播放和静态停帧', () => {
  let now = 1000;
  const controller = gallery.createController(expressions.EXPECTED_EXPRESSION_IDS, { now: () => now });
  const [first, second, third] = expressions.EXPECTED_EXPRESSION_IDS;

  now = 1400;
  controller.freeze(second);
  controller.play(first);
  now = 1700;
  assert.equal(controller.snapshot(first).elapsedMs, 300);
  assert.equal(controller.snapshot(first).static, false);
  assert.equal(controller.snapshot(second).elapsedMs, 0);
  assert.equal(controller.snapshot(second).static, true);
  assert.equal(controller.snapshot(third).elapsedMs, 700,
    '操作一张卡不能重置其他卡的播放时间');

  controller.freezeAll();
  assert.ok(controller.snapshots().every(item => item.static));
  now = 2000;
  controller.playAll();
  assert.ok(controller.snapshots().every(item => !item.static && item.elapsedMs === 0));
  assert.throws(() => controller.play('not.registered'), RangeError);
});

function recordingContext() {
  const calls = [];
  return {
    calls,
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    fillRect: (...args) => {
      assert.ok(args.every(Number.isFinite), `非有限绘制坐标：${args.join(',')}`);
      calls.push(['fillRect', ...args]);
    },
    translate: (...args) => {
      assert.ok(args.every(Number.isFinite));
      calls.push(['translate', ...args]);
    },
    rotate: value => { assert.ok(Number.isFinite(value)); calls.push(['rotate', value]); },
    scale: (...args) => { assert.ok(args.every(Number.isFinite)); calls.push(['scale', ...args]); }
  };
}

test('P5：画廊以生产同款身体、face mask 和 pose 采样绘制全部 32 表达', () => {
  const registry = expressionEngine.createExpressionRegistry(expressions.EXPRESSIONS);
  const stage = stageEngine.resolvePetStage({ devicePixelRatio: 2 });
  const palette = art.PALETTES.pink;
  const bodyContext = recordingContext();
  const surface = { getContext: () => bodyContext };
  art.paintBodySprite(surface, palette, 'normal', stage);
  assert.ok(bodyContext.calls.filter(call => call[0] === 'fillRect').length > 100,
    '共享身体网格必须真正绘制像素');

  const staticSignatures = expressions.EXPECTED_EXPRESSION_IDS.map(id => {
    const face = registry.get(id).static.face;
    return `${face.eyes}|${face.mouth}`;
  });
  assert.equal(new Set(staticSignatures).size, 32,
    '32 个表达的规范静态脸必须两两可辨，不能只换语义名称');

  for (const id of expressions.EXPECTED_EXPRESSION_IDS) {
    const config = registry.get(id);
    for (const elapsedMs of [0, config.enter.durationMs, 2400]) {
      const pose = expressionEngine.sampleExpressionPose(registry, id, elapsedMs);
      const context = recordingContext();
      art.applyBodyPose(context, pose.body, stage.artWidth);
      const eyes = art.drawLiveFace(context, palette, pose.face, false, {
        cell: stage.cell,
        offX: stage.bodyOrigin.x,
        offY: stage.bodyOrigin.y,
        faceRig
      });
      assert.ok(faceRig.EYE_MASKS[eyes], `${id} 返回未知眼形 ${eyes}`);
      assert.ok(context.calls.some(call => call[0] === 'fillRect'), `${id} 没有绘制活动脸`);
    }

    const staticContext = recordingContext();
    art.applyBodyPose(staticContext, config.static.body, stage.artWidth);
    art.drawLiveFace(staticContext, palette, {
      ...config.face,
      eyes: config.static.face.eyes,
      mouth: config.static.face.mouth
    }, false, {
      cell: stage.cell,
      offX: stage.bodyOrigin.x,
      offY: stage.bodyOrigin.y,
      faceRig
    });
    assert.ok(staticContext.calls.some(call => call[0] === 'fillRect'), `${id} 缺少静态停帧`);
  }
});

test('P5：画廊是显式开发入口，不接生产 main、不增加 preload 或 IPC', () => {
  const html = read('src/renderer/expression-gallery.html');
  const renderer = read('src/renderer/expression-gallery.mjs');
  const launcher = read('scripts/expression-gallery.js');
  const main = read('src/main.js');
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts.gallery, 'electron scripts/expression-gallery.js');
  assert.equal(pkg.scripts['gallery:capture'],
    'electron --headless scripts/expression-gallery.js --capture=dist/expression-gallery.png');
  assert.doesNotMatch(pkg.scripts['gallery:capture'], /--no-sandbox/,
    '可提交的画廊截图命令不能关闭 Chromium sandbox');
  assert.doesNotMatch(main, /expression-gallery/,
    '生产 main.js 不得创建或暴露开发画廊');
  assert.match(html, /Content-Security-Policy/);
  for (const directive of ["default-src 'none'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(html.includes(directive), `画廊 CSP 缺少 ${directive}`);
  }
  assert.match(html, /type="module" src="expression-gallery\.mjs"/);
  assert.match(renderer, /for \(const config of content\.EXPRESSIONS\) addCard\(config\)/);
  assert.match(renderer, /controller\.play\(config\.id\)/);
  assert.match(renderer, /controller\.freeze\(config\.id\)/);
  assert.match(renderer, /captureStatic[\s\S]*controller\.freezeAll\(0\)/,
    'P6 headless capture mode must render a deterministic static frame');
  assert.match(renderer, /dataset\.galleryReady\s*=\s*'true'/,
    'headless capture mode must expose a ready marker');
  assert.match(renderer, /repaint:\s*at\s*=>[\s\S]*paintAll\(/,
    '离屏窗口变更尺寸后必须允许按新 viewport 重绘全部 canvas');
  assert.match(renderer, /rasterize:\s*\(\)\s*=>\s*rasterizeAll\(\)/,
    '截图前必须能把 Canvas 固化为可合成的本地图片');

  assert.match(launcher, /contextIsolation:\s*true/);
  assert.match(launcher, /nodeIntegration:\s*false/);
  assert.match(launcher, /sandbox:\s*true/);
  assert.match(launcher, /offscreen:\s*Boolean\(capturePath\)/);
  assert.match(launcher, /document\.documentElement\.scrollHeight/,
    '截图必须测量完整画廊高度，不能只抓首屏');
  assert.match(launcher, /setContentSize\(/);
  assert.match(launcher, /galleryDebug\.repaint\(0\)/,
    '完整高度截图必须在 resize 后重绘 canvas 合成层');
  assert.match(launcher, /galleryDebug\.rasterize\(\)/,
    'macOS 离屏截图前必须固化 Canvas backing store');
  assert.match(launcher, /webContents\.capturePage\(\)/);
  assert.match(launcher, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.doesNotMatch(launcher, /preload\s*:|ipcMain|ipcRenderer|webviewTag|enableRemoteModule/);
  assert.doesNotMatch(`${html}\n${renderer}`, /window\.focuspix|ipcRenderer|require\s*\(/);
});
