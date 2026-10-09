'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dom } = require('../test-support/manual-growth-dom');
const { createPopoverBreakdownFeature } = require('../src/surfaces/popover/features/breakdown.mjs');
const { setLocale, getLocale } = require('../src/surfaces/shared/interface/i18n.mjs');

test('first English breakdown loading initializes its disabled confirmation before a provider reply', async context => {
  const before = getLocale(); context.after(() => setLocale(before)); setLocale('en');
  const prior = global.requestAnimationFrame; global.requestAnimationFrame = () => {};
  context.after(() => { if (prior) global.requestAnimationFrame = prior; else delete global.requestAnimationFrame; });
  const h = dom(); let resolve, reads = 0;
  const pending = new Promise(done => { resolve = done; });
  const feature = createPopoverBreakdownFeature({ ...h, $$: () => [], escapeHTML: String, maxSteps: 100,
    syncPressedButtons() {}, bindStepTitleField() {}, taskActionMessage: String, fallbackReasonText: String,
    surfaceClient: { previewBreakdown: async () => [], previewAiBreakdown: () => { reads++; return pending; }, dismissBreakdownProposal: async () => {} },
    isAiEnabled: () => true, activeLandingPrompt: () => null, isLandingModalOpen: () => false,
    renderLanding() {}, rememberLandingReturnFocus() {}, restoreModalFocus() {}, showTaskPanelStatus() {} });
  feature.mount(); context.after(() => feature.dispose());
  const opened = feature.open({ id: 'task', title: '设置 {count}' });
  assert.equal(h.$('#bdConfirm').disabled, true); assert.equal(h.$('#bdConfirm').textContent, 'Add to steps');
  setLocale('zh-CN'); assert.equal(h.$('#bdConfirm').disabled, true); assert.equal(h.$('#bdConfirm').textContent, '加到步骤里');
  assert.equal(h.$('#bdOriginal').textContent, '设置 {count}'); assert.equal(reads, 1);
  feature.close(); resolve({ ok: false }); await opened;
});
