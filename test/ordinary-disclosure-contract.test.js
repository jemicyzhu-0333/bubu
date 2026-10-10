
'use strict';
// Static markup contract only. Real geometry and keyboard checks belong to the browser matrix.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { editorMarkup, editOperation } = require('../src/surfaces/popover/ui/collaboration-change-edit.mjs');
const { setLocale, t } = require('../src/surfaces/shared/interface/i18n.mjs');
const svg = /<svg class="disclosure-icon"[^>]*aria-hidden="true"[^>]*stroke-width="1\.5"[^>]*><path d="m6 4 4 4-4 4" vector-effect="non-scaling-stroke"\/><\/svg>/;
test('ordinary text disclosures retain native semantics, independent labels and dynamic values', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  const entries = [...html.matchAll(/<details\b([^>]*)>\s*<summary([^>]*)>(.*?)<\/summary>/gs)];
  for (const key of ['routine-config', 'strategyWhy', 'taskAdvanced', 'draftChatRetentionOptions', 'draftChatDisclosure', 'draftChatManage', 'draftChatReceiptHistory', 'editDates', 'editAttributes']) {
    const item = entries.find(match => match[1].includes('"' + key + '"') || match[1].includes('"' + key + ' '));
    assert.ok(item, key);
    assert.match(item[1], /\bdisclosure\b/);
    assert.doesNotMatch(item[2], /data-i18n|role=|tabindex=/);
    assert.match(item[3], svg);
    assert.equal((item[3].match(/<svg/g) || []).length, 1);
    assert.match(item[3], /<span data-i18n="[^"]+">/);
    if (key === 'routine-config') assert.match(item[1], /disclosure-section" open/);
    if (key === 'editDates' || key === 'editAttributes') assert.match(item[3], new RegExp('<span id="' + key + 'Summary"></span>'));
  }
});
test('editable proposal disclosure preserves warnings, operation fields and localized title', () => {
  const operation = { opId: 'op-1', type: 'task.update', entityId: 't1', scope: 'current', patch: { title: 'Draft title' } };
  try {
    for (const locale of ['zh-CN', 'en']) {
      setLocale(locale);
      const markup = editorMarkup(operation, String);
      assert.match(markup, /^<details class="chat-change-editor disclosure"><summary>/);
      assert.match(markup, svg);
      assert.ok(markup.includes(t('编辑这项建议')));
      assert.ok(markup.includes(t('编辑后需要重新查看差异，旧确认失效。')));
      assert.match(markup, /data-change-edit="op-1" data-change-field="title" value="Draft title"/);
      assert.equal(editOperation(operation, 'title', 'New title').patch.title, 'New title');
      assert.equal(operation.patch.title, 'Draft title');
    }
  } finally { setLocale('zh-CN'); }
});
