'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { t, getLocale, setLocale, localizeDocument } = require('../src/surfaces/shared/interface/i18n.mjs');

test('corrected panel disclosures localize without changing their consequences', context => {
  const previous = getLocale();
  context.after(() => setLocale(previous));
  const copy = [
    ['剩余步骤会一起标记完成。', 'The remaining steps will also be marked complete.'],
    ['兑换消耗食物券。每日首次推进获得 3 张；已有库存保留。', 'Redeem food with tickets. The first progress each day earns 3; existing stock is kept.'],
    ['插件只通知“提问了 / 回答完了”，不带提问、回答或文件内容。', 'The plugin reports only when a question starts or a reply finishes, without question, answer, or file contents.'],
    ['撤销结果暂未确认，可在任务列表核对。', 'Undo is unconfirmed. Check the task list.']
  ];
  const nodes = copy.map(([source]) => ({ dataset: { i18n: source }, textContent: source }));
  const document = { documentElement: {}, querySelectorAll: selector => selector === '[data-i18n]' ? nodes : [] };
  setLocale('en');
  localizeDocument(document);
  assert.deepEqual(nodes.map(node => node.textContent), copy.map(([, english]) => english));
  setLocale('zh-CN');
  localizeDocument(document);
  assert.deepEqual(nodes.map(node => node.textContent), copy.map(([source]) => source));
  assert.equal(t('My unchanged task'), 'My unchanged task');
});

test('static dialogs connect necessary error regions and corrected disclosures', () => {
  const html = fs.readFileSync(require.resolve('../src/renderer/popover.html'), 'utf8');
  assert.match(html, /id="reviewInboxError" role="alert"/);
  assert.match(html, /id="wardrobeStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="completeConfirmDescription" data-i18n="剩余步骤会一起标记完成。"/);
  assert.doesNotMatch(html, /兑换消耗 XP|每天完成第一件任务赠送一颗浆果|完成之后不能重新打开/);
});
