'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, deferred, settle, idle, active, push, emit } = require('../test-support/quick-push-fixture');

const mode = h => h.document.body.dataset.mode;
const status = h => h.$('#panelStatus').textContent;
const busy = h => h.document.body.attributes['aria-busy'];
const stalled = () => new Promise(() => {});

for (const revision of [2, 11]) test(`complete scoped push at revision ${revision} is immediate with no extra read`, async t => {
  const h = await harness(t, { getState: n => n === 1 ? Promise.resolve({ revision: 1, quickPanel: idle() }) : stalled() });
  h.diff(push(revision, active()));
  assert.equal(mode(h), 'active'); assert.equal(h.reads(), 1);
});

for (const outcome of ['resolve', 'reject']) test(`newer push supersedes initial read ${outcome} without fallback overwrite`, async t => {
  const old = deferred(); const h = await harness(t, { getState: () => old.promise });
  h.diff(push(2, active())); assert.equal(mode(h), 'active'); assert.equal(h.reads(), 1);
  if (outcome === 'resolve') old.resolve({ revision: 1, quickPanel: idle() }); else old.reject(new Error('Synthetic late read'));
  await settle(); assert.equal(mode(h), 'active'); assert.equal(status(h), '');
});

test('old explicit refresh result before push is replaced by the pushed complete view', async t => {
  const old = deferred(); const h = await harness(t);
  h.client.getState = () => old.promise; const reading = h.feature.refresh();
  old.resolve({ revision: 1, quickPanel: idle() }); await reading;
  h.diff(push(2, active())); assert.equal(mode(h), 'active');
});

for (const revision of [1, 2]) test(`older/duplicate revision ${revision} neither rereads nor clears a draft status`, async t => {
  const h = await harness(t, { getState: () => Promise.resolve({ revision: 2, quickPanel: idle() }) });
  h.open(); h.$('#quickStartInput').value = 'Keep this'; h.$('#panelStatus').textContent = 'Draft owns status';
  h.diff(push(revision, active())); await settle();
  assert.equal(h.reads(), 1); assert.equal(mode(h), 'idle'); assert.equal(status(h), 'Draft owns status');
  assert.equal(h.$('#quickStartInput').value, 'Keep this'); assert.equal(h.$('#quickStartConfirm').disabled, false);
});

test('invalidation-only packet keeps the full-read recovery path', async t => {
  const h = await harness(t, { getState: n => Promise.resolve({ revision: n, quickPanel: n === 1 ? idle() : active() }) });
  h.diff({ revision: 2, dirty: { pomodoro: true } }); await settle();
  assert.equal(h.reads(), 2); assert.equal(mode(h), 'active');
});

test('same-revision complete packet repairs a pending invalidation-only read', async t => {
  const recovery = deferred(); const h = await harness(t, { getState: n => n === 1 ? Promise.resolve({ revision: 1, quickPanel: idle() }) : recovery.promise });
  h.diff({ revision: 2, dirty: { pomodoro: true } }); assert.equal(h.reads(), 2);
  h.diff(push(2, active())); assert.equal(mode(h), 'active'); assert.equal(h.reads(), 2);
  recovery.resolve({ revision: 1, quickPanel: idle() }); await settle(); assert.equal(mode(h), 'active');
});

test('duplicate invalidation while its recovery is pending does not start another read', async t => {
  const recovery = deferred(); const h = await harness(t, { getState: n => n === 1 ? Promise.resolve({ revision: 1, quickPanel: idle() }) : recovery.promise });
  h.diff({ revision: 2, dirty: { pomodoro: true } }); h.diff({ revision: 2, dirty: { pomodoro: true } });
  assert.equal(h.reads(), 2); recovery.resolve({ revision: 2, quickPanel: active() }); await settle(); assert.equal(mode(h), 'active');
});

for (const malformed of [null, {}, { mode: 'unknown' }, { mode: 'idle' }, { mode: 'active' }]) test(`unusable complete projection ${JSON.stringify(malformed)} requests recovery`, async t => {
  const h = await harness(t, { getState: n => Promise.resolve({ revision: n, quickPanel: n === 1 ? idle() : active() }) });
  h.diff(push(2, malformed)); await settle(); assert.equal(h.reads(), 2); assert.equal(mode(h), 'active');
});

test('unversioned complete packet cannot bypass the accepted revision and uses recovery', async t => {
  const h = await harness(t, { getState: n => n === 1 ? Promise.resolve({ revision: 4, quickPanel: active() }) : stalled() });
  h.diff({ delta: { quickPanel: idle() } }); await settle(); assert.equal(mode(h), 'active'); assert.equal(h.reads(), 2);
});

