// Diagnostic-only wrappers installed before production imports. No strong references
// to images/canvases and no forced GC: otherwise the measuring tool changes ownership.
export function observeResources(host = globalThis) {
  if (typeof host.WeakRef !== 'function') return { snapshot: () => ({ supported: false }) };
  const seen = new WeakSet(), entries = new Map(), totals = {};
  let serial = 0;
  function track(object, kind) {
    if (seen.has(object)) return object;
    seen.add(object); entries.set(++serial, { reference: new host.WeakRef(object), kind });
    totals[kind] = (totals[kind] || 0) + 1;
    if (serial % 128 === 0) prune();
    return object;
  }
  function prune() {
    for (const [id, entry] of entries) if (!entry.reference.deref()) entries.delete(id);
  }
  for (const name of ['Image', 'OffscreenCanvas']) {
    const Original = host[name];
    if (typeof Original !== 'function') continue;
    host[name] = new Proxy(Original, { construct(target, args, newTarget) {
      return track(Reflect.construct(target, args, newTarget), name);
    } });
  }
  const create = host.document.createElement;
  host.document.createElement = function (...args) {
    const element = Reflect.apply(create, this, args);
    if (String(args[0]).toLowerCase() === 'canvas') track(element, 'HTMLCanvasElement');
    if (String(args[0]).toLowerCase() === 'img') track(element, 'Image');
    return element;
  };
  if (typeof host.createImageBitmap === 'function') {
    const createBitmap = host.createImageBitmap;
    host.createImageBitmap = (...args) => Reflect.apply(createBitmap, host, args)
      .then(bitmap => track(bitmap, 'ImageBitmap'));
  }
  return { snapshot() {
    prune(); const live = {}, rgbaBytesEstimate = {};
    for (const { reference, kind } of entries.values()) {
      const object = reference.deref(); if (!object) continue;
      live[kind] = (live[kind] || 0) + 1;
      const width = object.naturalWidth ?? object.width ?? 0;
      const height = object.naturalHeight ?? object.height ?? 0;
      rgbaBytesEstimate[kind] = (rgbaBytesEstimate[kind] || 0) + width * height * 4;
    }
    return { supported: true, created: { ...totals }, live, rgbaBytesEstimate,
      scope: 'Observed constructors and document.createElement only; live means not collected, not necessarily retained; byte estimates may overlap caches.' };
  } };
}
