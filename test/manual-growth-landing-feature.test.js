'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverQuickStartLanding } = require('../src/surfaces/popover/features/quick-start-landing.mjs');
const { dom, element } = require('../test-support/manual-growth-dom');
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
function fixture(mode = 'focus') {
  const { $, document } = dom(), sent = [];
  let pending = { sessionId: 'session-one', taskId: 'task-one', taskEditable: true, status: 'pending' };
  let submit = async () => ({ ok: true });
  let blocked = false;
  const buttons = (mode === 'focus' ? ['skip','save'] : ['stop','extend-8','full-round']).map(action => {
    const node = element(action); node.dataset[mode === 'focus' ? 'focusLanding' : 'quickResolution'] = action; return node;
  });
  $('#quickStartMask').classList.add('hidden');
  $('#quickStartMask').querySelectorAll = () => buttons;
  $('#quickStartMask').querySelector = () => buttons[0];
  $('#focusLandingActions').querySelector = () => mode === 'focus' ? buttons[1] : null;
  const feature = createPopoverQuickStartLanding({ document, $, $$: selector => selector.includes(mode === 'focus' ? 'data-focus-landing' : 'data-quick-resolution') ? buttons : [],
    getState: () => mode === 'focus' ? { focusLandingPrompt: pending } : { quickStartResolutionPending: !!pending, quickStartDecision: pending },
    getSession: () => ({}), modalRegistry: { isOpen: () => blocked, isAnyOpen: () => blocked }, landingBlockingModals: ['editor'],
    canReceiveFocus: () => false, focusActionMessage: reason => reason || 'failed',
    surfaceClient: { resolveFocusLanding: request => { sent.push(request); return submit(request); }, resolveQuickStart: request => { sent.push(request); return submit(request); } } });
  feature.mount(); feature.render();
  return { $, feature, buttons, sent, setBlocked: value => { blocked = value; feature.render(); }, setSubmit: value => { submit = value; }, setPrompt: value => { pending=value; feature.render(); } };
}
for (const mode of ['focus','quick-start']) {
  test(`${mode} sends explicit false progress and displayed session identity once`, async () => {
    const h=fixture(mode), promise=deferred(); h.setSubmit(() => promise.promise);
    await h.buttons[0].emit('click'); await h.buttons[0].emit('click');
    assert.equal(h.sent.length,1); assert.equal(h.sent[0].progressMade,false); assert.equal(h.sent[0].sessionId,'session-one');
    promise.resolve({ok:true}); await new Promise(setImmediate); h.feature.dispose();
  });
  test(`${mode} explicit progress can resolve free and noneditable historical tasks without notes`, async () => {
    const h=fixture(mode); h.$('#landingNote').value='stale note';
    h.setPrompt({ sessionId:'session-two',taskId:null,taskEditable:false,status:'pending' });
    h.$('#landingProgressMade').checked=true; h.$('#landingNote').value='must not send';
    await h.buttons[0].emit('click'); await new Promise(setImmediate);
    assert.equal(h.sent[0].progressMade,true); assert.equal(h.sent[0].landingNote,null);
    assert.equal(h.$('#landingNoteField').classList.contains('hidden'),true); h.feature.dispose();
  });
  for (const failure of ['result','throw']) test(`${mode} stale ${failure} does not overwrite a replacement prompt or release its pending control`, async () => {
    const h=fixture(mode), first=deferred(), second=deferred(); h.setSubmit(() => first.promise);
    await h.buttons[0].emit('click');
    h.setPrompt({ sessionId:'session-two',taskId:'task-two',taskEditable:true,status:'pending' });
    h.$('#landingProgressMade').checked=true; h.$('#landingNote').value='new draft'; h.setSubmit(() => second.promise);
    await h.buttons[0].emit('click'); h.$('#quickStartError').textContent='new error';
    if(failure==='throw') first.reject(new Error('old')); else first.resolve({ok:false,reason:'old'});
    await new Promise(setImmediate);
    assert.equal(h.$('#quickStartError').textContent,'new error'); assert.equal(h.$('#landingNote').value,'new draft');
    assert.equal(h.$('#landingProgressMade').checked,true); assert.equal(h.buttons[0].disabled,true);
    second.resolve({ok:true}); await new Promise(setImmediate); assert.equal(h.buttons[0].disabled,false); h.feature.dispose();
  });
}

test('an editor temporarily hides landing without dropping the draft or claiming progress, and reveal restores focus', () => {
  const h = fixture();
  h.$('#landingNote').value = 'keep this draft'; h.$('#landingProgressMade').checked = true;
  const focusBefore = h.$('#landingNote').focusCount;
  h.setBlocked(true); assert.equal(h.feature.isOpen(), false);
  h.setBlocked(false); assert.equal(h.feature.isOpen(), true);
  assert.equal(h.$('#landingNote').value, 'keep this draft'); assert.equal(h.$('#landingProgressMade').checked, true);
  assert.equal(h.$('#landingNote').focusCount, focusBefore + 1); h.feature.dispose();
});
test('changing task edit eligibility keeps original identity and progress draft while disabling note save', () => {
  const h=fixture(); h.$('#landingNote').value='old task note'; h.$('#landingProgressMade').checked=true;
  h.setPrompt({ sessionId:'session-one',taskId:'task-one',taskEditable:false,status:'pending' });
  assert.equal(h.feature.activePrompt().taskId,'task-one'); assert.equal(h.buttons[1].disabled,true);
  assert.equal(h.$('#landingNoteField').classList.contains('hidden'),true); assert.equal(h.$('#landingProgressMade').checked,true); h.feature.dispose();
});
