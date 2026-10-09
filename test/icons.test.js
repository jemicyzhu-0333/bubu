'use strict';

// 图标库：全部输出由 tools/icons/build.mjs 从 icon-paths.json 生成。
// 这里守住：输出没有过期、用到的图标都有定义、定义的图标都被用到、只有图形的按钮有可读的名字，
// 以及内联页面里的子集和页面实际用到的一致；本地样式文件由闭合 CSP 许可。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'tools/icons/build.mjs')).href);
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(relative, out);
    else if (/\.(html|mjs|js|css)$/.test(entry.name) && !/icons\.css$/.test(entry.name)) out.push(relative);
  }
  return out;
}

test('every generated icon output is up to date', async () => {
  const { outputs } = await load();
  for (const [file, content] of outputs()) {
    assert.equal(fs.readFileSync(file, 'utf8'), content, `${path.relative(ROOT, file)} is stale — run npm run icons:build`);
  }
});

test('every icon a page or script asks for exists, and no defined icon is dead weight', async () => {
  const { readPaths } = await load();
  const defined = new Set(Object.keys(readPaths()));
  const used = new Map();
  for (const file of [...sourceFiles('src/renderer'), ...sourceFiles('src/surfaces')]) {
    // 脚本里可能拼出 data-icon="…" 或者写 dataset.icon = 'play'；两种都算“用到”。
    const text = read(file);
    for (const match of text.matchAll(/data-icon="([a-z0-9-]+)"/g)) used.set(match[1], file);
    for (const match of text.matchAll(/dataset\.icon\s*=\s*[^;]*?'([a-z0-9-]+)'/g)) used.set(match[1], file);
    // 模板里把图标名当参数传（add(text, tone, 'tag')）或放在对照表里（{ enrich: 'sparkle' }）：脚本文件里出现引号括起来的名字就算用到。
    if (/\.(mjs|js)$/.test(file)) for (const name of Object.keys(JSON.parse(read('src/surfaces/shared/icon-paths.json')))) {
      if (name.length > 2 && (text.includes(`'${name}'`) || text.includes(`"${name}"`))) used.set(name, file);
    }
    for (const match of text.matchAll(/battery-(?:low|mid|high)/g)) used.set(match[0], file);
  }
  const missing = [...used.keys()].filter(name => !defined.has(name));
  assert.deepEqual(missing, [], 'used but not defined in icon-paths.json');
  const dead = [...defined].filter(name => !used.has(name));
  assert.deepEqual(dead, [], 'defined but never used: delete it from icon-paths.json');
});

test('a control that shows only a picture still has a name', () => {
  const html = read('src/renderer/popover.html');
  const offenders = [];
  for (const match of html.matchAll(/<button\b([^>]*\bdata-icon-only\b[^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = match[1];
    const visibleText = match[2].replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim();
    const named = /aria-label="[^"]+"/.test(attrs) || /class="sr-only"/.test(match[2]);
    if (visibleText === '' && !named) offenders.push(attrs.slice(0, 80));
  }
  assert.deepEqual(offenders, []);
  // 五张脸保留 aria-label 和读屏文字；可见说明由 dock 底部标签承载。
  for (const level of [20, 35, 50, 65, 80]) {
    assert.match(html, new RegExp(`data-level="${level}" data-icon="face-\\d" data-icon-only aria-pressed="false" aria-label="[^"]+"><span class="sr-only">`));
  }
});

test('inline icon pages cover their icons and permit only bundled stylesheets', async () => {
  const { injected, usedIcons, BEGIN, END } = await load();
  for (const page of ['src/renderer/impulse.html', 'src/renderer/pet.html']) {
    const html = read(page);
    assert.ok(html.includes(BEGIN) && html.includes(END), `${page} has the markers`);
    assert.equal(injected(html), html, `${page} inline icon block is current`);
    const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
    const directives = new Map(csp.split(';').map(value => value.trim().split(/\s+/))
      .map(([name, ...sources]) => [name, sources]));
    assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"], `${page}: only local and inline styles`);
    assert.deepEqual(directives.get('default-src'), ["'none'"]);
    assert.deepEqual(directives.get('script-src'), ["'self'"]);
    assert.deepEqual(directives.get('connect-src'), ["'none'"]);
    const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)];
    assert.ok(stylesheets.length > 0, `${page}: local styles explain the self permission`);
    for (const [, href] of stylesheets) {
      assert.match(href, /^\.\.\/surfaces\/[a-z0-9/-]+\.css$/, `${page}: no remote stylesheet`);
      assert.ok(fs.existsSync(path.resolve(ROOT, path.dirname(page), href)), `${page}: bundled stylesheet exists`);
    }
    const inline = html.slice(html.indexOf(BEGIN), html.indexOf(END));
    for (const name of usedIcons(html.slice(0, html.indexOf(BEGIN)) + html.slice(html.indexOf(END)))) {
      assert.match(inline, new RegExp(`\\[data-icon="${name}"\\]`), `${page} defines ${name}`);
    }
  }
  const popover = read('src/renderer/popover.html');
  assert.match(popover, /<link rel="stylesheet" href="\.\.\/surfaces\/shared\/icons\.css">/);
  assert.match(/Content-Security-Policy" content="([^"]*)"/.exec(popover)[1], /style-src 'self'/, 'popover may link the shared file');
});

test('icons draw with a mask in the text colour, so they follow light/dark and state colours for free', async () => {
  const css = read('src/surfaces/shared/icons.css');
  assert.match(css, /\[data-icon\]::before \{[\s\S]*?background-color: currentColor;[\s\S]*?mask: var\(--icon\)/);
  assert.match(css, /GENERATED by tools\/icons\/build\.mjs/);
  // 没有外部地址：全部是内联 data URI（内容安全策略 connect/img 只允许 self 和 data:）。
  assert.doesNotMatch(css, /url\((?!"data:image\/svg\+xml,)/);
});
