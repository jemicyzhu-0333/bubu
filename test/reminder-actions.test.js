'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReminderActions } = require('../src/surfaces/reminders/actions.mjs');
const { dom } = require('../test-support/manual-growth-dom');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return {promise,resolve,reject}; }
function fixture(dismiss) { const { document,$ }=dom(); document.querySelectorAll=()=>[$('#action')];return {$,actions:createReminderActions({document,dismiss})}; }
test('reminder pending actions serialize, failure remains visible and controls recover',async()=>{
  const pending=deferred();let calls=0;const h=fixture(()=>{calls++;return pending.promise;});
  const first=h.actions.run('record');await h.actions.run('record');assert.equal(calls,1);assert.equal(h.$('#action').disabled,true);
  pending.resolve({handled:false,reason:'action-failed'});await first;
  assert.equal(h.$('#action').disabled,false);assert.equal(h.$('#nudgeStatus').textContent,'提醒操作未完成，可稍后重试。');h.actions.dispose();
});
test('reminder uncertainty is visible and old receipt cannot overwrite a new reminder',async()=>{
  const pending=deferred();const h=fixture(()=>pending.promise);const first=h.actions.run('record');
  h.actions.reset();pending.reject(Error('lost'));await first;assert.equal(h.$('#nudgeStatus').textContent,'');assert.equal(h.$('#action').disabled,false);
  await h.actions.run('record');assert.equal(h.$('#nudgeStatus').textContent,'提醒操作结果暂未确认。');h.actions.dispose();
});
