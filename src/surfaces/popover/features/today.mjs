'use strict';

// Today owns the execution loop projection.  It deliberately receives render
// callbacks instead of reaching into the legacy controller's state; this keeps
// the migration seam explicit while the remaining Today interaction code is
// moved out in smaller, behavior-preserving slices.
function createPopoverTodayFeature({ renderers } = {}) {
  const required = [
    'renderHeader', 'renderPomoStructure', 'renderPomoTick',
    'renderNowCard', 'renderNowTaskDetail', 'renderLanding'
  ];
  if (!renderers || required.some(name => typeof renderers[name] !== 'function')) {
    throw new TypeError('today feature requires its renderers');
  }

  let unsubscribe = null;

  function render(dirty = {}) {
    const all = Boolean(dirty.all);
    if (all || dirty.pomodoro || dirty.tasks || dirty.nowTask || dirty.recommendations || dirty.settings) {
      renderers.renderHeader();
      renderers.renderPomoStructure();
      renderers.renderPomoTick();
    } else if (dirty.stats) {
      renderers.renderHeader();
    }
    if (all || dirty.tasks || dirty.pomodoro || dirty.focusSession || dirty.recommendations || dirty.settings) {
      renderers.renderNowCard();
    }
    if (all || dirty.tasks || dirty.pomodoro || dirty.focusSession || dirty.recommendations) {
      renderers.renderNowTaskDetail();
    }
    if (all || dirty.tasks || dirty.focusSession || dirty.recommendations || dirty.pomodoro) {
      renderers.renderLanding();
    }
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('today feature requires a projection store');
    }
    if (unsubscribe) return;
    unsubscribe = projectionStore.subscribe(change => {
      if (change.localeOnly) {
        renderers.renderHeader(); renderers.renderPomoStructure({ copyOnly: true }); renderers.renderPomoTick();
        renderers.renderNowCard(); renderers.renderNowTaskDetail({ copyOnly: true });
        return; // A copy change must not reopen or reset a landing decision.
      }
      render(change.dirty || {});
    });
  }

  function dispose() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
  }

  return Object.freeze({ mount, dispose, render });
}


export { createPopoverTodayFeature };
