// Isolated diagnostic only. No artist registration, app state, or animation timer.
const MAX_FRAMES = 8;
const MAX_DECODED_BYTES = 8 * 512 * 512 * 4;
const finite = value => Number.isFinite(value);
const mod = (value, period) => ((value % period) + period) % period;

export function validateSequence(input) {
  if (!input || !Number.isInteger(input.width) || !Number.isInteger(input.height)
    || input.width < 1 || input.height < 1
    || input.width * input.height * MAX_FRAMES * 4 > MAX_DECODED_BYTES) {
    throw new RangeError('Sequence dimensions exceed the eight-frame decode budget');
  }
  if (!Array.isArray(input.frames) || input.frames.length !== MAX_FRAMES
    || input.frames.some(frame => typeof frame.src !== 'string' || !frame.src
      || !finite(frame.durationMs) || frame.durationMs <= 0)
    || new Set(input.frames.map(frame => frame.src)).size !== MAX_FRAMES) {
    throw new TypeError('Exactly eight distinct authored frame sources are required');
  }
  if (!Array.isArray(input.anchor) || input.anchor.length !== 2 || !input.anchor.every(finite)) {
    throw new TypeError('One shared anchor is required');
  }
  const loopMs = input.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  if (!finite(input.loopMs) || Math.abs(loopMs - input.loopMs) > .001) {
    throw new RangeError('Frame durations must sum to loopMs');
  }
  if (input.holdPhase !== undefined && (!finite(input.holdPhase) || input.holdPhase < 0 || input.holdPhase >= 1)) {
    throw new RangeError('holdPhase must be in [0, 1)');
  }
  return Object.freeze({ ...input, anchor: Object.freeze([...input.anchor]),
    frames: Object.freeze(input.frames.map(frame => Object.freeze({ ...frame }))) });
}

export function sampleFrame(manifest, elapsedMs, { reducedMotion = false } = {}) {
  if (!finite(elapsedMs)) throw new TypeError('The caller supplies finite absolute elapsed time');
  const phaseMs = reducedMotion ? (manifest.holdPhase ?? .5) * manifest.loopMs : mod(elapsedMs, manifest.loopMs);
  let endMs = 0;
  const index = manifest.frames.findIndex(frame => { endMs += frame.durationMs; return phaseMs < endMs; });
  return Object.freeze({ index: index < 0 ? manifest.frames.length - 1 : index,
    phase: phaseMs / manifest.loopMs });
}

// One canonical-derived transform for the whole sequence. Never inspect each
// frame's alpha bounds to re-center, re-scale, or pin a moving foot to the floor.
export function sequenceTransform(manifest, { x, y, referenceHeight }) {
  const bounds = manifest.referenceBounds;
  const height = Array.isArray(bounds) ? bounds[3] : bounds?.height;
  if (![x, y, referenceHeight, height].every(finite) || referenceHeight <= 0 || height <= 0) {
    throw new TypeError('Canonical reference bounds and target height are required');
  }
  const scale = referenceHeight / height;
  return Object.freeze({ x: x - manifest.anchor[0] * scale,
    y: y - manifest.anchor[1] * scale, scale });
}

export function createSequencePlayer(input, { loadImage, releaseImage = image => image.close?.() } = {}) {
  const manifest = validateSequence(input);
  if (typeof loadImage !== 'function') throw new TypeError('An image-loading port is required');
  const images = Array(MAX_FRAMES).fill(null), failures = [];
  let status = 'idle', loading = null, disposed = false, pending = 0;
  const listeners = new Set();
  const snapshot = () => Object.freeze({ status, ready: status === 'ready', pending,
    failed: failures.length, failures: Object.freeze([...failures]),
    frameCount: images.filter(Boolean).length,
    decodedBytes: images.filter(Boolean).length * manifest.width * manifest.height * 4,
    capacity: MAX_FRAMES, maxDecodedBytes: MAX_DECODED_BYTES });
  const notify = () => { for (const listener of listeners) listener(snapshot()); };
  function prepare() {
    if (disposed) return Promise.resolve(snapshot());
    if (loading) return loading;
    status = 'loading'; pending = MAX_FRAMES;
    loading = Promise.all(manifest.frames.map(async (frame, index) => {
      let image;
      try {
        image = await loadImage(frame.src);
        if (!image || image.width !== manifest.width || image.height !== manifest.height) {
          throw new RangeError(`Frame ${index} must use the common ${manifest.width}x${manifest.height} canvas`);
        }
        if (disposed) releaseImage(image);
        else images[index] = image;
      } catch (error) {
        if (image) releaseImage(image);
        if (!disposed) failures.push(Object.freeze({ index, src: frame.src, message: String(error.message || error) }));
      } finally { pending--; }
    })).then(() => {
      if (!disposed) { status = failures.length ? 'failed' : 'ready'; notify(); }
      return snapshot();
    });
    notify();
    return loading;
  }
  function draw(context, elapsedMs, transform, options = {}) {
    const sample = sampleFrame(manifest, elapsedMs, options);
    if (status !== 'ready') return Object.freeze({ ...sample, painted: false, status });
    if (![transform?.x, transform?.y, transform?.scale].every(finite) || transform.scale <= 0) {
      throw new TypeError('A fixed positive transform is required');
    }
    context.drawImage(images[sample.index], transform.x, transform.y,
      manifest.width * transform.scale, manifest.height * transform.scale);
    return Object.freeze({ ...sample, painted: true, status });
  }
  function dispose() {
    if (disposed) return;
    disposed = true; status = 'disposed';
    for (let index = 0; index < images.length; index++) {
      if (images[index]) releaseImage(images[index]);
      images[index] = null;
    }
    listeners.clear();
  }
  return Object.freeze({ manifest, prepare, draw, snapshot, dispose,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener); return () => listeners.delete(listener);
    } });
}
