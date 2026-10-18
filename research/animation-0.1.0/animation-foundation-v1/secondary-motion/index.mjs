import * as THREE from "three";
import {
  VRMSpringBoneManager,
  VRMSpringBoneJoint,
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere,
} from "@pixiv/three-vrm-springbone";
import { admittedState, assertMatrix } from "./asset-admission.mjs";
export { admitSecondaryAsset } from "./asset-admission.mjs";

function assertRigidWorld(matrix) {
  assertMatrix(matrix);
  const e = matrix.elements;
  if (
    Math.abs(e[0] * e[0] + e[1] * e[1] + e[2] * e[2] - 1) > 1e-6 ||
    Math.abs(e[4] * e[4] + e[5] * e[5] + e[6] * e[6] - 1) > 1e-6 ||
    Math.abs(e[8] * e[8] + e[9] * e[9] + e[10] * e[10] - 1) > 1e-6 ||
    Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) > 1e-6 ||
    Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) > 1e-6 ||
    Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) > 1e-6 ||
    Math.abs(matrix.determinant() - 1) > 1e-6 ||
    Math.abs(e[3]) > 1e-9 ||
    Math.abs(e[7]) > 1e-9 ||
    Math.abs(e[11]) > 1e-9 ||
    Math.abs(e[15] - 1) > 1e-9
  )
    throw new Error(
      "Secondary motion requires rigid unit-scale world transforms",
    );
}
function cleanupAll(operations) {
  const errors = [];
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Secondary motion cleanup failures");
}

export const ENGINE = Object.freeze({
  springbone: "3.5.5",
  three: "0.186.1",
  step: 1 / 60,
  maxSubsteps: 6,
});

/** Geometry, pins, influences and collider links must already be admitted.
 * sampleAnchor may update this private root only; it must not advance canonical animation.
 */
