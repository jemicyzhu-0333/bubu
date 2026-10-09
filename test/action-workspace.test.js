'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { actionPresentation } = require('../src/surfaces/popover/state/action-presentation.mjs');
const { createPanelNavigation } = require('../src/surfaces/popover/ui/panel-navigation.mjs');
const { panelPalette } = require('../src/surfaces/popover/ui/panel-palette.mjs');
const { contrastRatio } = require('../src/surfaces/popover/ui/theme-appearance.mjs');
const { nextRovingIndex } = require('../src/core/keyboard-navigation.mjs');

test('action presentation respects completed work, paused execution and unresolved landing', () => {
  const task = { title: '分享', steps: [{ title: '已做', done: true }, { title: '打开文档' }] };
  assert.deepEqual(actionPresentation({}, {}, null), { phase: 'empty', label: '从一件小事开始', action: '把脑中的一件事放下来' });
  assert.equal(actionPresentation({}, {}, null, null, { hasOpenTasks: true }).action, '从任务里换一件来做');
  assert.equal(actionPresentation({}, {}, task).action, '打开文档');
  // Without a written step the headline is still one physical action, never the title again.
  assert.equal(actionPresentation({}, {}, { title: '写周报', steps: [] }).action, '打开材料，只做第一小步');
  assert.equal(actionPresentation({}, {}, { ...task, nextAction: '只写标题' }).action, '只写标题');
  const completed = actionPresentation({}, { paused: true }, { ...task, done: true });
  assert.equal(completed.phase, 'paused');
  assert.equal(completed.action, '这件事已经做完了');
  assert.equal(actionPresentation({}, { running: true, mode: 'focus' }, task).phase, 'focus');
  assert.equal(actionPresentation({}, { running: true, mode: 'break' }, null).phase, 'break');
  assert.equal(actionPresentation({ focusLandingPrompt: { status: 'pending' } }, { running: true, mode: 'break' }, task).phase, 'landing');
  assert.equal(actionPresentation({ quickStartResolutionPending: true }, {}, task).phase, 'landing');
});

function fixture() {
  const make = (id, tab, nav) => ({ id, dataset: { tab, nav }, hidden: false, tabIndex: 0,
    attributes: {}, events: new Map(), classes: new Set(),
    classList: { toggle(name, on) { on ? this.owner.classes.add(name) : this.owner.classes.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, fn) { this.events.set(name, fn); },
    removeEventListener(name) { this.events.delete(name); },
    focus() { document.activeElement = this; }
  });
  const document = { body: { dataset: {} } };
  const tabs = [make('tabToday', 'today', 'main'), make('tabArrange', 'tasks', 'main'),
    make('tabProgress', 'progress', 'main'), make('tabTasks', 'tasks', 'arrange'), make('tabRoutines', 'routines', 'arrange')];
  const panels = ['today','tasks','routines','progress','companion'].map(tab => make('panel'+tab, tab));
  const partner = make('tabCompanion','companion');
  const plan = make('arrangeNavigation');
  const all = [...tabs,...panels,partner,plan];
  all.forEach(node => { node.classList.owner = node; });
  const $ = selector => all.find(node => '#'+node.id === selector);
  const seen = [];
  const navigation = createPanelNavigation({ document, $, $$: selector => selector === '.tab-btn' ? tabs : panels,
    nextRovingIndex, onTabShown: tab => seen.push(tab) });
  navigation.mount();
  return { $, tabs, panels, document, seen, navigation };
}

test('nested navigation retains arrangement, scopes arrows, exposes exactly one panel, and disposes', () => {
  const { $, tabs, panels, document, seen, navigation } = fixture();
  const key = (id, value) => $(id).events.get('keydown')({ key: value, preventDefault() {} });
  navigation.activate($('#tabToday'));
  key('#tabToday','ArrowRight');
  assert.equal(document.activeElement, $('#tabArrange'));
  assert.equal(document.body.dataset.destination, 'tasks');
  key('#tabTasks','ArrowRight');
  assert.equal(document.activeElement, $('#tabRoutines'));
  assert.equal(document.body.dataset.destination, 'routines');
  navigation.activate($('#tabToday'));
  navigation.activate($('#tabArrange'));
  assert.equal(document.body.dataset.destination, 'routines');
  assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.tab), ['routines']);
  assert.equal($('#tabArrange').attributes['aria-selected'], 'true');
  key('#tabArrange','End');
  assert.equal(document.activeElement, $('#tabProgress'));
  navigation.activate($('#tabCompanion'));
  assert.equal($('#arrangeNavigation').hidden, true);
  assert.equal($('#tabCompanion').attributes['aria-pressed'], 'true');
  assert.equal(tabs.filter(tab => tab.dataset.nav === 'main' && tab.tabIndex === 0).length, 1);
  assert.equal(seen.at(-1), 'companion');
  navigation.dispose();
  assert.ok([...tabs,$('#tabCompanion')].every(node => node.events.size === 0));
});

test('panel text and primary actions meet contrast in both system appearances', () => {
  for (const appearance of ['light','dark']) {
    const palette = panelPalette(appearance);
    for (const ink of ['fg0','fg1','fg2','primaryInk']) {
      for (const surface of ['bg0','bg1','bg2']) {
        assert.ok(contrastRatio(palette[ink],palette[surface]) >= 4.5, `${appearance} ${ink}/${surface}`);
      }
    }
    for (const fill of ['primary','primaryDark']) assert.ok(contrastRatio(palette.ink,palette[fill]) >= 4.5);
    // Timeline categories stay distinguishable and readable instead of collapsing into one grey.
    const categories = ['cyanInk','greenInk','blueInk','purpleInk','yellowInk'];
    assert.equal(new Set(categories.map(name => palette[name])).size, categories.length, `${appearance} category inks are distinct`);
    for (const name of categories) {
      for (const surface of ['bg1','bg2']) assert.ok(contrastRatio(palette[name],palette[surface]) >= 4.5, `${appearance} ${name}/${surface}`);
    }
  }
});
