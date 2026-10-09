'use strict';

// 透明窗口的圆角。CSS 的规矩：html 没有自己的背景时，body 的背景会被“提升”去铺满整个画布，body 的
// border-radius 就一点用没有——窗口四个角是不透明的方角，页面里的圆角只剩里面一条弧线。
// 沙盒里的 Playwright 用透明背景截图逐个状态验证过（harness/audit/corners.py）；这里守住结构：
// html / body 不画，圆角卡片由外壳自己画。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const theme = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/styles/theme.css'), 'utf8');
const quick = fs.readFileSync(path.join(ROOT, 'src/renderer/impulse.html'), 'utf8');

function lastBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.length ? matches[matches.length - 1][1] : '';
}

test('the popover paints its rounded card on .app-shell, not on html or body', () => {
  assert.match(lastBlock(theme, 'html'), /background:\s*transparent/);
  const body = lastBlock(theme, 'body.pixel-body');
  assert.match(body, /background:\s*transparent/);
  assert.match(body, /border-radius:\s*0/);
  const shell = lastBlock(theme, '.app-shell');
  assert.match(shell, /border-radius:\s*12px/);
  assert.match(shell, /overflow:\s*hidden/);
  assert.match(shell, /background:/);
});

test('full-viewport masks and drawers carry the same radius, because they sit outside the shell', () => {
  const masks = lastBlock(theme, '.modal-mask, .settings-mask');
  assert.match(masks, /border-radius:\s*12px/);
  assert.match(masks, /overflow:\s*clip/);
});

test('the quick panel paints its rounded card on .quick-shell, not on html or body', () => {
  assert.match(quick, /html \{ background: transparent; \}/);
  const body = /\n  body \{([^}]*)\}/.exec(quick)[1];
  assert.match(body, /background:\s*transparent/);
  assert.doesNotMatch(body, /border-radius/);
  const shell = /\.quick-shell \{([^}]*)\}/.exec(quick)[1];
  assert.match(shell, /border-radius:\s*14px/);
  assert.match(quick, /<body[^>]*>\s*(?:<!--[\s\S]*?-->\s*)?<div class="quick-shell" id="quickShell">/);
  assert.match(quick, /<\/div>\s*<script type="module"/);
});
