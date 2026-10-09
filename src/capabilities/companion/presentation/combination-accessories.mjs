'use strict';

// Render-only accessories from the already-authorized surface projection.
// They never select a primary pose or introduce another hand-held tool set.
function combinationAccessory(action, name) {
  const combination = action?.activityCombination;
  return combination?.v === 1 && combination.primary === action.id
    && Array.isArray(combination.extras) && combination.extras.includes(name);
}

function quietAccessorySample(action) {
  const opacity = ['mirror-music', 'mirror-ai'].includes(action?.id) && Number.isFinite(action?.propOpacity)
    ? Math.max(0, Math.min(1, action.propOpacity)) : 1;
  return Object.freeze({ weight: opacity, calm: true, p: .5 });
}

export { combinationAccessory, quietAccessorySample };
