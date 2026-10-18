/** Experimental presentation adapter. No body writes, physics, timers, loaders or global randomness. */
export const DEFAULT_LIMITS = Object.freeze({ maxEmitters: 4, particlesPerEmitter: 24,
  maxLifetimeSec: 3, maxRateHz: 12, maxBurst: 8, maxMaterialVariants: 4, maxDeltaSec: .05 });
export const EFFECT_IDS = Object.freeze(['leaf-stream', 'petal-stream', 'halo-sparks']);
const styles = [[0x88bb72, .016], [0xf5b3cb, .013], [0xffe9a5, .009]];
function finiteRange(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(label);
  return value;
}
const supportedComponent = value => Number.isFinite(value) && Math.abs(value) <= 10000;
const supportedOutput = value => Number.isFinite(value) && Math.abs(value) <= 1e8;
function supportedMatrix(matrix) {
  return matrix.elements.every(supportedComponent)
    && Math.abs(matrix.determinant()) > 1e-12;
}
function rng(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export function createEffectRuntime({ THREE: T, scene, limits = {}, seed = 1 }) {
  if (!T?.InstancedMesh || !scene?.isObject3D || !Number.isInteger(seed)) throw new TypeError('Three, scene and integer seed required');
  const cap = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
  for (const key of Object.keys(limits)) if (!(key in DEFAULT_LIMITS)) throw new TypeError(`Unknown limit ${key}`);
  for (const key of Object.keys(cap)) finiteRange(cap[key], .001, DEFAULT_LIMITS[key], key);
  for (const key of ['maxEmitters', 'particlesPerEmitter', 'maxBurst', 'maxMaterialVariants']) if (!Number.isInteger(cap[key])) throw new TypeError(key);
  if (cap.maxMaterialVariants < 4) throw new RangeError('Four fixed material variants required');
  const geometry = new T.PlaneGeometry(1, 1);
  const materials = styles.map(([color]) => new T.MeshBasicMaterial({ color, side: T.DoubleSide, depthTest: true, depthWrite: true }));
  const glowMaterial = new T.MeshBasicMaterial({ color: 0xffe9a5, transparent: true, opacity: .22,
    depthWrite: false, depthTest: true, blending: T.AdditiveBlending });
  const root = new T.Group(); root.name = 'BoundedAccessoryEffects'; scene.add(root);
  const matrix = new T.Matrix4(), inverseRoot = new T.Matrix4();
  const position = new T.Vector3(), scale = new T.Vector3(), rotation = new T.Quaternion();
  const axis = new T.Vector3(0, 0, 1), temporary = new T.Vector3();
  let disposed = false, lastRevision = -1, nextGeneration = 0;
  const slots = Array.from({ length: cap.maxEmitters }, () => {
    const mesh = new T.InstancedMesh(geometry, materials[0], cap.particlesPerEmitter);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; mesh.visible = false;
    const glow = new T.Mesh(geometry, glowMaterial); glow.matrixAutoUpdate = false; glow.visible = false;
    root.add(mesh, glow);
    return { mesh, glow, data: new Float64Array(cap.particlesPerEmitter * 9), state: 'disposed', generation: 0,
      anchor: null, glowSource: null, live: 0, credit: 0, elapsed: 0, matrix: new T.Matrix4() };
  });
  function active() { if (disposed) throw new Error('Effect runtime disposed'); }
  function clear(slot) { slot.data.fill(0); slot.live = 0; slot.credit = 0; slot.mesh.count = 0; }
  function release(slot) {
    if (slot.state === 'disposed') return;
    slot.generation = ++nextGeneration; clear(slot); slot.state = 'disposed'; slot.anchor = null;
    slot.glowSource = null; slot.glow.geometry = geometry; slot.mesh.visible = slot.glow.visible = false;
  }
  function sample(slot, revision) {
    // Matrix provider writes into a caller-owned target and must reject stale revisions.
    if (typeof slot.anchor === 'function') slot.anchor(slot.matrix, revision);
    else { slot.anchor.updateWorldMatrix(true, false); slot.matrix.copy(slot.anchor.matrixWorld); }
    if (!supportedMatrix(slot.matrix)) throw new Error('Invalid final-pose anchor');
  }
  function spawn(slot, count) {
    if (slot.state !== 'emitting' || slot.suppressed) return 0;
    count = Math.min(count, cap.maxBurst, slot.maxParticles - slot.live);
    const a = slot.data;
    for (let n = 0; n < count; n++) {
      let i = 0; while (a[i * 9 + 6] > 0) i++;
      const j = i * 9;
      position.set((slot.random() - .5) * .08, (slot.random() - .5) * .035, (slot.random() - .5) * .04);
      if (slot.space === 'world') position.applyMatrix4(slot.matrix);
      a[j] = position.x; a[j + 1] = position.y; a[j + 2] = position.z;
      // Authored decorative linear drift, deliberately not a physics solver.
      temporary.set((slot.random() - .5) * .035, slot.style === 2 ? .025 : -.04, (slot.random() - .5) * .02);
      if (slot.space === 'world') temporary.transformDirection(slot.matrix).multiplyScalar(slot.style === 2 ? .03 : .045);
      a[j + 3] = temporary.x; a[j + 4] = temporary.y; a[j + 5] = temporary.z;
      a[j + 6] = slot.lifetimeSec; a[j + 7] = slot.random() * Math.PI * 2; a[j + 8] = .7 + slot.random() * .6;
      slot.live++;
    }
    return count;
  }
  function draw(slot, dt) {
    const a = slot.data; let visible = 0;
    for (let i = 0; i < slot.maxParticles; i++) {
      const j = i * 9; if (a[j + 6] <= 0) continue;
      a[j + 6] -= dt;
      if (a[j + 6] <= 0) { a[j + 6] = 0; slot.live--; continue; }
      a[j] += a[j + 3] * dt; a[j + 1] += a[j + 4] * dt; a[j + 2] += a[j + 5] * dt;
      position.set(a[j], a[j + 1], a[j + 2]);
      if (slot.space === 'local') position.applyMatrix4(slot.matrix);
      position.applyMatrix4(inverseRoot);
      rotation.setFromAxisAngle(axis, a[j + 7] + slot.elapsed * .35);
      const size = styles[slot.style][1] * a[j + 8] * Math.min(1, a[j + 6] / .3);
      scale.set(size, size * (slot.style === 0 ? 1.7 : 1), size);
      matrix.compose(position, rotation, scale);
      if (!matrix.elements.every(supportedOutput)) throw new Error('Particle transform outside supported scene domain');
      slot.mesh.setMatrixAt(visible++, matrix);
    }
    slot.mesh.count = visible; slot.mesh.instanceMatrix.needsUpdate = true;
  }
  function drain(slot) {
    // Convert attached tails to detached world positions before the anchor can be removed.
    if (slot.space === 'local') {
      for (let i = 0; i < slot.maxParticles; i++) { const j = i * 9; if (slot.data[j + 6] <= 0) continue;
        position.fromArray(slot.data, j).applyMatrix4(slot.matrix).toArray(slot.data, j);
        temporary.fromArray(slot.data, j + 3); const length = temporary.length();
        temporary.transformDirection(slot.matrix).multiplyScalar(length).toArray(slot.data, j + 3); }
      slot.space = 'world';
    }
    slot.state = 'draining'; slot.anchor = null; slot.glowSource = null; slot.glow.visible = false;
    if (!slot.live) release(slot);
  }
  function enter({ effectId, anchor, space = 'world', maxParticles = cap.particlesPerEmitter,
    lifetimeSec = 2, rateHz = 3, durationSec = 60, glowMesh = null } = {}) {
    active(); const style = EFFECT_IDS.indexOf(effectId);
    if (style < 0 || !(anchor?.isObject3D || typeof anchor === 'function') || !['world', 'local'].includes(space)) throw new TypeError('Effect, final-pose anchor and space required');
    finiteRange(maxParticles, 1, cap.particlesPerEmitter, 'maxParticles');
    if (!Number.isInteger(maxParticles)) throw new TypeError('Integer particle count required');
    finiteRange(lifetimeSec, .01, cap.maxLifetimeSec, 'lifetimeSec'); finiteRange(rateHz, 0, cap.maxRateHz, 'rateHz');
    finiteRange(durationSec, 0, 3600, 'durationSec');
    if (glowMesh && (!glowMesh.isMesh || glowMesh.isSkinnedMesh || !glowMesh.geometry)) throw new TypeError('Static borrowed glow mesh required');
    const slot = slots.find(s => s.state === 'disposed'); if (!slot) return null; // Drop decorative work, never grow.
    let generation = ++nextGeneration;
    const effectSeed = seed ^ generation;
    Object.assign(slot, { generation, anchor, space, maxParticles, lifetimeSec, rateHz, durationSec, style,
      glowSource: glowMesh, elapsed: 0, suppressed: false, random: rng(effectSeed), state: 'entering' });
    clear(slot); slot.mesh.material = materials[style]; slot.mesh.visible = true;
    if (glowMesh) slot.glow.geometry = glowMesh.geometry; // Borrowed; never dispose it.
    const valid = () => !disposed && slot.generation === generation && slot.state !== 'disposed';
    return Object.freeze({
      get state() { return valid() ? slot.state : 'disposed'; },
      get generation() { return generation; },
      get liveCount() { return valid() ? slot.live : 0; },
      isCurrent(token) { return valid() && token === generation; },
      // Async completions are never attached by this module; callers check token then release stale owned loads.
      burst(count) { finiteRange(count, 0, cap.maxBurst, 'burst'); if (!Number.isInteger(count)) throw new TypeError('Integer burst'); return valid() ? spawn(slot, count) : 0; },
      stop({ immediate = true } = {}) {
        if (!valid()) return;
        if (immediate) { release(slot); return; }
        drain(slot);
      },
      reset() { if (!valid()) return false;
        if (slot.state === 'draining') { release(slot); return false; }
        generation = ++nextGeneration; slot.generation = generation;
        clear(slot); slot.elapsed = 0; slot.random = rng(effectSeed); slot.state = 'entering'; return true; },
      dispose() { if (valid()) release(slot); }
    });
  }
  function tick({ dt, poseRevision, paused = false, hidden = false, reducedMotion = false }) {
    active(); finiteRange(dt, 0, Number.MAX_VALUE, 'dt');
    if (!Number.isSafeInteger(poseRevision) || poseRevision <= lastRevision) throw new Error('Fresh final-pose revision required');
    lastRevision = poseRevision;
    root.visible = !hidden; root.updateWorldMatrix(true, false);
    if (!supportedMatrix(root.matrixWorld)) throw new Error('Invalid effect scene transform');
    inverseRoot.copy(root.matrixWorld).invert();
    if (!supportedMatrix(inverseRoot)) throw new Error('Unsupported effect scene inverse');
    const step = paused || hidden ? 0 : Math.min(dt, cap.maxDeltaSec);
    for (const slot of slots) {
      if (slot.state === 'disposed') continue;
      slot.suppressed = paused || hidden || reducedMotion;
      if (slot.anchor) sample(slot, poseRevision);
      if (slot.state === 'entering') slot.state = 'emitting';
      if (reducedMotion) clear(slot); // Immediate preference response; authored accessory stays visible.
      if (slot.glowSource) {
        slot.glowSource.updateWorldMatrix(true, false);
        if (!supportedMatrix(slot.glowSource.matrixWorld)) throw new Error('Unsupported glow transform');
        slot.glow.matrix.copy(inverseRoot).multiply(slot.glowSource.matrixWorld);
        if (!slot.glow.matrix.elements.every(supportedOutput)) throw new Error('Unsupported glow output');
        slot.glow.visible = !hidden;
      }
      if (!paused && !hidden) slot.elapsed += step;
      if (slot.state === 'emitting' && slot.elapsed >= slot.durationSec) drain(slot);
      if (slot.state === 'emitting' && !slot.suppressed) {
        slot.credit += step * slot.rateHz;
        const count = Math.min(cap.maxBurst, Math.floor(slot.credit)); slot.credit -= count; spawn(slot, count);
      } else slot.credit = 0;
      draw(slot, step);
      if (slot.state === 'draining' && slot.live === 0) release(slot);
    }
  }
  return Object.freeze({ enter, tick,
    reset() { active(); for (const slot of slots) release(slot); lastRevision = -1; },
    diagnostics() { return { disposed, liveParticles: slots.reduce((n, s) => n + s.live, 0),
      activeEmitters: slots.filter(s => s.state !== 'disposed').length,
      allocatedParticleSlots: cap.maxEmitters * cap.particlesPerEmitter,
      poolBytes: slots.reduce((n, s) => n + s.data.byteLength + s.mesh.instanceMatrix.array.byteLength, 0),
      ownedGeometries: disposed ? 0 : 1, ownedMaterials: disposed ? 0 : 4, maxDrawCalls: cap.maxEmitters * 2 }; },
    dispose() { if (disposed) return; for (const slot of slots) { release(slot); slot.mesh.dispose(); }
      root.removeFromParent(); root.clear(); geometry.dispose(); for (const material of materials) material.dispose();
      glowMaterial.dispose(); disposed = true; }
  });
}
