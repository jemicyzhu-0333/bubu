'use strict';

// Shell owns cross-feature chrome: theme variables, the energy meter, DND
// affordances.  It has no business commands.
function createPopoverShellFeature({ renderers } = {}) {
  const required = ['applyTheme', 'renderEnergy', 'renderDND'];
  if (!renderers || required.some(name => typeof renderers[name] !== 'function')) {
    throw new TypeError('shell feature requires its renderers');
  }

  let unsubscribe = null;

  function render(dirty = {}) {
    renderers.applyTheme();
    renderers.renderEnergy();
    renderers.renderDND();
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('shell feature requires a projection store');
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


export { createPopoverShellFeature };
