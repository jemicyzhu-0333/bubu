export const INPUT_LEASE_SCOPE = 'bounded-pass-through-override-not-OS-capture';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_KEYS = ['schemaVersion', 'epoch', 'viewRevision', 'available', 'ttlMs', 'renewMs', 'scope'];
const REQUEST_KEYS = ['schemaVersion', 'epoch', 'viewRevision', 'contactGeneration', 'sequence', 'phase'];
const positive = value => Number.isSafeInteger(value) && value > 0;
// Copy only closed data records. Accessor values are never invoked; symbols
// and malformed or throwing records are refused at the wire boundary.
function record(value, keys) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const copy = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch { return null; }
}
export function readInputLeaseCapability(value) {
  const copy = record(value, CAPABILITY_KEYS);
  if (!copy || copy.schemaVersion !== 1 || typeof copy.epoch !== 'string' || !UUID_V4.test(copy.epoch)
      || !Number.isSafeInteger(copy.viewRevision) || copy.viewRevision < 0 || typeof copy.available !== 'boolean'
      || (copy.available && copy.viewRevision === 0) || copy.ttlMs !== 300 || copy.renewMs !== 100
      || copy.scope !== INPUT_LEASE_SCOPE) return null;
  return Object.freeze(copy);
}
export function readInputLeaseRequest(value) {
  const copy = record(value, REQUEST_KEYS);
  if (!copy || copy.schemaVersion !== 1 || typeof copy.epoch !== 'string' || !UUID_V4.test(copy.epoch)
      || !positive(copy.viewRevision) || !positive(copy.contactGeneration) || !positive(copy.sequence)
      || !['begin', 'renew', 'end'].includes(copy.phase)) return null;
  return Object.freeze(copy);
}
