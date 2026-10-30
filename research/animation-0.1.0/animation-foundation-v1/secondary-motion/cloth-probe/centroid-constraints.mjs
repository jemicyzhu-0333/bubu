import assert from 'node:assert/strict';
import * as T from 'three';

/** One owner for the isolated world's section-center constraints. A material
 * point has no rotational frame: the native attachment avoids passing a
 * singular single-point cluster through the rigid spherical-joint solver.
 * A second section at the same center connects to the first section's anchor;
 * it must not overwrite the particle's single native attachment. */
export function createCentroidConstraints(R, world, cloth, {
  particleCentroids = false, additionalPgsIterations = 12,
} = {}) {
  assert.equal(typeof particleCentroids, 'boolean');
  const points = new Map(), attached = new Map();
  let joints = 0, particleAttachments = 0, fixedReferences = 0;
  const local = (body, point) => point.clone().sub(new T.Vector3().copy(body.translation()))
    .applyQuaternion(new T.Quaternion().copy(body.rotation()).invert());
  return {
    connect(proxy, center, position, pinned) {
      const point = new T.Vector3().copy(position), anchor = local(proxy, point);
      proxy.setAdditionalSolverIterations(additionalPgsIterations);
      let support, supportAnchor = new T.Vector3();
      if (pinned) {
        support = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(point.x, point.y, point.z));
        fixedReferences++;
      } else if (particleCentroids) {
        if (!attached.has(center)) {
          cloth.attachParticle(center, proxy);
          attached.set(center, {proxy, anchor});
          particleAttachments++;
          return;
        }
        const previous = attached.get(center);
        support = previous.proxy; supportAnchor = previous.anchor;
      } else {
        if (!points.has(center)) {
          const id = world.addSoftBodyCluster(cloth, [center]);
          assert(id !== null);
          points.set(center, cloth.clusterProxy(id));
        }
        support = points.get(center);
      }
      support.setAdditionalSolverIterations(additionalPgsIterations);
      assert(world.createImpulseJoint(R.JointData.spherical(supportAnchor, anchor), support, proxy, true));
      joints++;
    },
    certificate() {
      return {joints, particleAttachments, fixedReferences,
        centroidConstraints: joints + particleAttachments, particleCentroids};
    },
  };
}
