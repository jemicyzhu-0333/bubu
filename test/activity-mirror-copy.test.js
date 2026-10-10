'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { localizeDocument, setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');

test('activity help localizes the actual markup without promising audible music or inferring AI work from a window', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  const source = html.match(/id="activityMirrorLabel"[\s\S]*?<p data-i18n="([^"]+)">/)[1];
  const node = { dataset: { i18n: source }, textContent: '' };
  const document = { documentElement: {}, querySelectorAll: selector => selector === '[data-i18n]' ? [node] : [] };
  setLocale('zh-CN');
  localizeDocument(document);
  assert.equal(node.textContent, '根据前台应用、播放器音频输出和已接入 AI 工具的事件切换陪伴状态。不读取窗口标题、歌名或对话内容，不保存，也不发送。');
  setLocale('en');
  localizeDocument(document);
  assert.equal(node.textContent, 'The companion follows the foreground app, music-player audio output, and events from connected AI tools. Window titles, song names, and conversation content are never read, saved, or sent.');
  setLocale('zh-CN');
});
