import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import { createEffectRuntime } from './bounded-effects.mjs';
if (!process.argv[2]) throw new Error('Provide a directory containing forest.json, sakura.json and halo.json scene snapshots');
const base = path.resolve(process.argv[2]);
const output = new URL('./renders/', import.meta.url); fs.mkdirSync(output, { recursive: true });
const p = new T.Vector3(), im = new T.Matrix4();
for (const [kind, effectId, file, anchorName] of [
  ['forest', 'leaf-stream', 'forest.json', 'forest_leaf'],
  ['sakura', 'petal-stream', 'sakura.json', 'sakura'],
  ['halo', 'halo-sparks', 'halo.json', 'halo_ring']]) {
  const source = JSON.parse(fs.readFileSync(path.join(base, file)));
  const meshes = source.frames[0].meshes;
  const sourceMesh = meshes.find(m => m.name.startsWith(anchorName));
  if (!sourceMesh) throw new Error('Actual accessory mesh not found');
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(sourceMesh.positions, 3));
  geometry.setIndex(sourceMesh.indices); geometry.computeBoundingBox();
  const scene = new T.Scene(), anchor = new T.Object3D(); geometry.boundingBox.getCenter(anchor.position);
  if (kind !== 'halo') {
    const accessory = meshes.filter(m => m.name.startsWith(kind === 'forest' ? 'forest_' : 'sakura_'));
    anchor.position.x = Math.max(...accessory.flatMap(m => m.positions.filter((_, i) => i % 3 === 0))) + .025;
  }
  else anchor.position.y = geometry.boundingBox.max.y + .015;
  scene.add(anchor);
  const glow = kind === 'halo' ? new T.Mesh(geometry, new T.MeshBasicMaterial()) : null;
  if (glow) scene.add(glow); scene.updateMatrixWorld(true);
  const runtime = createEffectRuntime({ THREE: T, scene, seed: 102 });
  const handle = runtime.enter({ effectId, anchor, glowMesh: glow, lifetimeSec: 2.8, rateHz: 4, durationSec: 30 });
  for (let i = 0; i < 150; i++) runtime.tick({ dt: 1 / 60, poseRevision: i });
  const actual = [];
  scene.getObjectByName('BoundedAccessoryEffects').traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    for (let n = 0; n < count; n++) {
      if (mesh.isInstancedMesh) mesh.getMatrixAt(n, im); else im.identity();
      im.premultiply(mesh.matrixWorld); const positions = [];
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        p.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(im); positions.push(p.x, p.y, p.z);
      }
      actual.push({ name: mesh.isInstancedMesh ? `Particle_${kind}_${n}` : 'Glow_halo', positions,
        indices: Array.from(mesh.geometry.index.array), materialColor: mesh.material.color.toArray(), opacity: mesh.material.opacity });
    }
  });
  fs.writeFileSync(new URL(`${kind}.json`, output), JSON.stringify({ ...source,
    frames: [{ label: `${kind}: actual source meshes plus bounded runtime particles; CPU render only`,
      time: 2.5, meshes: [...meshes, ...actual] }], effectEvidence: { liveCount: handle.liveCount, ...runtime.diagnostics() } }));
  runtime.dispose(); geometry.dispose(); glow?.material.dispose();
}
