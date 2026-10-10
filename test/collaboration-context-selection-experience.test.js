'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createCollaborationContextSelection } = require('../src/surfaces/popover/features/collaboration-context-selection.mjs');

test('a new category or search supersedes an in-flight context request without accepting its stale items', async () => {
  const dom = createCollaborationDom(), pending = [], statuses = [];
  const record = { id: 'context-session' };
  const feature = createCollaborationContextSelection({ $: dom.$, escapeHTML: String,
    surfaceClient: { getConversationContextChoices: args => new Promise(resolve => pending.push({ args, resolve })) },
    getConversation: () => record, isOpen: () => true, isBusy: () => false,
    onChange() {}, onApply() {}, status: value => statuses.push(value) });
  feature.reset(record);
  dom.$('#draftChatContextKind').value = 'task'; const first = feature.load();
  dom.$('#draftChatContextKind').value = 'memory'; const second = feature.load();
  assert.equal(pending.length, 2); assert.equal(pending[1].args.kind, 'memory');
  pending[1].resolve({ ok: true, items: [{ id: 'memory-1', subject: 'Chosen memory' }] }); await second;
  pending[0].resolve({ ok: true, items: [{ id: 'task-1', title: 'Stale task' }] }); await first;
  assert.match(dom.$('#draftChatContextChoices').innerHTML, /Chosen memory/);
  assert.doesNotMatch(dom.$('#draftChatContextChoices').innerHTML, /Stale task/);
  assert.equal(feature.toggle('memory-1', true), true);
  assert.deepEqual(feature.selection().memoryIds, ['memory-1']);
  dom.$('#draftChatContextSearch').value = 'old'; const oldSearch = feature.load();
  dom.$('#draftChatContextSearch').value = 'new'; const newSearch = feature.load();
  pending[2].resolve({ ok: false }); await oldSearch;
  assert.notEqual(statuses.at(-1), '这类内容暂不可用，不能据此判断没有记录。');
  pending[3].resolve({ ok: true, items: [{ id: 'memory-2', subject: 'New search' }] }); await newSearch;
  assert.match(dom.$('#draftChatContextChoices').innerHTML, /New search/);
  feature.dispose();
});

test('pending category read immediately removes old checkboxes while preserving the accepted selection', async () => {
  const dom = createCollaborationDom(), pending = [];
  const feature = createCollaborationContextSelection({ $: dom.$, escapeHTML: String,
    surfaceClient: { getConversationContextChoices: args => new Promise((resolve, reject) => pending.push({ args, resolve, reject })) },
    getConversation: () => ({ id: 'session' }), isOpen: () => true, isBusy: () => false,
    onChange() {}, onApply() {}, status() {} });
  feature.reset({ id: 'session' }, { taskIds: ['accepted-task'] });
  dom.$('#draftChatContextKind').value = 'task'; const first = feature.load();
  pending[0].resolve({ ok: true, items: [{ id: 'old-task', title: 'Old row' }] }); await first;
  assert.match(dom.$('#draftChatContextChoices').innerHTML, /data-context-id="old-task"/);
  dom.$('#draftChatContextKind').value = 'memory'; const fresh = feature.load();
  assert.doesNotMatch(dom.$('#draftChatContextChoices').innerHTML, /data-context-id=/);
  assert.equal(dom.$('#draftChatContextChoices').attributes['aria-busy'], 'true');
  assert.equal(feature.toggle('old-task', true), false);
  assert.deepEqual(feature.selection().taskIds, ['accepted-task']);
  assert.deepEqual(feature.selection().memoryIds, []);
  pending[1].reject(new Error('Synthetic read failure')); await fresh;
  assert.doesNotMatch(dom.$('#draftChatContextChoices').innerHTML, /Old row/);
  assert.equal(dom.$('#draftChatContextChoices').attributes['aria-busy'], 'false');
  feature.dispose();
});
