import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createD2PointerHost } from '../body-runtime/browser-host.mjs';
import { browserPackReader } from '../../runtime-facepath05/src/pack-loader.mjs';
import { createContractCheckedMixedBindingAdapter } from '../../original-parts-hybrid-v1/runtime/mixed-binding-contract.mjs';
import { SatchelAdapter } from '../../external-assets-v1/existing-wearables/src/local-adapters/satchel-adapter.mjs';
import { createPartsSource } from './parts-source.mjs';
import { SceneBudget } from './scene-budget.mjs';
import { admitAsset } from './resource-admission.mjs';
import { bakeGroup, disposeAsset } from './asset-resources.mjs';
import { cleanupOwned } from './cleanup-owned.mjs';
import { prepareD2Bindings } from './binding-provider.mjs';
import { createFoundationRuntime } from './foundation-runtime.mjs';
import { createContactRegistry } from '../contact/admission.mjs';

const research = new URL('../../', import.meta.url);
const url = path => new URL(path, research);
export const revised = new URL('external-assets-v1', research).href;
export async function readBytes(path, limit = 32 * 1024 * 1024) {
  const response = await fetch(path);
  if (!response.ok) throw Error(`Asset unavailable: ${response.status} ${path}`);
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw Error('Encoded asset budget exceeded');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
export const readJSON = async path => JSON.parse(new TextDecoder().decode(await readBytes(path)));
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
export const sha256 = async path => hash(await readBytes(path));
const digest = text => hash(new TextEncoder().encode(text));
export async function loadGLB(path) {
  const bytes = await readBytes(path, 16000000), view = new DataView(bytes.buffer);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(12, true) > bytes.length - 20) throw Error('Invalid GLB');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
  if ((json.nodes?.length ?? 0) > 128 || (json.textures?.length ?? 0) > 4 ||
      (json.accessors ?? []).reduce((n, a) => n + a.count, 0) > 1000000 ||
      (json.buffers ?? []).some(x => x.uri || x.byteLength > 16000000) ||
      (json.images ?? []).some(x => x.uri)) throw Error('GLB budget or external resource rejection');
  const asset = (await new GLTFLoader().parseAsync(bytes.buffer, '')).scene;
  try { admitAsset(asset); return asset; }
  catch (error) { disposeAsset(asset); throw error; }
}
const sourceHash = '84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a';
const partsHash = '52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67';
export function createHybridSource(budget) {
  return createPartsSource({ budget, load: async () => {
    if (await sha256(url('original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb')) !== partsHash) throw Error('Unapproved parts');
    return loadGLB(url('original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'));
  }, measure: asset => admitAsset(asset).bytes, dispose: disposeAsset });
}
export async function createBody({ partsSource, target, camera, clock, ...options } = {}) {
  const ownsSource = !partsSource;
  partsSource ??= createHybridSource(new SceneBudget());
  const lease = await partsSource.acquire();
  let h, owner, next = 0;
  const pending = new Map();
  try {
    h = await createD2PointerHost({ ...options, target, camera,
      profile: await readJSON(url('drag-body-prototype-v1/replay/body-poses.json')),
      readPack: browserPackReader(url('runtime-facepath05/fixtures/face-d2/')),
      bodyOptions: { yawDegrees: 10 },
      scheduler: { now: () => clock.time, request: cb => { pending.set(++next, cb); return next; }, cancel: id => pending.delete(id) },
    });
    owner = createContractCheckedMixedBindingAdapter({ THREE: T,
      sourceSkin: h.body.skin, parts: lease.asset, assertSourceCurrent: () => h.owner.assertCurrent(),
      contract: await readJSON(url('original-parts-hybrid-v1/geometry/binding-manifest.json')),
      admittedSourceSHA256: sourceHash, candidateSHA256: partsHash,
    });
  } catch (error) {
    cleanupOwned([() => owner?.dispose(), () => h?.dispose(), () => lease.release(), () => { if (ownsSource) partsSource.close(); }], 'Browser body construction cleanup');
    throw error;
  }
  let disposed = false;
  return {
    f: { h, target, camera, doc: document, at: t => { clock.time = t; }, tick: t => { clock.time = t; return h.frame(t); } },
    owner, authoredFaces: options.authoredFaces ?? [],
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupOwned([() => owner.dispose(), () => h.dispose(), () => lease.release(), () => { if (ownsSource) partsSource.close(); }], 'Browser body disposal');
    },
  };
}
async function correctedSatchel(body) {
  const asset = await loadGLB(url('accessories-v1/03-satchel/satchel.glb'));
  let adapter;
  try {
    adapter = new SatchelAdapter({ actorRoot: body.f.h.owner.root, parent: body.f.h.body.offset, asset });
    adapter.update(0, { reducedMotion: true });
    return bakeGroup(adapter.root, body.f.h.body.skin.matrixWorld);
  } finally { adapter?.dispose(); disposeAsset(asset); }
}
const createD2BindingProvider = (body, anchors, admit) => prepareD2Bindings(body, anchors, admit,
  { loadGLB, revised, correctedSatchel, readJSON, sha256, digest });
export async function loadResearchContactEvidence() {
  const manifest = await readJSON(new URL('../contact/research-evidence.json', import.meta.url));
  for (const [name, expected] of Object.entries(manifest.sources))
    if (await sha256(url(name)) !== expected) throw Error(`Stale contact evidence: ${name}`);
  return { ...manifest, registry: createContactRegistry([manifest.record]) };
}
export const { FoundationPool } = createFoundationRuntime({ createBody, createHybridSource,
  loadGLB, revised, createD2BindingProvider, loadResearchContactEvidence });
