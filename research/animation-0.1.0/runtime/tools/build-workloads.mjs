#!/usr/bin/env node
/** Deterministic mechanical geometry only. Generates packs on demand, never approved art. */
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKLOADS = Object.freeze([
  { id: 'vertices-small', axis: 'vertices', vertices: 1008, joints: 8, nodes: 64, morphTargets: 4 },
  { id: 'vertices-medium', axis: 'vertices', vertices: 12000, joints: 8, nodes: 64, morphTargets: 4 },
  { id: 'vertices-large', axis: 'vertices', vertices: 45000, joints: 8, nodes: 64, morphTargets: 4 },
  { id: 'joints-low', axis: 'joints', vertices: 12000, joints: 4, nodes: 64, morphTargets: 4 },
  { id: 'joints-high', axis: 'joints', vertices: 12000, joints: 48, nodes: 64, morphTargets: 4 },
  { id: 'nodes-low', axis: 'nodes', vertices: 12000, joints: 8, nodes: 16, morphTargets: 4 },
  { id: 'nodes-high', axis: 'nodes', vertices: 12000, joints: 8, nodes: 112, morphTargets: 4 },
  { id: 'morph-low', axis: 'morphTargets', vertices: 12000, joints: 8, nodes: 64, morphTargets: 2 },
  { id: 'morph-high', axis: 'morphTargets', vertices: 12000, joints: 8, nodes: 64, morphTargets: 16 },
  { id: 'combined-large', axis: 'combined', vertices: 45000, joints: 48, nodes: 112, morphTargets: 8 },
].map(Object.freeze));

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const faces = [
  [[1, 0, 0], [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
  [[-1, 0, 0], [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
  [[0, 1, 0], [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],
  [[0,-1,0], [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],
  [[0,0,1], [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
  [[0,0,-1], [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],
];

export function makeWorkloadGLB(w) {
  if (!Number.isInteger(w.vertices) || w.vertices % 24 || w.vertices < 24 || w.vertices > 45000 ||
      !Number.isInteger(w.joints) || w.joints < 1 || w.joints > 64 ||
      !Number.isInteger(w.nodes) || w.nodes < w.joints + 2 || w.nodes > 126 ||
      !Number.isInteger(w.morphTargets) || w.morphTargets % 2 || w.morphTargets < 2 || w.morphTargets > 16) {
    throw new RangeError('Unsupported workload dimensions');
  }
  const doc = {
    asset: { version: '2.0', generator: 'bubu deterministic mechanical workload v1' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [], buffers: [], bufferViews: [], accessors: [],
    materials: [{ name: 'Mechanical_gray', pbrMetallicRoughness: { baseColorFactor: [.4,.5,.6,1], metallicFactor: 0, roughnessFactor: .8 } }],
  };
  const chunks = [];
  let byteOffset = 0;
  function accessor(values, componentType, type) {
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const scalarBytes = componentType === 5126 ? 4 : 2;
    const padding = (4 - byteOffset % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); byteOffset += padding; }
    const bytes = Buffer.alloc(values.length * scalarBytes);
    for (let i = 0; i < values.length; i++) {
      if (componentType === 5126) bytes.writeFloatLE(values[i], i * scalarBytes);
      else bytes.writeUInt16LE(values[i], i * scalarBytes);
    }
    const bufferView = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    chunks.push(bytes); byteOffset += bytes.length;
    const a = { bufferView, componentType, count: values.length / width, type };
    if (type === 'VEC3') {
      a.min = [Infinity, Infinity, Infinity]; a.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i++) {
        const c = i % 3;
        a.min[c] = Math.min(a.min[c], values[i]); a.max[c] = Math.max(a.max[c], values[i]);
      }
    }
    const index = doc.accessors.length; doc.accessors.push(a); return index;
  }
  const positions = [], normals = [], joints = [], weights = [], indices = [];
  for (let box = 0; box < w.vertices / 24; box++) {
    const center = [(box % 25) * .04, Math.floor(box / 25) % 25 * .04, Math.floor(box / 625) * .04];
    for (const [normal, corners] of faces) {
      const start = positions.length / 3;
      for (const v of corners) {
        positions.push(...v.map((x, c) => center[c] + x * .015)); normals.push(...normal);
        joints.push(box % w.joints, 0, 0, 0); weights.push(1, 0, 0, 0);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const attributes = {
    POSITION: accessor(positions, 5126, 'VEC3'), NORMAL: accessor(normals, 5126, 'VEC3'),
    JOINTS_0: accessor(joints, 5123, 'VEC4'), WEIGHTS_0: accessor(weights, 5126, 'VEC4'),
  };
  const primitive = { attributes, indices: accessor(indices, 5123, 'SCALAR'), material: 0, targets: [] };
  for (let target = 0; target < w.morphTargets; target++) {
    const deltas = new Float32Array(w.vertices * 3);
    for (let v = 0; v < w.vertices; v++) {
      // Deterministic nonzero mechanical offsets; no face, body or performance art intent.
      deltas[v * 3 + target % 3] = ((v % 7) - 3) * .0005 * (target + 1);
    }
    primitive.targets.push({ POSITION: accessor(deltas, 5126, 'VEC3') });
  }
  const targets = Array.from({ length: w.morphTargets }, (_, i) => `Offset${i}`);
  doc.meshes.push({ name: 'Mechanical_grid', extras: { targetNames: targets }, weights: targets.map(() => 0), primitives: [primitive] });
  doc.nodes.push({ name: 'WorkloadRoot', children: Array.from({ length: w.nodes - 1 }, (_, i) => i + 1) });
  for (let i = 0; i < w.joints; i++) doc.nodes.push({ name: `Joint${i}` });
  doc.nodes.push({ name: 'MechanicalGrid', mesh: 0, skin: 0 });
  while (doc.nodes.length < w.nodes) doc.nodes.push({ name: `PassiveNode${doc.nodes.length}` });
  doc.skins = [{ joints: Array.from({ length: w.joints }, (_, i) => i + 1), inverseBindMatrices: accessor(Array.from({ length: w.joints }, () => matrix).flat(), 5126, 'MAT4') }];
  doc.buffers.push({ byteLength: byteOffset });
  const binary = Buffer.concat([...chunks, Buffer.alloc((4 - byteOffset % 4) % 4)]);
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 16 + json.length + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}

export async function buildWorkload(directory, w) {
  const glb = makeWorkloadGLB(w);
  const jointIds = Array.from({ length: w.joints }, (_, i) => `joint.${i}`);
  const profile = {
    format: 'bubu-character-profile', version: '0.1.0', id: `mechanical.${w.id}`, purpose: 'mechanics-fixture',
    coordinates: { up: '+Y', front: '+Z', unitScale: 1 },
    joints: jointIds.map((id, i) => ({ id, node: `Joint${i}`, capRadians: .2 })), sockets: [],
    expressions: {
      policy: 'single-path-via-neutral', meshes: ['MechanicalGrid'],
      paths: ['A', 'B'].map((path, side) => ({ id: `mechanical.${path}`, knots: [
        { at: 0, targets: { MechanicalGrid: {} } },
        { at: 1, targets: { MechanicalGrid: Object.fromEntries(Array.from({ length: w.morphTargets / 2 }, (_, i) => [`Offset${2 * i + side}`, 2 / w.morphTargets])) } },
      ] })),
    },
    capabilities: ['skeletal-delta', 'expression-single-path'],
    verification: { numeric: 'fixture-tests-pending', visual: 'not-art-asset', userApproval: 'not-art-asset' },
  };
  const motion = { format: 'bubu-motion', version: '0.1.0', id: 'mechanical.workloads', segments: ['A', 'B'].map((side, n) => ({
    id: `move${side}`, durationSec: 1, curve: 'smoothstep', accessories: {},
    joints: Object.fromEntries(jointIds.map((id, i) => { const angle = .16 * (n ? -1 : 1) * (i % 2 ? -1 : 1); return [id, [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]]; })),
    expression: { path: `mechanical.${side}`, intensity: 1, fadeOutSec: .5, fadeInSec: 1 },
  })) };
  const files = new Map([['mechanical.glb', glb], ['character-profile.json', encode(profile)], ['motion.json', encode(motion)]]);
  const assets = [...files].map(([path, bytes], i) => ({ id: ['body', 'profile', 'motion'][i], path, kind: ['glb', 'profile', 'motion'][i], bytes: bytes.length, sha256: hash(bytes) }));
  const manifest = {
    format: 'bubu-suite', version: '0.1.0', id: `mechanical.${w.id}`, assets,
    character: { asset: 'body', profile: 'profile' }, equipment: [], motion: 'motion',
    requiredCapabilities: ['skeletal-delta', 'expression-single-path', 'canonical-events', 'interrupt-c0', 'demand-render'],
    budgets: { totalBytes: assets.reduce((sum, a) => sum + a.bytes, 0), vertices: w.vertices, nodes: w.nodes + 2 },
  };
  files.set('manifest.json', encode(manifest));
  await mkdir(directory, { recursive: true });
  for (const [name, bytes] of files) await writeFile(join(directory, name), bytes);
  return { ...w, directory, glbBytes: glb.length, glbSha256: hash(glb), manifestSha256: hash(files.get('manifest.json')), expectedRuntimeNodes: w.nodes + 2, deformedVertices: w.vertices * (1 + w.morphTargets) };
}

export async function buildWorkloads(directory, ids = WORKLOADS.map(w => w.id)) {
  const selected = ids.map(id => { const w = WORKLOADS.find(w => w.id === id); if (!w) throw new Error(`Unknown workload: ${id}`); return w; });
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const w of selected) results.push(await buildWorkload(join(directory, w.id), w));
  await writeFile(join(directory, 'workloads.json'), encode({ format: 'bubu-mechanical-workloads-v1', workloads: results.map(({ directory, ...rest }) => rest) }));
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node tools/build-workloads.mjs [--out DIRECTORY]');
  const directory = args.length ? resolve(args[1]) : await mkdtemp(join(tmpdir(), 'bubu-workloads-'));
  const workloads = await buildWorkloads(directory);
  console.log(JSON.stringify({ directory, workloads }, null, 2));
}
