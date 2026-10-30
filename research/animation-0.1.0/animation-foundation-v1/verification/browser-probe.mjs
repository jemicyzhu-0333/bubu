/** Actual WebGL/input verification fixture. No production state or public globals. */
import * as T from "three";
import { createD2PointerHost } from "../body-runtime/browser-host.mjs";
import { browserPackReader } from "../../runtime-facepath05/src/pack-loader.mjs";

const canvas = document.querySelector("canvas");
const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(384, 384, false);
renderer.setClearColor(0, 0);
const scene = new T.Scene();
scene.add(new T.HemisphereLight(0xffffff, 0x777777, 2));
const key = new T.DirectionalLight(0xffffff, 2);
key.position.set(3, 5, 8);
scene.add(key);
const camera = new T.OrthographicCamera(-2.5, 2.5, 4, -1, 0.01, 100);
camera.position.set(0, 0, 8);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();
const profile = await fetch(
  new URL("../../drag-body-prototype-v1/replay/body-poses.json", import.meta.url),
).then(r => {
  if (!r.ok) throw Error("Body profile unavailable");
  return r.json();
});
let host, time = 0, next = 0, disposed = false;
let releasedResources = [];
const pending = new Map();
const shaderErrors = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  shaderErrors.push({
    program: gl.getProgramInfoLog(program),
    vertex: gl.getShaderInfoLog(vertex),
    fragment: gl.getShaderInfoLog(fragment),
  });
};
export async function create() {
  if (host || disposed) throw Error("Invalid browser fixture lifecycle");
  host = await createD2PointerHost({
    target: canvas, camera, profile, bodyOptions: { yawDegrees: 10 },
    readPack: browserPackReader(
      new URL("../../runtime-facepath05/fixtures/face-d2/", import.meta.url),
    ),
    scheduler: {
      now: () => time,
      request: cb => { pending.set(++next, cb); return next; },
      cancel: id => pending.delete(id),
    },
  });
  scene.add(host.body.root);
  step(0);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  return snapshot();
}
export function step(dt = 1 / 60) {
  if (!host || !Number.isFinite(dt) || dt < 0 || dt > 60)
    throw Error("Invalid browser step");
  time += dt;
  const start = performance.now();
  host.frame(time);
  const updated = performance.now();
  renderer.render(scene, camera);
  return { updateMs: updated - start, submitMs: performance.now() - updated };
}
export function point(x = 0, y = 1.4) {
  const p = new T.Vector3(x, y, 0).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
}
// Advance the injected input clock beyond the last sealed animation frame.
// DOM events remain real; their deterministic replay timestamps are explicit.
export function inputTime() { time += 0.001; }
function observeRelease(root) {
  const resources = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    const record = { name: node.name, geometry: node.geometry.uuid,
      skeleton: node.skeleton?.uuid, boneTexture: node.skeleton?.boneTexture?.uuid,
      geometryDisposed: false, boneTextureDisposed: false };
    node.geometry.addEventListener("dispose", () => { record.geometryDisposed = true; });
    node.skeleton?.boneTexture?.addEventListener("dispose", () => { record.boneTextureDisposed = true; });
    resources.push(record);
  });
  return resources;
}
export function snapshot() {
  const gl = renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    time, state: host?.state ?? null, diagnostics: host ? { ...host.diagnostics } : null,
    pendingSchedulers: pending.size,
    memory: { ...renderer.info.memory }, programs: renderer.info.programs.length,
    glError: gl.getError(), shaderErrors: structuredClone(shaderErrors),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unavailable",
    contextLost: gl.isContextLost(), dpr: devicePixelRatio,
    drawingBuffer: [canvas.width, canvas.height],
    releasedResources: structuredClone(releasedResources),
  };
}
export function release() {
  if (host) {
    const old = host;
    host = null;
    releasedResources = observeRelease(old.body.root);
    old.dispose();
    old.body.root.removeFromParent();
  }
  renderer.renderLists.dispose();
  renderer.render(scene, camera);
  return snapshot();
}
export async function frames(count = 120) {
  if (!Number.isInteger(count) || count < 1 || count > 600) throw Error("Frame cap");
  const rows = [];
  let last = performance.now();
  for (let i = 0; i < count; i++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    rows.push({ intervalMs: now - last, ...step(1 / 60) });
    last = now;
  }
  return { rows, snapshot: snapshot(), scope: "Actual RAF and WebGL; renderer identity determines hardware/software scope" };
}
export function contextLoss() { renderer.forceContextLoss(); }
export function contextRestore() { renderer.forceContextRestore(); }
export function dispose() {
  if (disposed) return;
  release();
  disposed = true;
  renderer.dispose();
}
