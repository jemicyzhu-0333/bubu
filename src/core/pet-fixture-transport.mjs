import { readPresentationView } from './pet-presentation-view.mjs';

export const FIXTURE_TRANSPORT_SCOPE = 'collector-held-actor-translation-not-pointer-driven-or-OS-proof';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positive = value => Number.isSafeInteger(value) && value > 0;
// Closed, copied data only. Never invoke getters at a diagnostic boundary.
function data(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 5 || Object.getPrototypeOf(value) !== Object.prototype) throw Error('invalid-record');
  const descriptors = Object.getOwnPropertyDescriptors(value), copy = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value')) throw Error('invalid-record');
    Object.defineProperty(copy, key, { value: data(descriptors[key].value, depth + 1), enumerable: true });
  }
  return Object.freeze(copy);
}
function view(value) {
  try { return readPresentationView(data(value)); } catch { return null; }
}
function delta(value) {
  try {
    const copy = data(value);
    return copy && Object.keys(copy).sort().join(',') === 'x,y'
      && [copy.x, copy.y].every(n => Number.isFinite(n) && Math.abs(n) <= 32)
      && (copy.x !== 0 || copy.y !== 0) ? copy : null;
  } catch { return null; }
}
/** Exact observations, not requested positions or compositor acknowledgement. */
export function isPureFixtureTranslation(before, after, requestedDelta) {
  const a = view(before), b = view(after), d = delta(requestedDelta);
  return Boolean(a?.available && b?.available && d && b.revision === a.revision + 1
    && JSON.stringify(a.geometry) === JSON.stringify(b.geometry)
    && ['logicalAnchor', 'backingBounds', 'contentBounds'].every(key =>
      b[key].x - a[key].x === d.x && b[key].y - a[key].y === d.y
      && b[key].width === a[key].width && b[key].height === a[key].height));
}
export function readFixtureTranslation(value) {
  try {
    const copy = data(value);
    if (!copy || Object.keys(copy).sort().join(',') !== 'after,before,contactGeneration,delta,epoch,fromRevision,probeId,schemaVersion,scope,step,toRevision'
        || copy.schemaVersion !== 1 || copy.scope !== FIXTURE_TRANSPORT_SCOPE
        || typeof copy.probeId !== 'string' || !UUID.test(copy.probeId)
        || typeof copy.epoch !== 'string' || !UUID.test(copy.epoch) || !positive(copy.contactGeneration)
        || ![1, 2].includes(copy.step) || !positive(copy.fromRevision) || !positive(copy.toRevision)) return null;
    const before = view(copy.before), after = view(copy.after), d = delta(copy.delta), sign = copy.step === 1 ? 1 : -1;
    if (!d || d.x !== sign * 24 || d.y !== sign * 16 || !isPureFixtureTranslation(before, after, d)
        || copy.fromRevision !== before.revision || copy.toRevision !== after.revision) return null;
    return Object.freeze({ ...copy, before, after, delta: d });
  } catch { return null; }
}
export function readFixtureTransportCapability(value) {
  try {
    const copy = data(value);
    return copy && Object.keys(copy).sort().join(',') === 'available,schemaVersion,scope'
      && copy.schemaVersion === 1 && copy.scope === FIXTURE_TRANSPORT_SCOPE && copy.available === true ? copy : null;
  } catch { return null; }
}
