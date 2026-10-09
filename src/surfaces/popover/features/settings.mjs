'use strict';

// Settings and guidance/review projections share one surface lifecycle, but
// remain separate renderer callbacks.  No settings write is performed here;
// all mutations continue through the scoped client and main-process contracts.
function createPopoverSettingsFeature({ renderers } = {}) {
  const required = [
    'renderSettings', 'renderShortcutSetting', 'renderStrategyRoute', 'renderReviewCards',
    'renderDurationPicker', 'renderMigrationNotices'
  ];
  if (!renderers || required.some(name => typeof renderers[name] !== 'function')) {
    throw new TypeError('settings feature requires its renderers');
  }

  let unsubscribe = null;

  function render(dirty = {}) {
    const all = Boolean(dirty.all);
    if (all || dirty.settings) renderers.renderSettings();
    // The quick-panel group is a separate renderer because its text does not come
    // from settings at all: the effective accelerator is a runtime fact owned by
    // the main process.  A settings push only repaints the parts that are ours
    // (the enable toggle, the configured combo); the effective line is refreshed
    // by that layer after each change.
    if (all || dirty.settings) renderers.renderShortcutSetting();
    if (all || dirty.settings || dirty.strategy) renderers.renderStrategyRoute();
    if (all || dirty.reviews) renderers.renderReviewCards();
    if (all || dirty.settings || dirty.focusSession || dirty.pomodoro) {
      renderers.renderDurationPicker();
    }
    if (all || dirty.migrationNotices) renderers.renderMigrationNotices();
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('settings feature requires a projection store');
    }
    if (unsubscribe) return;
    unsubscribe = projectionStore.subscribe(change => render(change.dirty || {}));
  }

  function dispose() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
  }

  return Object.freeze({ mount, dispose, render });
}


export { createPopoverSettingsFeature };
