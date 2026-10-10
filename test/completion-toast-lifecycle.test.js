'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverCompletionFeedback } = require('../src/surfaces/popover/features/completion-feedback.mjs');
const { dom } = require('../test-support/manual-growth-dom');
function deferred() { let resolve; const promise = new Promise(done => { resolve=done; });return {promise,resolve}; }
function fixture(undoComplete) { const {$,document}=dom();$('#finishToast').replaceChildren=(...nodes)=>{$('#finishToast').children=nodes;};
  return {$,feature:createPopoverCompletionFeedback({document,$,celebrate(){},surfaceClient:{undoComplete},timers:{setTimeout:()=>1,clearTimeout(){}}})}; }
for(const close of ['new-toast','dispose']) test(`pending undo cannot replace ${close}`,async()=>{
  const pending=deferred();let calls=0;const h=fixture(()=>{calls++;return pending.promise;});
  h.feature.announceCompletion({undo:{token:'one',ttlMs:5000}});const button=h.$('#finishToast').children[1];
  const first=button.emit('click');await button.emit('click');assert.equal(calls,1);
  if(close==='dispose')h.feature.dispose();else h.feature.showFinishToast('new message');
  pending.resolve({ok:true});await first;
  if(close==='dispose')assert.equal(h.$('#finishToast').classList.contains('hidden'),true);
  else assert.equal(h.$('#finishToast').textContent,'new message');
});
test('lost undo receipt is distinguished from an actual refusal',async()=>{
  const h=fixture(async()=>{throw Error('lost');});h.feature.announceCompletion({undo:{token:'one',ttlMs:5000}});
  await h.$('#finishToast').children[1].emit('click');assert.equal(h.$('#finishToast').textContent,'撤销结果暂未确认，可在任务列表核对。');h.feature.dispose();
});
