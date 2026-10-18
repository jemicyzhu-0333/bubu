import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import { createAnchorRegistry } from '../registry.mjs';

const scene = new T.Group();
const source = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
const root = new T.Group();
const bones = [new T.Bone(), new T.Bone()];
bones[0].position.set(0.2, 0.1, 0);
bones[0].add(bones[1]);
bones[1].position.set(0, 0.7, 0);
scene.add(source, root, bones[0]);
scene.updateMatrixWorld(true);
const skeleton = new T.Skeleton(bones);
source.bind(skeleton);
const geometry = new T.BufferGeometry();
geometry.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0], 4));
geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([0.25, 0.75, 0, 0, 1, 0, 0, 0], 4));
const part = new T.SkinnedMesh(geometry, source.material);
part.name = 'SyntheticCarapace';
part.bind(skeleton);
root.add(part);
scene.updateMatrixWorld(true);
const descriptor = {
  id: 'synthetic-two-bone-single-part',
  boneCount: 2,
  parts: { SyntheticCarapace: { mode: 'skinned', vertexCount: 2 } },
  anchors: [{
    id: 'shell.tip', part: 'SyntheticCarapace', vertex: 0,
    position: [0, 0, 0], normal: [0, 0, 1], tangentX: [1, 0, 0],
    skinIndices: [0, 1, 0, 0], skinWeights: [0.25, 0.75, 0, 0],
    offsetBounds: [[-0.1, 0.1], [-0.1, 0.1], [0, 0.1]]
  }]
};
let revision = 0;
const options = {
  THREE: T, sourceSkin: source, hybridRoot: root, profile: descriptor,
  assertSourceCurrent() {},
  assertPoseCurrent(value) { assert.equal(value, revision); }
};
assert.throws(() => createAnchorRegistry({ ...options, profile: undefined }), /profile/);
const moved = structuredClone(descriptor);
moved.anchors[0].vertex = 1;
assert.throws(() => createAnchorRegistry({ ...options, profile: moved }), /vertex mismatch/);
const registry = createAnchorRegistry(options);
// Mutating the caller's descriptor cannot alter the admitted private definition.
descriptor.anchors[0].position[0] = 500;
registry.sampleFinalPose(0, []);
assert.throws(() => registry.getTransform('shell.tip'), /not requested/);
bones[1].rotation.z = 0.3;
scene.updateMatrixWorld(true);
revision++;
registry.sampleFinalPose(revision, ['shell.tip']);
const actual = part.getVertexPosition(0, new T.Vector3()).applyMatrix4(part.matrixWorld);
const matrix = registry.getTransform('shell.tip');
assert(actual.distanceTo(new T.Vector3().setFromMatrixPosition(matrix)) < 1e-7);
assert.throws(() => registry.sampleFinalPose(revision, ['missing']), /Unknown/);
assert.throws(() => registry.sampleFinalPose(revision, ['shell.tip', 'shell.tip']), /bounded/);
registry.dispose();
const report = {
  secondCharacter: 'two bones, one part, non-Bubu names',
  genericMechanismPass: true,
  movedVertexIndexRejected: true,
  explicitProfileRequired: true,
  descriptorMutationIsolated: true,
  requestedSubsetFailsClosed: true
};
fs.writeFileSync(new URL('../review/profile-extension.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(report);