export function createSecondaryMotion({
  admission,
  parent,
  maxAngleRad,
  assertCurrent = () => {},
}) {
  const admitted = admittedState(admission);
  if (!parent?.isObject3D) throw new Error("Parent required");
  const profile = admitted.profile;
  const angleBound = maxAngleRad ?? profile.maxAngleRad;
  if (
    !Number.isFinite(angleBound) ||
    angleBound <= 0 ||
    angleBound > profile.maxAngleRad
  ) {
    throw new Error("Instance angle bound may only tighten admitted profile");
  }
  assertCurrent();
  parent.updateWorldMatrix(true, false);
  assertRigidWorld(parent.matrixWorld);
  const root = new THREE.Group();
  root.name = "secondary-motion";
  const manager = new VRMSpringBoneManager();
  const chains = [];
  const parts = [];
  const colliders = [];
  const flatNodes = [null];
  const inverseBinds = [new THREE.Matrix4()];
  const skinMatrices = [new THREE.Matrix4()];
  const inverseRoot = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  const accumulated = new THREE.Vector3();
  const identityRotation = new THREE.Quaternion();
  let disposed = false;
  let last = null;
  let simulationTime = 0;
  let accumulator = 0;
  let suspended = false;
  let recovering = false;
  const acceptedRotations = [null];
  const collisionDirection = new THREE.Vector3();
  const tailPosition = new THREE.Vector3();
  let atRest = true;
  const stats = {
    steps: 0,
    discardedSeconds: 0,
    resets: 0,
    maxSubsteps: 0,
    vertices: 0,
    pinnedVertices: 0,
    angleFallbacks: 0,
    contactRejects: 0,
    recoveryTicks: 0,
    deformationPasses: 0,
    normalPasses: 0,
    restCopies: 0,
  };

  function guard() {
    if (disposed) throw new Error("Secondary motion disposed");
    assertCurrent();
    parent.updateWorldMatrix(true, false);
    assertRigidWorld(parent.matrixWorld);
  }

  function validateRoot() {
    parent.updateWorldMatrix(true, false);
    assertRigidWorld(parent.matrixWorld);
    root.updateWorldMatrix(true, true);
    assertRigidWorld(root.matrixWorld);
  }

  try {
    parent.add(root);
    for (const proxy of profile.proxies) {
      const collider = new VRMSpringBoneCollider(
        new VRMSpringBoneColliderShapeSphere({
          offset: new THREE.Vector3(...proxy.center),
          radius: proxy.radius,
        }),
      );
      root.add(collider);
      colliders.push(collider);
    }
    for (let chainIndex = 0; chainIndex < profile.chains.length; chainIndex++) {
      const points = profile.chains[chainIndex];
      const nodes = points.map(() => new THREE.Object3D());
      for (let index = 0; index < nodes.length; index++) {
        nodes[index].position.fromArray(points[index]);
        if (index)
          nodes[index].position.sub(point.fromArray(points[index - 1]));
        (index ? nodes[index - 1] : root).add(nodes[index]);
        nodes[index].updateMatrix();
      }
      const selectedColliders = profile.colliderLinks[chainIndex].map(
        (index) => colliders[index],
      );
      for (let index = 0; index < nodes.length - 1; index++) {
        manager.addJoint(
          new VRMSpringBoneJoint(
            nodes[index],
            nodes[index + 1],
            {
              hitRadius: profile.radius,
              stiffness: profile.stiffness,
              dragForce: profile.dragForce,
              gravityPower: profile.gravityPower,
              gravityDir: new THREE.Vector3(0, -1, 0),
            },
            [{ colliders: selectedColliders }],
          ),
        );
      }
      chains.push(nodes);
      flatNodes.push(...nodes);
    }
    validateRoot();
    inverseRoot.copy(root.matrixWorld).invert();
    for (const node of flatNodes.slice(1)) {
      inverseBinds.push(
        new THREE.Matrix4()
          .copy(inverseRoot)
          .multiply(node.matrixWorld)
          .invert(),
      );
      skinMatrices.push(new THREE.Matrix4());
      acceptedRotations.push(node.quaternion.clone());
    }
    for (const source of admitted.parts) {
      const geometry = source.geometry.clone();
      const mesh = new THREE.Mesh(geometry, source.material);
      mesh.name = source.name;
      root.add(mesh);
      geometry.computeBoundingSphere();
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const part = {
        mesh,
        rest: geometry.attributes.position.array.slice(),
        restNormals: geometry.attributes.normal.array.slice(),
        restSphere: geometry.boundingSphere.clone(),
        indices: source.indices.slice(),
        weights: source.weights.slice(),
        pins: source.pins.slice(),
      };
      parts.push(part);
      stats.vertices += source.pins.length;
      for (const pin of source.pins) stats.pinnedVertices += pin;
    }
    manager.setInitState();
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Secondary construction and cleanup failed",
      );
    }
    throw error;
  }

  function contactSafe() {
    validateRoot();
    for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
      const nodes = chains[chainIndex];
      for (let index = 1; index < nodes.length; index++) {
        nodes[index].getWorldPosition(tailPosition);
        for (const proxyIndex of profile.colliderLinks[chainIndex]) {
          const collider = colliders[proxyIndex];
          const clearance = collider.shape.calculateCollision(
            collider.colliderMatrix,
            tailPosition,
            profile.radius,
            collisionDirection,
          );
          if (!Number.isFinite(clearance) || clearance < -1e-6) return false;
        }
      }
    }
    return true;
  }

  function restoreAccepted() {
    for (let index = 1; index < flatNodes.length; index++) {
      flatNodes[index].quaternion.copy(acceptedRotations[index]);
      flatNodes[index].updateMatrix();
    }
    validateRoot();
    if (!contactSafe())
      throw new Error(
        "Accepted chain pose no longer feasible in current frame",
      );
    // Public library API resets Verlet history at this accepted pose. No custom integrator.
    manager.setInitState();
  }

  function restoreRest() {
    if (atRest) return;
    for (const part of parts) {
      const geometry = part.mesh.geometry;
      geometry.attributes.position.array.set(part.rest);
      geometry.attributes.normal.array.set(part.restNormals);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.boundingSphere.copy(part.restSphere);
    }
    atRest = true;
    stats.restCopies++;
  }

  function deform() {
    validateRoot();
    inverseRoot.copy(root.matrixWorld).invert();
    for (let index = 1; index < flatNodes.length; index++) {
      skinMatrices[index]
        .copy(inverseRoot)
        .multiply(flatNodes[index].matrixWorld)
        .multiply(inverseBinds[index]);
    }
    for (const part of parts) {
      const geometry = part.mesh.geometry;
      const positions = geometry.attributes.position;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        if (part.pins[vertex]) continue;
        point.fromArray(part.rest, vertex * 3);
        accumulated.set(0, 0, 0);
        for (let influence = 0; influence < 4; influence++) {
          const index = vertex * 4 + influence;
          const weight = part.weights[index];
          if (weight === 0) continue;
          transformed
            .copy(point)
            .applyMatrix4(skinMatrices[part.indices[index]]);
          accumulated.addScaledVector(transformed, weight);
        }
        if (
          !Number.isFinite(accumulated.x + accumulated.y + accumulated.z) ||
          Math.max(
            Math.abs(accumulated.x),
            Math.abs(accumulated.y),
            Math.abs(accumulated.z),
          ) > 100
        ) {
          throw new Error("Invalid deformation output");
        }
        positions.setXYZ(vertex, accumulated.x, accumulated.y, accumulated.z);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      stats.normalPasses++;
    }
    stats.deformationPasses++;
    atRest = false;
  }

  function resetInternal(time = 0) {
    guard();
    if (!Number.isFinite(time)) throw new Error("Finite reset time required");
    validateRoot();
    last = time;
    simulationTime = time;
    accumulator = 0;
    recovering = false;
    for (let index = 1; index < flatNodes.length; index++) {
      flatNodes[index].quaternion.identity();
      flatNodes[index].updateMatrix();
      acceptedRotations[index].identity();
    }
    validateRoot();
    if (!contactSafe())
      throw new Error("Authored rest infeasible in current frame");
    manager.setInitState();
    restoreRest();
    stats.resets++;
  }

  function updateInternal({
    time,
    paused = false,
    reducedMotion = false,
    hidden = false,
    sampleAnchor,
  } = {}) {
    guard();
    if (!Number.isFinite(time))
      throw new Error("Finite injected time required");
    if (last === null) {
      sampleAnchor?.(time, root);
      reset(time);
    }
    const delta = time - last;
    last = time;
    if (delta < 0) {
      sampleAnchor?.(time, root);
      reset(time);
      return;
    }
    const shouldSuspend = paused || reducedMotion || hidden;
    if (shouldSuspend) {
      sampleAnchor?.(time, root);
      validateRoot();
      if (!suspended) reset(time);
      simulationTime = time;
      accumulator = 0;
      suspended = true;
      return;
    }
    if (suspended) {
      suspended = false;
      sampleAnchor?.(time, root);
      reset(time);
      return;
    }
    const allowed = Math.min(delta, ENGINE.step * ENGINE.maxSubsteps);
    stats.discardedSeconds += delta - allowed;
    if (delta > allowed) {
      simulationTime = time - allowed;
      accumulator = 0;
      restoreAccepted();
    }
    accumulator += allowed;
    let count = 0;
    let changed = false;
    while (accumulator + 1e-10 >= ENGINE.step && count < ENGINE.maxSubsteps) {
      simulationTime += ENGINE.step;
      sampleAnchor?.(simulationTime, root);
      validateRoot();
      manager.update(ENGINE.step);
      let angleSafe = true;
      for (let index = 1; index < flatNodes.length; index++) {
        if (
          flatNodes[index].quaternion.angleTo(identityRotation) > angleBound
        ) {
          angleSafe = false;
          break;
        }
      }
      const collisionSafe = contactSafe();
      if (!angleSafe || !collisionSafe) {
        restoreAccepted();
        recovering = true;
        stats.recoveryTicks++;
        if (!angleSafe) stats.angleFallbacks++;
        if (!collisionSafe) stats.contactRejects++;
      } else {
        for (let index = 1; index < flatNodes.length; index++) {
          acceptedRotations[index].copy(flatNodes[index].quaternion);
        }
        recovering = false;
        changed = true;
      }
      accumulator -= ENGINE.step;
      count++;
      stats.steps++;
    }
    stats.maxSubsteps = Math.max(stats.maxSubsteps, count);
    sampleAnchor?.(time, root);
    validateRoot();
    if (changed) deform();
  }

  function diagnostics() {
    if (!disposed) validateRoot();
    return {
      ...stats,
      disposed,
      staticFallback: false,
      recovering,
      recoveryPolicy: "last-accepted-pose-library-rebase-retry",
      atRest,
      monitoredAngleBound: angleBound,
      joints: disposed ? 0 : manager.joints.size,
      colliders: disposed ? 0 : colliders.length,
      ownedGeometries: disposed ? 0 : parts.length,
      tails: disposed
        ? []
        : chains.map((nodes) =>
            nodes.map((node) =>
              node.getWorldPosition(new THREE.Vector3()).toArray(),
            ),
          ),
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cleanupAll([
      ...[...manager.joints].map((joint) => () => manager.deleteJoint(joint)),
      ...parts.map((part) => () => part.mesh.geometry.dispose()),
      () => root.removeFromParent(),
    ]);
  }

  function failAndDispose(error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Secondary update and cleanup failed",
      );
    }
    throw error;
  }
  function reset(time = 0) {
    try {
      return resetInternal(time);
    } catch (error) {
      failAndDispose(error);
    }
  }
  function update(options) {
    try {
      return updateInternal(options);
    } catch (error) {
      failAndDispose(error);
    }
  }
  return { root, parts, chains, update, reset, dispose, diagnostics };
}
