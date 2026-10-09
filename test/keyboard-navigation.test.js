'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRovingIndex, focusTrapTargetIndex } = require('../src/core/keyboard-navigation.mjs');

test('four-tab navigation wraps and implements Home and End', () => {
  assert.equal(nextRovingIndex(0, 'ArrowRight', 4), 1);
  assert.equal(nextRovingIndex(3, 'ArrowRight', 4), 0);
  assert.equal(nextRovingIndex(0, 'ArrowLeft', 4), 3);
  assert.equal(nextRovingIndex(2, 'ArrowDown', 4), 3);
  assert.equal(nextRovingIndex(2, 'ArrowUp', 4), 1);
  assert.equal(nextRovingIndex(2, 'Home', 4), 0);
  assert.equal(nextRovingIndex(1, 'End', 4), 3);
  assert.equal(nextRovingIndex(1, 'Enter', 4), null);
});

test('command-menu navigation remains vertical while Home and End stay available', () => {
  assert.equal(nextRovingIndex(1, 'ArrowDown', 5, 'vertical'), 2);
  assert.equal(nextRovingIndex(1, 'ArrowUp', 5, 'vertical'), 0);
  assert.equal(nextRovingIndex(1, 'ArrowRight', 5, 'vertical'), null);
  assert.equal(nextRovingIndex(3, 'Home', 5, 'vertical'), 0);
  assert.equal(nextRovingIndex(0, 'End', 5, 'vertical'), 4);
});

test('dialog focus trapping wraps in both directions and catches focus outside the dialog', () => {
  assert.equal(focusTrapTargetIndex(2, 3, false), 0);
  assert.equal(focusTrapTargetIndex(0, 3, true), 2);
  assert.equal(focusTrapTargetIndex(-1, 3, false), 0);
  assert.equal(focusTrapTargetIndex(-1, 3, true), 2);
  assert.equal(focusTrapTargetIndex(1, 3, false), null);
});
