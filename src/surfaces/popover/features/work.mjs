'use strict';

// Work owns task/inbox projections on the popover.  Commands still go through
// the scoped surface client held by the controller; this module only decides
// which read-only projection needs repainting for a dirty state slice.
function createPopoverWorkFeature({ renderers } = {}) {
  const required = ['renderTaskList', 'renderArchivedTasks', 'renderImpulseList'];
  if (!renderers || required.some(name => typeof renderers[name] !== 'function')) {
    throw new TypeError('work feature requires its renderers');
  }

  let unsubscribe = null;

  function render(dirty = {}) {
    const all = Boolean(dirty.all);
    if (all || dirty.tasks || dirty.pomodoro || dirty.focusSession) renderers.renderTaskList();
    if (all || dirty.tasks || dirty.archivedTasks) renderers.renderArchivedTasks();
    if (all || dirty.impulses || dirty.routines) renderers.renderImpulseList();
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('work feature requires a projection store');
    }
    if (unsubscribe) return;
    unsubscribe = projectionStore.subscribe(change => {
      // Task rows translate their existing copy in place; rebuilding here would
      // discard the open overflow menu and focused control.
      if (!change.localeOnly) render(change.dirty || {});
    });
  }

  function dispose() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
  }

  return Object.freeze({ mount, dispose, render });
}


export { createPopoverWorkFeature };
