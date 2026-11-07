import * as T from 'three';
import { createDesktopPointerWindow } from './pointer-window-port.mjs';
import { createActorPool } from './runtime/index.mjs';
import { createEventMotionSource } from './event-motion-source.mjs';

/** WebGL composition only; canonical state and the sole frame clock belong to the surface. */
export async function createThreeStage({ canvas, clock, environment }) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const pool = createActorPool({ maxActors: 1 });
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-2.5, 2.5, 4, -1, .01, 100);
  camera.position.set(0, 0, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  scene.add(new T.HemisphereLight(0xfff9e6, 0x718778, 2.1));
  const key = new T.DirectionalLight(0xfff9ed, 2.4); key.position.set(3, 5, 8); scene.add(key);
  const fill = new T.DirectionalLight(0xffffff, .8); fill.position.set(-3, 2, 4); scene.add(fill);
  const motionSource = createEventMotionSource({ document: environment.document, target: canvas });
  let actor, disposed = false, renderedFrames = 0;
  const errors = [], construction = { actorCreateMs: null, shaderCompileWaitMs: null };
  renderer.debug.onShaderError = (gl, program) => {
    if (errors.length === 8) errors.shift();
    errors.push((gl.getProgramInfoLog(program) || 'shader failure').slice(0, 2048));
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(environment.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    const halfWidth = 2.5 * Math.max(1, rect.width) / Math.max(1, rect.height);
    camera.left = -halfWidth; camera.right = halfWidth; camera.updateProjectionMatrix();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // Independent cleanup: one throwing observer must not retain the other owner.
    const failures = [];
    for (const clean of [() => pool.dispose(), () => actor?.scene.removeFromParent(),
      () => renderer.renderLists.dispose(), () => renderer.dispose()]) {
      try { clean(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Realtime stage disposal failed');
  };
  try {
    resize();
    // A desktop window normally stays unfocused. The surface cancels capture on
    // blur; the body owner must not treat ordinary deactivation as a hidden page.
    const pointerWindow = createDesktopPointerWindow(environment.window);
    const actorStarted = environment.performance.now();
    actor = await pool.create({ target: canvas, camera, clock, windowTarget: pointerWindow, equipmentMode: 'bare', readMotionPoint: event => motionSource.read(event) });
    construction.actorCreateMs = environment.performance.now() - actorStarted;
    scene.add(actor.scene);
    const compileStarted = environment.performance.now();
    await renderer.compileAsync(scene, camera);
    construction.shaderCompileWaitMs = environment.performance.now() - compileStarted;
    if (errors.length) throw new Error(errors.join('; '));
  } catch (error) {
    try { dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Stage construction failed'); }
    throw error;
  }
  const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
  const graphics = Object.freeze({ api: 'WebGL2', three: T.REVISION,
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : 'unavailable',
    userAgent: environment.navigator.userAgent, targetHardware: 'unverified' });
  function bodyTarget() {
    if (disposed) return null;
    const rect = canvas.getBoundingClientRect();
    if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
    const projected = actor.f.h.body.skin.localToWorld(new T.Vector3(-.2, 1.4, 0)).project(camera);
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)
      || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) return null;
    const x = rect.left + (projected.x + 1) * rect.width / 2;
    const y = rect.top + (1 - projected.y) * rect.height / 2;
    if (x < 0 || y < 0 || Number.isFinite(environment.innerWidth) && x > environment.innerWidth
      || Number.isFinite(environment.innerHeight) && y > environment.innerHeight) return null;
    return { x, y };
  }
  function readDiagnostics() {
    const state = actor.f.h.state;
    return { mode: state.mode, pointerId: state.pointerId, contactGeneration: state.contactGeneration, captured: state.captured,
      interactionTailActive: actor.f.h.interactionTailActive,
      contactGenerationHighWater: actor.f.h.contactGenerationHighWater,
      pendingCount: actor.f.h.pendingCount, inputMotion: motionSource.snapshot(), renderedFrames, errors: [...errors], construction: { ...construction },
      resources: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
      pool: pool.diagnostics(), graphics: { ...graphics }, inputTargets: { body: bodyTarget() } };
  }
  return Object.freeze({
    readDiagnostics,
    readInteraction() {
      const state = actor.f.h.state;
      return { mode: state.mode, pointerId: state.pointerId, contactGeneration: state.contactGeneration,
        captured: state.captured, domCaptured: Number.isSafeInteger(state.pointerId) && canvas.hasPointerCapture(state.pointerId) };
    },
    prepareFixtureGrip(options) { return actor.f.h.prepareFixtureGrip(options); },
    readFixtureGrip(probeId) { return actor.f.h.readFixtureGrip(probeId); },
    finishFixtureGrip(probeId, { eventNotBefore } = {}) {
      const now = environment.performance.now();
      return actor.f.h.finishFixtureGrip(probeId, { eventNotBefore:
        Number.isFinite(now) && Number.isFinite(eventNotBefore) ? Math.max(now, eventNotBefore) : NaN });
    },
    cancelFixtureGrip(probeId) { return actor.f.h.cancelFixtureGrip(probeId); },
    cancelInput(contactGeneration = null) {
      if (disposed) return;
      const state = actor.f.h.state;
      if (contactGeneration === null && state.pointerId === null) actor.f.h.discardUnownedInput();
      else if (state.pointerId !== null && (contactGeneration === null || state.contactGeneration === contactGeneration)) actor.reset();
    },
    observePresentationView(value, receivedAtMs) { if (!disposed) motionSource.observeView(receivedAtMs, value?.available === true, () => actor.reset()); },
    revokePointerSpace() { if (!disposed) motionSource.revoke(() => actor.reset()); },
    setPointerSpace(value, receivedAtMs) { if (!disposed) motionSource.setSpace(value, receivedAtMs, () => actor.reset()); },
    update(time, policy) { actor.step(time, policy); },
    render() { renderer.render(scene, camera); if (errors.length) throw new Error(errors.join('; ')); renderedFrames++; },
    readMode: () => actor.f.h.state.mode,
    resize, suspend: () => actor.f.h.suspend(), cancel: () => actor.reset(), dispose,
    snapshot: () => ({ state: actor.f.h.state, graphics, renderedFrames, errors: [...errors],
      resources: { ...renderer.info.memory }, pool: pool.diagnostics(),
      residentScope: 'bare rendered actor; accessory templates not prepared',
      nativePerformanceAccepted: false, contactAccepted: false })
  });
}