test('closed visit ignores projection rendering and reopens at an equal full-read revision', async t => {
  const h = await harness(t, { getState: () => Promise.resolve({ revision: 2, quickPanel: active() }) });
  h.events.get('blur')(); assert.equal(mode(h), 'fallback');
  h.diff(push(2, active())); await settle(); assert.equal(mode(h), 'fallback'); assert.equal(h.reads(), 1);
  h.events.get('focus')(); await settle(); assert.equal(mode(h), 'active'); assert.equal(h.reads(), 2);
});

test('reopen pending read accepts complete push and rejects older read completion', async t => {
  const reopen = deferred(); const h = await harness(t, { getState: n => n === 1 ? Promise.resolve({ revision: 1, quickPanel: idle() }) : reopen.promise });
  h.events.get('blur')(); h.events.get('focus')(); assert.equal(mode(h), 'fallback');
  h.diff(push(2, active())); assert.equal(mode(h), 'active'); assert.equal(h.reads(), 2);
  reopen.resolve({ revision: 1, quickPanel: idle() }); await settle(); assert.equal(mode(h), 'active');
});

test('unchanged pushed candidate preserves original draft text and action fingerprint', async t => {
  const h = await harness(t); h.open(); h.$('#quickStartInput').value = 'Original text';
  h.diff(push(2, idle())); await settle(); assert.equal(h.reads(), 1);
  assert.equal(h.$('#quickStartInput').value, 'Original text'); assert.equal(h.$('#quickStartConfirm').disabled, false);
  h.submit(); await settle(); assert.equal(h.calls.filter(row => row[0] === 'start').length, 1);
  assert.equal(h.calls.find(row => row[0] === 'start')[2].taskVersion, idle().candidates[0].quickStartAction.taskVersion);
});

test('changed pushed candidate preserves text but does not silently rebind its draft', async t => {
  const h = await harness(t); h.open(); h.$('#quickStartInput').value = 'Original text';
  h.diff(push(2, idle({ version: 2 }))); assert.equal(h.$('#quickStartInput').value, 'Original text');
  assert.equal(h.$('#quickStartConfirm').disabled, true); h.submit(); await settle();
  assert.equal(h.calls.filter(row => row[0] === 'start').length, 0); assert.match(status(h), /已变化/);
});

test('pending capture receipt survives a complete pushed replacement', async t => {
  const saved = deferred(); const h = await harness(t, { client: { addImpulse: () => saved.promise } });
  h.$('#impInput').value = 'Synthetic capture'; h.capture(); h.diff(push(2, active()));
  assert.equal(mode(h), 'active'); assert.equal(busy(h), 'true');
  saved.resolve({ ok: true }); await settle(); assert.equal(h.$('#impInput').value, '');
  assert.equal(status(h), '记好了'); assert.deepEqual(h.calls, [['hide']]); assert.equal(busy(h), 'false');
});

test('capture success display owns status against pushes until its hide timer finishes', async t => {
  const h = await harness(t, { deferTimeouts: true }); h.$('#impInput').value = 'Synthetic capture'; h.capture(); await settle();
  assert.equal(status(h), '记好了'); assert.equal(h.document.body.dataset.receipt, 'saved');
  h.diff(push(2, active())); await settle(); assert.equal(status(h), '记好了');
  h.flushTimers(); await settle(); assert.deepEqual(h.calls, [['capture', 'Synthetic capture'], ['hide']]);
});

test('pending quick-start keeps its own receipt after a complete postcommit push', async t => {
  const started = deferred(); const h = await harness(t, { client: { kickstart: () => started.promise } });
  h.open(); h.$('#quickStartInput').value = 'Open notebook'; h.submit(); h.diff(push(2, active({ kind: 'quick-start' })));
  assert.equal(mode(h), 'active'); assert.equal(busy(h), 'true'); started.resolve({ ok: true }); await settle();
  assert.match(status(h), /已开始/); assert.deepEqual(h.calls, [['hide']]); assert.equal(busy(h), 'false');
});

