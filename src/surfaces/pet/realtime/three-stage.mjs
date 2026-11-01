import * as T from 'three';
import { createDesktopPointerWindow } from './pointer-window-port.mjs';
import { FoundationPool } from '../../../../research/animation-0.1.0/animation-foundation-v1/integration/browser-assets.mjs';

/** WebGL composition only; canonical state and the sole frame clock belong to the surface. */
export async function createThreeStage({ canvas, clock, environment }) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const pool = new FoundationPool({ maxActors: 1 });
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-2.5, 2.5, 4, -1, .01, 100);
  camera.position.set(0, 0, 8); camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xfff9e6, 0x718778, 2.1));
  const key = new T.DirectionalLight(0xfff9ed, 2.4); key.position.set(3, 5, 8); scene.add(key);
  const fill = new T.DirectionalLight(0xffffff, .8); fill.position.set(-3, 2, 4); scene.add(fill);
  let actor, disposed = false, renderedFrames = 0;
  const errors = [];
  renderer.debug.onShaderError = (gl, program) => { errors.push(gl.getProgramInfoLog(program) || 'shader failure'); };
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
    actor = await pool.create({ target: canvas, camera, clock, windowTarget: pointerWindow });
    scene.add(actor.scene);
    await renderer.compileAsync(scene, camera);
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
  return Object.freeze({
    update(time, policy) { actor.step(time, policy); },
    render() { renderer.render(scene, camera); if (errors.length) throw new Error(errors.join('; ')); renderedFrames++; },
    readMode: () => actor.f.h.state.mode,
    resize, suspend: () => actor.f.h.suspend(), cancel: () => actor.reset(), dispose,
    snapshot: () => ({ state: actor.f.h.state, graphics, renderedFrames, errors: [...errors],
      resources: { ...renderer.info.memory }, pool: pool.diagnostics(),
      residentScope: 'bare rendered actor; existing coordinator eagerly prepares accessory templates',
      nativePerformanceAccepted: false, contactAccepted: false })
  });
}
