'use strict';
// Structural contract only: actual bounds and keyboard behavior are covered by the browser fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
test('settings disclosures share one decorative SVG while native details and localized labels remain intact', () => {
  const html = read('src/renderer/popover.html');
  const settings = html.slice(html.indexOf('id="settingsDrawer"'), html.indexOf('id="appUpdateGroup"') + 600);
  const summaries = [...settings.matchAll(/<details class="([^"]*\bdisclosure\b[^"]*)"[^>]*>\s*<summary>(.*?)<\/summary>/gs)];
  assert.equal(summaries.length, 11);
  assert.equal(summaries.filter(match => match[1].includes('disclosure-section')).length, 7);
  for (const [, , summary] of summaries) {
    assert.match(summary, /<svg class="disclosure-icon"[^>]*aria-hidden="true"[^>]*stroke-width="1\.5"/);
    assert.match(summary, /<path d="m6 4 4 4-4 4" vector-effect="non-scaling-stroke"/);
    assert.match(summary, /<span[^>]*data-i18n=/);
  }
  assert.match(settings, /id="activityMirrorStatus" hidden role="status" aria-live="polite"/);
  for (const id of ['setLanguage', 'planningDemand', 'planningScope', 'planningTrialParameter', 'planningTrialScope', 'memoryDraftKind', 'memoryDraftScope', 'memoryDraftPrivacy']) {
    assert.match(settings, new RegExp(`<select id="${id}" class="[^"]*compact-select`));
  }
  assert.match(settings, /<select class="activity-hook-select compact-select"[^>]*aria-label="AI 工具类型"/);
});
test('compact sizing and disclosure hierarchy use reusable tokens instead of native marker dimensions', () => {
  const tokens = read('src/surfaces/popover/styles/tokens.css');
  const components = read('src/surfaces/popover/styles/components.css');
  const theme = read('src/surfaces/popover/styles/theme.css');
  const settings = read('src/surfaces/popover/styles/features/settings.css');
  for (const [name, value] of Object.entries({ 'control-select-compact': 160, 'control-select-min': 128, 'control-select-max': 220, 'control-target-min': 24, 'disclosure-size': 10, 'disclosure-size-section': 12 })) {
    assert.match(tokens, new RegExp(`--${name}: ${value}px;`));
  }
  assert.match(components, /\.compact-select \{ min-height: 32px; flex: 0 1 var\(--control-select-compact\);/);
  assert.match(components, /min-width: min\(var\(--control-select-min\), 100%\)/);
  assert.match(components, /\.disclosure > summary \{[^}]*gap: 8px;/);
  assert.match(components, /\.disclosure:not\(\.disclosure-section\) > summary \{ min-height: 32px;/);
  assert.match(components, /\.disclosure > summary::marker \{ content: "";/);
  assert.match(components, /\.disclosure > summary::-webkit-details-marker \{ display: none;/);
  assert.doesNotMatch(settings, /\\25B8|\\25BE/);
  assert.match(theme, /@media \(max-width:480px\) \{\s*\.memory-draft \{ grid-template-columns: minmax\(0,1fr\);/);
  assert.match(theme, /\.activity-hook-head \{[^}]*flex-wrap: wrap;/);
  assert.doesNotMatch(theme.match(/\.activity-hook-select \{[^}]+\}/)[0], /flex: 1|width: 0/);
});