for (const result of ['success', 'refuse', 'reject']) test(`Cancel/new draft owns UI after prior pushed quick-start ${result}`, async t => {
  const first = deferred(), second = deferred(); let starts = 0;
  const h = await harness(t, { client: { kickstart: () => ++starts === 1 ? first.promise : second.promise } });
  h.open(); h.$('#quickStartInput').value = 'First'; h.submit(); h.diff(push(2, idle()));
  h.cancel(); h.open(); h.$('#quickStartInput').value = 'Second'; h.submit(); assert.equal(starts, 2);
  h.$('#panelStatus').textContent = 'New command owns status';
  if (result === 'reject') first.reject(new Error('Synthetic late failure')); else first.resolve({ ok: result === 'success', reason: 'task-changed' });
  await settle(); assert.equal(status(h), 'New command owns status'); assert.equal(h.$('#quickStartInput').value, 'Second');
  assert.equal(busy(h), 'true'); assert.equal(h.$('#quickStartConfirm').disabled, true); assert.deepEqual(h.calls, []);
  second.resolve({ ok: true }); await settle(); assert.deepEqual(h.calls, [['hide']]); assert.equal(busy(h), 'false');
});

for (const ending of ['reopen', 'dispose']) test(`${ending} rejects a late capture receipt after direct push`, async t => {
  const saved = deferred(); const h = await harness(t, { client: { addImpulse: () => saved.promise } });
  h.$('#impInput').value = 'Old'; h.capture(); h.diff(push(2, active()));
  if (ending === 'dispose') h.feature.dispose(); else {
    h.events.get('blur')(); h.client.getState = async () => ({ revision: 2, quickPanel: active() }); h.events.get('focus')(); await settle();
  }
  h.$('#impInput').value = 'New'; h.$('#panelStatus').textContent = 'New owner'; saved.resolve({ ok: true }); await settle();
  assert.equal(h.$('#impInput').value, 'New'); assert.equal(status(h), 'New owner'); assert.deepEqual(h.calls, []);
});

test('queued draft focus and cancel focus cannot steal focus from a new draft after push', async t => {
  const h = await harness(t); h.open(); h.cancel(); const oldFrames = h.frames.splice(0);
  h.diff(push(2, idle())); h.open(); h.$('#quickStartInput').focused = false; h.$('#impInput').focused = false;
  oldFrames.forEach(fn => fn()); assert.equal(h.$('#quickStartInput').focused, false); assert.equal(h.$('#impInput').focused, false);
  h.flushFrames(); assert.equal(h.$('#quickStartInput').focused, true);
});

test('same-looking session replacement suppresses prior resume rejection and uses its own ID', async t => {
  const old = deferred(), sent = []; const h = await harness(t, { initial: active({ paused: true }), client: {
    resumePomodoro: input => { sent.push(input); return sent.length === 1 ? old.promise : Promise.resolve({ ok: true }); }
  } });
  emit(h.$('#btnPauseQuickSession'), 'click'); h.diff(push(2, active({ paused: true, sessionId: 'session-b' })));
  old.resolve({ ok: false, reason: 'session-changed' }); await settle(); assert.equal(status(h), '');
  emit(h.$('#btnPauseQuickSession'), 'click'); await settle();
  assert.deepEqual(sent, [{ sessionId: 'session-a', intent: 'resume' }, { sessionId: 'session-b', intent: 'resume' }]);
});

test('held pushed session preserves guarded confirm and abandon target identity', async t => {
  const h = await harness(t); h.diff(push(2, active({ paused: true, held: true, sessionId: 'held-new' })));
  assert.equal(h.$('#btnPauseQuickSession').textContent, '确认计入完成'); emit(h.$('#btnPauseQuickSession'), 'click'); await settle();
  // A fresh push is deliberately used here so no query fixture can supply the identity.
  h.diff(push(3, active({ paused: true, held: true, sessionId: 'held-new' })));
  emit(h.$('#btnStopQuickSession'), 'click'); await settle();
  assert.deepEqual(h.calls, [['resume', { sessionId: 'held-new', intent: 'confirm-completion' }], ['stop', { sessionId: 'held-new' }]]);
});

for (const variant of ['break', 'done']) test(`pushed ${variant} task projection disables old rows, editor, append, completion, and shortcuts`, async t => {
  const h = await harness(t, { initial: active() }); const oldRow = h.$('#quickSteps').children[0];
  h.diff(push(2, active(variant === 'break' ? { kind: 'break' } : { done: true })));
  h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } });
  h.$('#stepInput').value = 'Do not send'; emit(h.$('#appendStepForm'), 'submit'); emit(h.$('#btnCompleteQuickTask'), 'click');
  emit(oldRow.children[0], 'click'); emit(oldRow.children[1], 'click'); await settle();
  assert.equal(h.$('#appendStepForm').classes.has('hidden'), true); assert.equal(h.$('#quickStepsSection').classes.has('hidden'), true);
  assert.deepEqual(h.calls, []);
});

