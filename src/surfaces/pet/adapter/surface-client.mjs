'use strict';

const PET_METHODS = Object.freeze([
  'onPetSync', 'onPetViewport', 'onPetDock', 'onPetPeek', 'onPetCue', 'onPetFeedState', 'onPetGaze', 'onPetDevtools',
  'pet_getContent', 'pet_getState', 'pet_getBounds', 'pet_getFeedState', 'pet_getContextualLine',
  'pet_setMenuOpen', 'pet_setPosition', 'pet_savePosition', 'pet_dragStart', 'pet_dragEnd',
  'pet_setState', 'pet_updateRuntime', 'pet_ackCue', 'pet_feed', 'pet_interaction',
  'pet_startFocus', 'pet_openImpulse', 'pet_openPanel', 'pet_toggleDnd', 'pet_hide'
]);

function createPetSurfaceClient(bridge = typeof window !== 'undefined' ? window.imAdhder : null) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('pet surface bridge is required');
  for (const method of PET_METHODS) {
    if (typeof bridge[method] !== 'function') throw new TypeError(`pet bridge is missing ${method}`);
  }
  return Object.freeze(Object.fromEntries(PET_METHODS.map(method => [
    method,
    (...args) => bridge[method](...args)
  ])));
}

export { createPetSurfaceClient, PET_METHODS };
