import * as THREE from "three";
export const RAPIER_VERSION = "0.21.0";
let enginePromise;
/** Lazy one-world proof. Borrowed object is cloned without disposing shared geometry/material.
 * Whole book stays kinematic until explicit release(); springbone never writes this object. */
export async function createDetachedProp({
  object,
  parent,
  halfExtents = [0.2, 0.035, 0.15],
  gravity = [0, -9.81, 0],
  signal,
}) {
  if (
    !object?.isObject3D ||
    !parent?.isObject3D ||
    ![halfExtents, gravity].every(
      (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite),
    ) ||
    halfExtents.some((v) => v <= 0 || v > 3)
  )
    throw Error("Valid bounded prop required");
  if (signal?.aborted) throw Error("Cancelled before initialization");
  if (gravity.some((v) => Math.abs(v) > 100))
    throw Error("Gravity research bound exceeded");
  let nodes = 0,
    meshes = 0;
  object.traverse((o) => {
    if (++nodes > 512 || (o.isMesh && ++meshes > 64))
      throw Error("Prop hierarchy cap exceeded");
  });
  enginePromise ??= import("@dimforge/rapier3d-compat").then(async (m) => {
    await m.default.init();
    return m.default;
  });
  const R = await enginePromise;
  if (signal?.aborted) throw Error("Cancelled before world allocation");
  const world = new R.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
  world.timestep = 1 / 60;
  let root;
  try {
    const ground = world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(5, 0.05, 5).setFriction(0.7),
      ground,
    );
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased(),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(...halfExtents)
        .setFriction(0.6)
        .setRestitution(0.1),
      body,
    );
    const obstacle = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(2, 0.5, 0),
    );
    world.createCollider(R.ColliderDesc.ball(0.25), obstacle);
    root = object.clone(true);
    root.matrixAutoUpdate = false;
    parent.add(root);
    let disposed = false,
      released = false,
      last = null,
      acc = 0,
      steps = 0,
      discardedSeconds = 0,
      pausedBefore = false,
      sim = 0;
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3(1, 1, 1),
      matrix = new THREE.Matrix4(),
      local = new THREE.Matrix4();
    function guard() {
      if (disposed) throw Error("Rigid world disposed");
      parent.updateWorldMatrix(true, false);
      if (
        !parent.matrixWorld.elements.every(
          (v) => Number.isFinite(v) && Math.abs(v) <= 1e6,
        ) ||
        Math.abs(parent.matrixWorld.determinant()) < 1e-10
      )
        throw Error("Invalid parent");
    }
    function setHeldPose(m) {
      guard();
      if (released) throw Error("Released prop is solver-owned");
      if (
        !m?.elements?.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e4) ||
        Math.abs(m.determinant()) < 1e-10
      )
        throw Error("Finite held matrix required");
      m.decompose(p, q, s);
      if (
        Math.max(Math.abs(s.x - 1), Math.abs(s.y - 1), Math.abs(s.z - 1)) >
          1e-7 ||
        new THREE.Matrix4()
          .compose(p, q, s)
          .elements.some((v, i) => Math.abs(v - m.elements[i]) > 1e-7)
      )
        throw Error("Held pose must be rigid unit scale");
      body.setTranslation(p, true);
      body.setRotation(q, true);
      body.setNextKinematicTranslation(p);
      body.setNextKinematicRotation(q);
      sync();
    }
    function sync() {
      const t = body.translation(),
        r = body.rotation();
      if (
        ![t.x, t.y, t.z, r.x, r.y, r.z, r.w].every(
          (v) => Number.isFinite(v) && Math.abs(v) <= 1e5,
        )
      )
        throw Error("Invalid rigid solver output");
      matrix.compose(
        p.set(t.x, t.y, t.z),
        q.set(r.x, r.y, r.z, r.w),
        s.set(1, 1, 1),
      );
      local.copy(parent.matrixWorld).invert().multiply(matrix);
      root.matrix.copy(local);
      local.decompose(root.position, root.quaternion, root.scale);
      root.updateMatrixWorld(true);
    }
    function release() {
      guard();
      if (released) return;
      released = true;
      body.setBodyType(R.RigidBodyType.Dynamic, true);
      body.enableCcd(true);
    }
    function reset(
      time = 0,
      pose = new THREE.Matrix4().makeTranslation(0, 1, 0),
    ) {
      guard();
      if (!Number.isFinite(time)) throw Error("Finite reset time required");
      released = false;
      body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
      last = time;
      sim = time;
      acc = 0;
      pausedBefore = false;
      setHeldPose(pose);
    }
    function update({
      time,
      paused = false,
      reducedMotion = false,
      sampleObstacle,
    } = {}) {
      guard();
      if (!Number.isFinite(time)) throw Error("Finite injected time required");
      if (last === null) {
        last = time;
        sim = time;
      }
      let dt = time - last;
      last = time;
      if (dt < 0) {
        reset(time);
        return;
      }
      if (paused || reducedMotion) {
        acc = 0;
        sim = time;
        pausedBefore = true;
        return;
      }
      if (pausedBefore) {
        sim = time;
        acc = 0;
        pausedBefore = false;
        return;
      }
      const allowed = Math.min(dt, 0.1);
      discardedSeconds += dt - allowed;
      if (dt > allowed) {
        sim = time - allowed;
        acc = 0;
      }
      acc += allowed;
      let n = 0;
      while (acc + 1e-10 >= 1 / 60 && n < 6) {
        sim += 1 / 60;
        const target = sampleObstacle?.(sim);
        if (target) {
          if (
            !Array.isArray(target) ||
            target.length !== 3 ||
            !target.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e4)
          )
            throw Error("Finite kinematic obstacle target required");
          obstacle.setNextKinematicTranslation({
            x: target[0],
            y: target[1],
            z: target[2],
          });
        }
        world.step();
        acc -= 1 / 60;
        n++;
        steps++;
      }
      sync();
    }
    function diagnostics() {
      return {
        disposed,
        released,
        steps,
        discardedSeconds,
        bodies: disposed ? 0 : world.bodies.len(),
        colliders: disposed ? 0 : world.colliders.len(),
        position: disposed ? null : body.translation(),
        rotation: disposed ? null : body.rotation(),
        velocity: disposed ? null : body.linvel(),
      };
    }
    function dispose() {
      if (disposed) return;
      root.removeFromParent();
      world.free();
      disposed = true;
    }
    reset();
    return { root, setHeldPose, release, reset, update, dispose, diagnostics };
  } catch (e) {
    root?.removeFromParent();
    world.free();
    throw e;
  }
}
