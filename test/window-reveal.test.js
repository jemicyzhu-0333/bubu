'use strict';

// 开关窗口的闪屏：隐藏期间渲染器不绘制，刚显示的第一两帧可能是旧内容。三层处理，这里守住每一层：
// 1. 主进程先推状态、再显示；2. 显示后让系统重算阴影（见 electron-window-hosts）；
// 3. 原生壳始终稳定，动效只属于内容和控件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('the main process pushes the newest state before it shows the popover', () => {
  const main = read('src/main.js');
  const toggle = main.slice(main.indexOf('function togglePopover'), main.indexOf('function createImpulseWindow'));
  assert.match(toggle, /pushStateChange\(\{ all: true \}\);\s*positionPopoverNearTray\(\);\s*popover\.showAndFocus\(\);/);
  assert.doesNotMatch(toggle, /showAndFocus\(\);\s*pushStateChange/, 'showing first paints the stale frame');
});

test('native shells stay stable while their content owns entrance motion', () => {
  const chrome = read('src/surfaces/popover/features/app-chrome.mjs');
  const quick = read('src/surfaces/impulse/quick-panel.mjs');
  assert.doesNotMatch(chrome, /classList\.add\('reveal'\)/);
  assert.doesNotMatch(quick, /classList\.add\('reveal'\)/);
  assert.doesNotMatch(read('src/surfaces/popover/styles/theme.css'), /@keyframes shell-reveal/);
  assert.doesNotMatch(read('src/renderer/impulse.html'), /@keyframes pop-in/);
});
