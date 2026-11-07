const KEYS = ['schemaVersion', 'revision', 'available', 'logicalAnchor', 'backingBounds', 'contentBounds', 'geometry', 'stableNativeRead', 'scope'];
const SCOPE = 'native-readback-not-renderer-or-compositor-ack';
const finite = value => Number.isFinite(value) && Math.abs(value) <= 100000;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
function rect(value) {
  if (!plain(value) || Object.keys(value).length !== 4 || !['x', 'y', 'width', 'height'].every(key => finite(value[key]))
      || value.width <= 0 || value.height <= 0) return null;
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });
}
function geometry(value) {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'height,stageOffset,width'
      || !finite(value.width) || !finite(value.height) || value.width <= 0 || value.height <= 0
      || !plain(value.stageOffset) || Object.keys(value.stageOffset).sort().join(',') !== 'x,y'
      || !finite(value.stageOffset.x) || !finite(value.stageOffset.y)) return null;
  return Object.freeze({ width: value.width, height: value.height,
    stageOffset: Object.freeze({ x: value.stageOffset.x, y: value.stageOffset.y }) });
}
function copied(input) {
  const logicalAnchor = rect(input.logicalAnchor), backingBounds = rect(input.backingBounds), contentBounds = rect(input.contentBounds), geo = geometry(input.geometry);
  const stableNativeRead = input.stableNativeRead === true;
  return { schemaVersion: 1, available: Boolean(stableNativeRead && logicalAnchor && backingBounds && contentBounds && geo),
    logicalAnchor, backingBounds, contentBounds, geometry: geo, stableNativeRead, scope: SCOPE };
}
/** Pure observation identity. Logical intent is never substituted for native readback. */
export function createPresentationViewTracker() {
  let previous = null, revision = 0;
  return Object.freeze({ record(input) {
    const value = copied(input), key = JSON.stringify(value);
    if (key !== previous) { revision++; previous = key; }
    return Object.freeze({ ...value, revision });
  } });
}
export function readPresentationView(value) {
  if (!plain(value) || Object.keys(value).length !== KEYS.length || Object.keys(value).some(key => !KEYS.includes(key))
      || value.schemaVersion !== 1 || value.scope !== SCOPE || !Number.isSafeInteger(value.revision) || value.revision < 1
      || typeof value.available !== 'boolean' || typeof value.stableNativeRead !== 'boolean') return null;
  const copy = copied(value);
  if (copy.available !== value.available || ['logicalAnchor', 'backingBounds', 'contentBounds', 'geometry']
    .some(key => value[key] !== null && copy[key] === null)) return null;
  return Object.freeze({ ...copy, revision: value.revision });
}