test('disposed feature ignores a queued complete packet and queued focus', async t => {
  const h = await harness(t); h.open(); h.feature.dispose(); h.diff(push(2, active())); h.flushFrames();
  assert.equal(mode(h), 'fallback'); assert.equal(h.$('#quickStartInput').focused, false); assert.deepEqual(h.calls, []);
});

test('accepted complete push settles a superseded command refresh and its busy state', async t => {
  const h = await harness(t, { initial: active() }); h.client.getState = stalled;
  h.$('#stepInput').value = 'An appended step'; emit(h.$('#appendStepForm'), 'submit'); await settle(); assert.equal(busy(h), 'true');
  h.diff(push(2, active())); await settle(); assert.equal(mode(h), 'active'); assert.equal(busy(h), 'false');
  assert.deepEqual(h.calls, [['append', 'task-a', 'An appended step', undefined]]);
});


test('initial complete push preserves the visit-owned default capture focus', async t => {
  const h = await harness(t, { getState: stalled });
  h.diff(push(2, active())); h.flushFrames();
  assert.equal(mode(h), 'active'); assert.equal(h.$('#impInput').focused, true);
});

test('reopen complete push schedules default focus only for the current visit', async t => {
  const h = await harness(t); h.flushFrames(); h.$('#impInput').focused = false;
  h.events.get('blur')(); h.client.getState = stalled; h.events.get('focus')();
  h.diff(push(2, active())); h.flushFrames();
  assert.equal(mode(h), 'active'); assert.equal(h.$('#impInput').focused, true);
});

test('old superseded command refresh cannot release a newer visit command or clear its draft', async t => {
  const oldRead = deferred(), second = deferred(); let appends = 0;
  const h = await harness(t, { initial: active(), client: { appendTaskStep: () => ++appends === 1 ? Promise.resolve({ ok: true }) : second.promise } });
  h.client.getState = () => oldRead.promise; h.$('#stepInput').value = 'Old'; emit(h.$('#appendStepForm'), 'submit'); await settle();
  h.events.get('blur')(); h.client.getState = async () => ({ revision: 2, quickPanel: active() }); h.events.get('focus')(); await settle();
  h.$('#stepInput').value = 'New'; emit(h.$('#appendStepForm'), 'submit'); assert.equal(appends, 2);
  h.diff(push(3, active())); oldRead.resolve({ revision: 1, quickPanel: active() }); await settle();
  assert.equal(busy(h), 'true'); assert.equal(h.$('#stepInput').value, 'New');
  second.resolve({ ok: true }); await settle(); assert.equal(busy(h), 'false');
});

test('invalidation-only read replacement keeps an awaiting command busy until a usable view arrives', async t => {
  const oldRead = deferred(), currentRead = deferred(); let reads = 0;
  const h = await harness(t, { initial: active() });
  h.client.getState = () => ++reads === 1 ? oldRead.promise : currentRead.promise;
  h.$('#stepInput').value = 'Pending append receipt'; emit(h.$('#appendStepForm'), 'submit'); await settle();
  assert.equal(busy(h), 'true'); h.diff({ revision: 2, dirty: { pomodoro: true } }); await settle();
  assert.equal(reads, 2); assert.equal(busy(h), 'true'); assert.equal(h.$('#stepInput').value, 'Pending append receipt');
  currentRead.resolve({ revision: 2, quickPanel: active() }); await settle();
  assert.equal(busy(h), 'false'); assert.equal(h.$('#stepInput').value, '');
  oldRead.resolve({ revision: 1, quickPanel: idle() }); await settle(); assert.equal(mode(h), 'active');
});

test('malformed full read cannot consume the revision of a later complete scoped push', async t => {
  const h = await harness(t, { getState: () => Promise.resolve({ revision: 4, quickPanel: null }) });
  assert.equal(mode(h), 'fallback');
  h.diff(push(4, active()));
  assert.equal(mode(h), 'active'); assert.equal(h.reads(), 1);
});

test('unchanged pushed steps preserve the actual editor input node and entered text', async t => {
  const h = await harness(t, { initial: active() });
  emit(h.$('#quickSteps').children[0].children[1], 'click');
  const input = h.$('#quickSteps').querySelector('input');
  input.value = 'Current draft'; emit(input, 'input');
  h.diff(push(2, active()));
  assert.strictEqual(h.$('#quickSteps').querySelector('input'), input);
  assert.equal(input.value, 'Current draft'); assert.equal(input.focused, true);
});

