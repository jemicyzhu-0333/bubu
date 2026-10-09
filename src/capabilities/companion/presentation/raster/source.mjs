'use strict';

// Browser ownership stays here; injected loaders let the exact production
// painter run in Skia tests without DOM globals or a second renderer.
function browserImageLoader(src, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof Image !== 'function') { reject(new Error('image loading unavailable')); return; }
    const image = new Image();
    let settled = false;
    const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
    const finish = (error = null) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else resolve(image);
    };
    const abort = () => { finish(new Error('image load cancelled')); image.src = ''; };
    image.onload = () => finish();
    image.onerror = () => finish(new Error(`raster image failed: ${src}`));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    image.src = src;
  });
}

function createRasterSource({ baseUrl, loadImage = browserImageLoader, maxEntries = 512,
  maxBytes = 96 * 1024 * 1024, versionKey = null } = {}) {
  if (typeof baseUrl !== 'string' || typeof loadImage !== 'function') throw new TypeError('raster source needs a base and loader');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !(maxBytes > 0)) throw new TypeError('invalid raster cache budget');
  const entries = new Map(), listeners = new Set();
  let bytes = 0, revision = 0, disposed = false;
  const release = image => image?.close?.();
  const emit = () => {
    revision += 1;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* A detached preview cannot poison a decoded image. */ }
    }
  };
  function remove(key) {
    const entry = entries.get(key); if (!entry) return;
    entries.delete(key); bytes -= entry.bytes;
    entry.controller.abort(); release(entry.image);
  }
  function trim(keep) {
    while (entries.size > maxEntries || bytes > maxBytes) {
      const key = [...entries.keys()].find(candidate => candidate !== keep);
      if (!key) break;
      remove(key);
    }
  }
  function request(sprite) {
    if (!sprite || disposed) return null;
    const url = new URL(sprite.src, baseUrl);
    if (versionKey) url.searchParams.set('v', String(versionKey));
    const key = url.href;
    let entry = entries.get(key);
    if (entry) { entries.delete(key); entries.set(key, entry); return entry; }
    entry = { key, state: 'loading', image: null, bytes: 0, error: null, controller: new AbortController() };
    entries.set(key, entry); trim(key);
    const cancelled = new Promise(resolve => entry.controller.signal.addEventListener('abort', () => resolve(null), { once: true }));
    const loading = Promise.resolve().then(() => loadImage(key, { signal: entry.controller.signal })).then(image => {
      if (disposed || entries.get(key) !== entry) { release(image); return null; }
      return image;
    });
    entry.promise = Promise.race([loading, cancelled]).then(image => {
      if (disposed || entries.get(key) !== entry) return null;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      const cost = width * height * 4;
      if (!(width > 0 && height > 0) || !Number.isFinite(cost) || cost > maxBytes) {
        release(image); throw new Error('decoded raster exceeds budget or is empty');
      }
      entry.state = 'ready'; entry.image = image; entry.bytes = cost; bytes += cost;
      trim(key); emit(); return image;
    }).catch(error => {
      if (!disposed && entries.get(key) === entry) { entry.state = 'failed'; entry.error = String(error?.message || error); emit(); }
      return null;
    });
    return entry;
  }
  return Object.freeze({
    get(sprite) { return request(sprite)?.image || null; },
    state(sprite) { return request(sprite)?.state || 'disposed'; },
    ready(sprites) { return Promise.all(sprites.filter(Boolean).map(sprite => request(sprite)?.promise || null)); },
    subscribe(listener) {
      if (typeof listener !== 'function' || disposed) return () => {};
      listeners.add(listener); return () => listeners.delete(listener);
    },
    stats() { return Object.freeze({ entries: entries.size, bytes, revision, disposed,
      loading: [...entries.values()].filter(entry => entry.state === 'loading').length,
      failed: [...entries.values()].filter(entry => entry.state === 'failed').length }); },
    dispose() { if (disposed) return; disposed = true; listeners.clear(); for (const key of [...entries.keys()]) remove(key); }
  });
}

export { browserImageLoader, createRasterSource };
