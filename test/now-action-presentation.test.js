'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { actionPresentation } = require('../src/surfaces/popover/state/action-presentation.mjs');

test('title-only Now uses the real task title without inventing a saved action', () => {
  const task = { id: 't', title: 'CR agent技术方案完善', steps: [], nextAction: null };
  const before = structuredClone(task);
  assert.equal(actionPresentation({}, {}, task, null).action, task.title);
  assert.equal(actionPresentation({}, {}, task, null).usesTaskTitle, true);
  assert.deepEqual(task, before);
});
test('written action and open step retain priority, and completed tasks never advertise a next action', () => {
  const task = { title: 'Task title', nextAction: 'Open my notes', steps: [{ title: 'Write a paragraph', done: false }] };
  assert.equal(actionPresentation({}, {}, task, null).action, 'Open my notes');
  assert.equal(actionPresentation({}, {}, { ...task, nextAction: null }, null).action, 'Write a paragraph');
  const done = actionPresentation({}, {}, { ...task, done: true }, null);
  assert.equal(done.action, '这件事已经做完了'); assert.equal(done.usesTaskTitle, false);
});
test('free focus and empty views do not synthesize a task', () => {
  assert.equal(actionPresentation({}, {}, null, null).action, '把脑中的一件事放下来');
  assert.equal(actionPresentation({}, { running: true }, null, null).action, '这一段，留给手边的事');
});

