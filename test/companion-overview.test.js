'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { companionCount, formatCompanionCount, renderCompanionOverview } = require('../src/surfaces/popover/features/companion-overview.mjs');
const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
const { dom } = require('../test-support/manual-growth-dom');

for (const locale of ['zh-CN', 'en']) {
  for (const value of [0, 1, 999, 10000, Number.MAX_SAFE_INTEGER]) {
    test(`overview ${locale} ${value} remains compact with full accessible facts`, () => {
      setLocale(locale);
      const { $ } = dom();
      const projection = Object.freeze({ daysTogether: value, satiation: 74.4, totalFeeds: value });
      renderCompanionOverview($, projection);
      for (const key of ['Days', 'Meals']) {
        assert.equal($(`#companion${key}Value`).textContent, formatCompanionCount(value, locale));
        assert.ok($(`#companion${key}Value`).textContent.length <= 8);
        const label = $(`#companion${key}Stat`).attributes['aria-label'];
        if (value || key === 'Meals') assert.ok(label.includes(value.toLocaleString(locale)));
        assert.equal($(`#companion${key}Stat`).attributes.title, undefined);
        assert.equal($(`#companion${key}Detail`).textContent, label);
      }
      assert.equal($('#companionSatiationValue').textContent, '74');
      assert.equal(projection.satiation, 74.4);
      setLocale('zh-CN');
    });
  }
}
test('invalid counters do not leak non-finite text and never alter canonical values', () => {
  for (const value of [NaN, Infinity, undefined, -1, '12']) assert.equal(companionCount(value), 0);
  assert.equal(companionCount(1.9), 1);
});
test('overview has a single growth indicator and journey owns distinct keepsake and bond sections', () => {
  const html = fs.readFileSync('src/renderer/popover.html', 'utf8');
  const overview = html.slice(html.indexOf('<section id="panelCompanion"'), html.indexOf('<dialog class="panel-dialog" id="reviewInbox"'));
  assert.equal((overview.match(/role="progressbar"/g) || []).length, 1);
  assert.ok(!overview.includes('id="bondProgress"'));
  assert.ok(overview.includes('inline-help companion-growth'));
  for (const key of ['Days', 'Satiation', 'Meals']) assert.ok(overview.includes(`id="companion${key}Stat"`));
  const journey = html.slice(html.indexOf('<dialog class="panel-dialog" id="journeyPanel"'), html.indexOf('<!-- 随手记：'));
  for (const id of ['journeyKeepsakesTitle', 'journeyBondTitle', 'bondProgress', 'bondStage', 'bondMeta', 'milestoneList']) assert.ok(journey.includes(`id="${id}"`));
  assert.equal((html.match(/id="bondProgress"/g) || []).length, 1);
  assert.ok(!journey.includes("进度一直保留，按自己的节奏来。"));
});
