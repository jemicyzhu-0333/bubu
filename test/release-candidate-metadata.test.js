'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const releaseRoot = 'https://github.com/jemicyzhu-0333/bubu/releases';
const releaseTag = 'v0.0.2-dev.2';
const filenames = {
  windows: 'bubu-0.0.2-dev.2-win-x64.exe',
  mac: 'bubu-0.0.2-dev.2-mac-arm64-adhoc-test.dmg',
  checksums: 'SHA256SUMS.txt',
};
const urlFor = name => `${releaseRoot}/download/${releaseTag}/${filenames[name]}`;
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

test('0.0.2-dev.2 published package identities, locks and versioned artifact names agree', () => {
  const app = json('package.json'), lock = json('package-lock.json');
  const site = json('website/package.json'), siteLock = json('website/package-lock.json');
  assert.equal(app.version, '0.0.2-dev.2');
  for (const version of [lock.version, lock.packages[''].version]) assert.equal(version, app.version);
  // Public metadata advances only after both original release assets are verified.
  for (const version of [site.version, siteLock.version, siteLock.packages[''].version]) assert.equal(version, releaseTag.slice(1));
  assert.equal(app.name, 'bubu'); assert.equal(app.build.appId, 'com.bubu.app');
  assert.equal(app.build.nsis.deleteAppDataOnUninstall, false);
  assert.ok(app.build.artifactName.includes('${version}'));
  assert.ok(app.build.mac.artifactName.includes('${version}'));
});

test('published site offers exactly the verified installers and checksum file with enabled anchors', () => {
  const html = read('website/public/index.html');
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
  for (const platform of ['windows', 'mac']) {
    const tags = anchors.filter(tag => attribute(tag, 'data-platform') === platform);
    assert.equal(tags.length, 1);
    const tag = tags[0];
    assert.equal(attribute(tag, 'href'), urlFor(platform));
    assert.equal(attribute(tag, 'data-release-state'), 'verified');
    assert.equal(attribute(tag, 'data-release-version'), '0.0.2-dev.2');
    assert.doesNotMatch(tag, /\s(?:aria-disabled|disabled|hidden)(?:=|\s|>)/);
    assert.doesNotMatch(tag, /tabindex="-\d+"/);
    if (platform === 'mac') assert.equal(attribute(tag, 'aria-describedby'), 'mac-warning');
  }
  const downloads = anchors.map(tag => attribute(tag, 'href')).filter(url => url?.includes('/releases/download/'));
  assert.deepEqual(downloads.sort(), Object.keys(filenames).map(urlFor).sort());
  assert.ok(anchors.some(tag => attribute(tag, 'data-release-notes') === 'current' && attribute(tag, 'href') === `${releaseRoot}/tag/${releaseTag}`));
  assert.ok(anchors.some(tag => attribute(tag, 'data-release-checksums') === 'current' && attribute(tag, 'href') === urlFor('checksums')));
  assert.doesNotMatch(html, /data-release-state="pending"|aria-disabled="true"|Candidate source:|pending validation|in preparation/);
});

test('published site keeps concise signing, upgrade and manual-update cautions', () => {
  const html = read('website/public/index.html');
  for (const text of [
    'Testing preview: 0.0.2-dev.2.', 'Release tag: v0.0.2-dev.2.',
    'Unsigned; SmartScreen may warn or block installation.',
    'Ad-hoc signed, without Developer ID or notarization.',
    "Gatekeeper's local distribution assessment rejects this build.",
    'browser-download/Finder acceptance was not tested.',
    'Do not disable operating-system security protections or remove quarantine',
    'explicit confirmation and a complete private backup',
    'versions that only support schema18 cannot open schema19.', 'new, nonexistent directory',
    'does not automatically roll back or switch the live profile.',
    'In-app updates remain unavailable.',
    'The separate testing-updates feature is not included; install and update manually.',
    `${releaseRoot}/tag/v0.0.1-dev-r4`,
  ]) assert.ok(html.includes(text), `Missing release fact or limitation: ${text}`);
  const releaseNote = html.match(/<div class="release-note">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(releaseNote && (releaseNote.match(/<p>/g) || []).length <= 3);
});

test('validation keeps the original artifact provenance and unproven trust and recovery limits', () => {
  const text = read('docs/VALIDATION.md');
  for (const fact of [
    'dae2958b09dcfea20cccd4ef43ea5cf7d58dcc68',
    'https://github.com/jemicyzhu-0333/bubu/actions/runs/38025816837',
    '136170648', '148838028',
    '4eae4f44dbb44334be01ba53a3df7e2aab739e1b539c6cb163147fd6871cdc34',
    '54684aaff99405dc4c4aff65be68ed253eb5a55c8579d0584347fb21973eeada',
    '7e009653accf4894bb639384b6a07820623e204b',
    'https://github.com/jemicyzhu-0333/bubu/actions/runs/37982979937',
    'https://github.com/jemicyzhu-0333/bubu/actions/runs/37986211557',
    '七个原文件字节及 mtime', '五个同意前/取消阶段',
    'Windows DACL / POSIX', '真实凭据及系统信任警告接受仍未证明',
    '该目录在旧进程清理后为空', '不能声称已恢复持久化损坏用户数据',
    '具体原生错误框内容也未捕获', '未替换发布的 run #21 原始产物',
  ]) assert.ok(text.includes(fact), `Missing evidence boundary: ${fact}`);
});

test('English and Chinese setup docs agree on the exact published links and preserve earlier releases', () => {
  for (const filename of ['README.md', 'README.zh-CN.md']) {
    const text = read(filename);
    for (const url of Object.keys(filenames).map(urlFor)) assert.ok(text.includes(url), `${filename}: missing ${url}`);
    for (const tag of [releaseTag, 'v0.0.2-dev.1', 'v0.0.1-dev-r4', 'v0.0.1-dev-r3', 'v0.0.1-dev-r2', 'v0.0.1-dev']) {
      assert.ok(text.includes(`${releaseRoot}/tag/${tag}`), `${filename}: missing historical/current release ${tag}`);
    }
    assert.ok(text.includes('docs/VALIDATION.md#002-dev2-已发布测试包的证据边界'));
    assert.ok(text.includes('docs/VALIDATION.md#002-dev1-已发布测试包的证据边界'));
    assert.ok(text.includes('testing-updates'));
    assert.doesNotMatch(text, /New installers are pending|no `0\.0\.2-dev\.1` download|still requires its own Windows\/macOS|新安装包仍待|组合候选仍须/);
  }
});