test('unchanged pushed steps retain functional existing row command identities', async t => {
  const h = await harness(t, { initial: active() });
  const row = h.$('#quickSteps').children[0];
  h.diff(push(2, active()));
  assert.strictEqual(h.$('#quickSteps').children[0], row);
  emit(row.children[0], 'click'); await settle();
  assert.deepEqual(h.calls, [['step', 'task-a', 'step-a']]);
});

for (const extra of ['snapshot', 'settings', 'moodNotes', 'impulses', 'credential']) {
  test(`complete quick scope rejects unexpected ${extra} rather than retaining broad data`, async t => {
    const h = await harness(t, { getState: n => n === 1 ? Promise.resolve({ revision: 1, quickPanel: idle() }) : stalled() });
    h.diff(push(2, { ...active(), [extra]: 'PRIVATE_SENTINEL' }));
    assert.equal(mode(h), 'idle'); assert.equal(h.reads(), 2);
  });
}

test('same-revision complete push repairs a rejected full read without rereading', async t => {
  const h = await harness(t, { initial: active() });
  h.client.getState = async () => { throw new Error('Synthetic read failure'); };
  await h.feature.refresh(); assert.equal(mode(h), 'fallback');
  h.diff(push(1, active())); assert.equal(mode(h), 'active');
});

test('append success consumes its original draft after its own pushed step before the receipt', async t => {
  const sent = deferred();
  const h = await harness(t, { initial: active(), client: { appendTaskStep: () => sent.promise } });
  h.$('#stepInput').value = 'Write notes'; emit(h.$('#appendStepForm'), 'submit');
  const next = structuredClone(active()); next.steps.push({ id: 'step-b', title: 'Write notes' });
  h.diff(push(2, next)); sent.resolve({ ok: true }); await settle();
  assert.equal(busy(h), 'false'); assert.equal(h.$('#stepInput').value, '');
});

for (const replacement of ['session', 'edited-draft']) test(`append receipt cannot clear a newer ${replacement} owner`, async t => {
  const sent = deferred();
  const h = await harness(t, { initial: active(), client: { appendTaskStep: () => sent.promise } });
  h.$('#stepInput').value = 'Same words'; emit(h.$('#appendStepForm'), 'submit');
  if (replacement === 'session') h.diff(push(2, active({ sessionId: 'other-session' })));
  else { h.$('#stepInput').value = 'Edited'; emit(h.$('#stepInput'), 'input'); h.$('#stepInput').value = 'Same words'; emit(h.$('#stepInput'), 'input'); }
  sent.resolve({ ok: true }); await settle(); assert.equal(h.$('#stepInput').value, 'Same words');
});

function beginRename(h, text) {
  emit(h.$('#quickSteps').children[0].children[1], 'click');
  const input = h.$('#quickSteps').querySelector('input');
  input.value = text; emit(input, 'input');
  emit(h.$('#quickSteps').querySelector('form'), 'submit');
  return input;
}

test('rename success closes only its own editor after the pushed title arrives before the receipt', async t => {
  const sent = deferred();
  const h = await harness(t, { initial: active(), client: { renameTaskStep: () => sent.promise } });
  const input = beginRename(h, 'Write notes');
  const next = structuredClone(active()); next.steps[0].title = 'Write notes';
  h.diff(push(2, next)); assert.strictEqual(h.$('#quickSteps').querySelector('input'), input);
  sent.resolve({ ok: true }); await settle();
  assert.equal(busy(h), 'false'); assert.equal(h.$('#quickSteps').querySelector('input'), null);
});

for (const replacement of ['session', 'same-draft-edit', 'cancel-and-new-draft']) test(`rename receipt cannot close a newer ${replacement}`, async t => {
  const sent = deferred();
  const h = await harness(t, { initial: active(), client: { renameTaskStep: () => sent.promise } });
  beginRename(h, 'Old submitted words');
  if (replacement === 'session') {
    h.diff(push(2, active({ sessionId: 'other-session' })));
    emit(h.$('#quickSteps').children[0].children[1], 'click');
  } else if (replacement === 'cancel-and-new-draft') {
    emit(h.$('#quickSteps').querySelector('form').children[2], 'click');
    emit(h.$('#quickSteps').children[0].children[1], 'click');
  }
  const current = h.$('#quickSteps').querySelector('input');
  current.value = 'Latest text'; emit(current, 'input');
  sent.resolve({ ok: true }); await settle();
  assert.strictEqual(h.$('#quickSteps').querySelector('input'), current); assert.equal(current.value, 'Latest text');
});
