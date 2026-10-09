// Presentation only: canonical satiation keeps its fractional precision.
function displaySatiation(value) {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 0;
}

export { displaySatiation };
