'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bindTaskDatePicker, taskDateInputError } = require('../src/surfaces/popover/ui/task-date-controls.mjs');
const { createPopoverTaskWhenFields } = require('../src/surfaces/popover/ui/task-when-fields.mjs');
const { createPopoverDom } = require('../src/surfaces/popover/ui/dom.mjs');
const { endOfLocalDateISO } = require('../src/renderer/task-dates.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');

function harness(t) {
  const dom = createCollaborationDom();
  const dates = createPopoverDom({ document: dom.document, window: {} });
  const status = [];
  const feature = createPopoverTaskWhenFields({ ...dates, $: dom.$, $$: () => [], syncPressedButtons() {},
    endOfLocalDateISO, formatExpiry: String, recurrenceIntervalError: () => '', autoExpiryPreview: () => null,
    showStatus: value => status.push(typeof value === 'function' ? value() : value) });
  feature.mount(); t.after(() => feature.dispose());
  const change = (id, value, badInput = false) => {
    dom.$(id).value = value; dom.$(id).validity = { badInput }; dom.fire(id, 'change');
  };
  return { ...dom, feature, status, dates, change };
}

test('opening, dismissing and unavailable native picker never changes the date', () => {
  const dom = createCollaborationDom(), input = dom.$('#deadlineInput'), button = dom.$('#deadlineInputPicker');
  input.value = '2026-11-07'; let calls = 0;
  input.showPicker = () => { calls++; };
  const dispose = bindTaskDatePicker(input, button);
  assert.equal(input.dataset.customPicker, 'true');
  assert.equal(button.hidden, false);
  dom.fire('#deadlineInputPicker', 'click');
  assert.equal(calls, 1); assert.equal(input.value, '2026-11-07'); assert.equal(dom.document.activeElement, input);
  input.showPicker = () => { throw new Error('NotAllowedError'); };
  assert.doesNotThrow(() => dom.fire('#deadlineInputPicker', 'click'));
  assert.equal(input.value, '2026-11-07');
  assert.equal(input.dataset.customPicker, 'false');
  assert.equal(button.hidden, true, 'failed enhancement leaves only the native entry');
  input.disabled = true; dom.fire('#deadlineInputPicker', 'click'); assert.equal(calls, 1);
  dispose(); input.disabled = false; input.showPicker = () => calls++;
  dom.fire('#deadlineInputPicker', 'click'); assert.equal(calls, 1);
});

test('invalid and incomplete native date input blocks saving without clearing the accepted date', t => {
  const h = harness(t);
  h.change('#deadlineInput', '2026-11-07'); const accepted = h.feature.values().deadline;
  h.change('#deadlineInput', '2026-02-30');
  assert.equal(h.feature.values().deadline, accepted); assert.ok(h.feature.validate());
  assert.equal(h.$('#deadlineInput').value, '2026-02-30');
  h.change('#deadlineInput', '', true);
  assert.equal(h.feature.values().deadline, accepted); assert.ok(h.feature.validate());
  h.change('#deadlineInput', '', false);
  assert.equal(h.feature.values().deadline, null); assert.equal(h.feature.validate(), '');
});

test('planned, scheduled and deadline remain independent, including picker cancellation and explicit clears', t => {
  const h = harness(t);
  h.change('#plannedForInput', '2026-11-06'); h.change('#scheduledForInput', '2026-11-07T14:35');
  h.change('#deadlineInput', '2026-11-08');
  const accepted = h.feature.values();
  assert.equal(accepted.plannedFor, '2026-11-06');
  assert.equal(h.dates.localDateTimeInputValue(accepted.scheduledFor), '2026-11-07T14:35');
  h.$('#plannedForInput').showPicker = () => {};
  h.fire('#plannedForInputPicker', 'click'); assert.deepEqual(h.feature.values(), accepted);
  h.change('#scheduledForInput', 'invalid');
  assert.equal(h.feature.values().scheduledFor, accepted.scheduledFor); assert.ok(h.feature.validate());
  h.fire('#clearScheduledFor', 'click'); assert.equal(h.feature.values().scheduledFor, null);
  assert.equal(h.feature.values().plannedFor, accepted.plannedFor); assert.equal(h.feature.values().deadline, accepted.deadline);
  assert.equal(h.feature.validate(), ''); h.feature.reset();
  assert.equal(h.feature.values().plannedFor, null); assert.equal(h.feature.values().deadline, null);
});

test('local date-time validation rejects normalization rather than silently shifting an invalid time', () => {
  const dom = createCollaborationDom(), input = dom.$('#scheduledForInput');
  input.value = '2026-03-08T02:30';
  assert.ok(taskDateInputError(input, () => 'normalized', () => '2026-03-08T03:30'));
  assert.equal(input.value, '2026-03-08T02:30');
});

test('unsupported picker and disposal retain native calendar and keyboard input', () => {
  const dom = createCollaborationDom(), input = dom.$('#editDeadline'), button = dom.$('#editDeadlinePicker');
  input.value = '2026-11-07';
  const dispose = bindTaskDatePicker(input, button);
  assert.equal(input.dataset.customPicker, 'false');
  assert.equal(button.hidden, true);
  assert.equal(input.disabled, false);
  assert.equal(input.value, '2026-11-07');
  dispose();
  input.showPicker = () => {};
  const disposeAgain = bindTaskDatePicker(input, button);
  assert.equal(button.hidden, false);
  assert.equal(input.dataset.customPicker, 'true');
  disposeAgain();
  assert.equal(input.dataset.customPicker, 'false');
  assert.equal(button.hidden, true);
  assert.equal(input.value, '2026-11-07');
});
