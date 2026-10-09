'use strict';

// 可读性的底线，写成测试免得以后被悄悄退回去：
// - 面板用系统字体，中文小于 11px 在笔记本屏幕上几乎读不出来；
// - 任务前的勾选圈视觉上是 18px，但可点区域要更大。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STYLES = path.resolve(__dirname, '../src/surfaces/popover/styles');
const FIXED_GLYPH_CELLS = /hm-cell|\.tl-tick/;      // 固定尺寸的小格子里的数字 / 刻度，例外

function cssFiles(dir = STYLES) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? cssFiles(path.join(dir, entry.name)) : entry.name.endsWith('.css') ? [path.join(dir, entry.name)] : []));
}

test('no rule sets text smaller than 11px, apart from the fixed-size heatmap and axis glyphs', () => {
  const offenders = [];
  for (const file of cssFiles()) {
    const css = fs.readFileSync(file, 'utf8');
    for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      if (Number(match[1]) >= 11) continue;
      const open = css.lastIndexOf('{', match.index);
      const start = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('*/', open)) + 1;
      const selector = css.slice(start, open).replace(/\s+/g, ' ').trim();
      if (!FIXED_GLYPH_CELLS.test(selector)) offenders.push(`${path.relative(STYLES, file)}: ${selector.slice(0, 60)} → ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('task and step checkboxes provide at least a 28px hit area', () => {
  const theme = fs.readFileSync(path.join(STYLES, 'theme.css'), 'utf8');
  assert.match(theme, /\.task-checkbox \{[^}]*width: 28px; height: 28px;/);
  assert.match(theme, /\.step-check::before \{ content: ""; position: absolute; inset: -6px;/);
});

test('a locked wardrobe option stays readable: it is marked by a dashed border, not by fading its name', () => {
  const theme = fs.readFileSync(path.join(STYLES, 'theme.css'), 'utf8');
  assert.match(theme, /\.wardrobe-option\.locked \{ opacity: 1; color: var\(--fg-1\); background: transparent; border-style: dashed; \}/);
});

test('the focus-state card is one continuous surface with labelled actions and no repeated title', () => {
  const theme = fs.readFileSync(path.join(STYLES, 'theme.css'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../src/renderer/popover.html'), 'utf8');
  const nowCard = fs.readFileSync(path.resolve(__dirname, '../src/surfaces/popover/features/now-card.mjs'), 'utf8');
  assert.match(html, /class="action-surface"/);
  assert.match(theme, /#panelToday \.now-card,#panelToday \.pomo-panel \{[^}]*background: transparent/);
  assert.match(theme, /\.now-card::after,\.now-action::before \{ content: none/);
  // 操作是一行带文字的按钮（原来是上下叠着的两个没有名字的图标 ✓ ✎）
  assert.match(theme, /\.now-task-detail-actions \{ display: flex;/);
  assert.match(html, /id="btnCompleteNowTask"[^>]*>完成这件<\/button>/);
  assert.match(html, /id="btnEditNowTask"[^>]*>编辑<\/button>/);
  assert.doesNotMatch(html, /id="btnCompleteNowTask"[^>]*>✓/);
  // 和卡片标题相同就只留给读屏
  assert.match(nowCard, /detailTitle\.classList\.toggle\('sr-only', Boolean\(cardTitle\) && cardTitle\.textContent === task\.title\)/);
});

test('an unbroken run of characters wraps instead of running out of its card', () => {
  const theme = fs.readFileSync(path.join(STYLES, 'theme.css'), 'utf8');
  // 一整段英文 / 链接 / 文件名不含空格，不换行就会冲出卡片右边框，压到旁边的按钮上。
  assert.match(theme, /body\.pixel-body \{[^}]*overflow-wrap: anywhere;/);
  // 输入框、计时数字这类不该被打断的除外
  assert.match(theme, /input, textarea, select, kbd, \.pomo-time, \.mini-timer, time \{ overflow-wrap: normal; \}/);
});
