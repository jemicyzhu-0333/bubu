import * as T from 'three';

const clamp = T.MathUtils.clamp;
const down = new T.Vector3(0, -1, 0);
const scalp = new T.Vector3(0, 1.62766, 0);

/** A bounded, damped response to supplied pose and monotonic time. No idle clock.
 * Long gaps, replay seeks, disable and reduced motion explicitly drop momentum. */
export class SupportMotion {
  constructor({limit, stiffness, damping, gravity}) {
    Object.assign(this, {limit, stiffness, damping, gravity});
    this.value = new T.Vector2();
    this.velocity = new T.Vector2();
    this.lastPosition = new T.Vector3();
    this.lastVelocity = new T.Vector3();
    this.lastTime = null;
  }
  reset(time, position) {
    this.value.set(0, 0);
    this.velocity.set(0, 0);
    this.lastVelocity.set(0, 0, 0);
    this.lastPosition.copy(position);
    this.lastTime = time;
  }
  sample(time, position, matrixWorld, inactive) {
    if (!Number.isFinite(time)) throw new RangeError('Finite host time required');
    const dt = this.lastTime === null ? 0 : time - this.lastTime;
    if (inactive || this.lastTime === null || dt < 0 || dt > .25) {
      this.reset(time, position);
      return this.value;
    }
    if (dt === 0) return this.value;
    const inverse = matrixWorld.clone().invert();
    const gravity = down.clone().transformDirection(inverse);
    const velocity = position.clone().sub(this.lastPosition).multiplyScalar(1 / dt);
    const acceleration = velocity.clone().sub(this.lastVelocity).multiplyScalar(1 / dt);
    const rotation = new T.Matrix3().setFromMatrix4(inverse);
    acceleration.applyMatrix3(rotation);
    const target = new T.Vector2(
      clamp(gravity.x * this.gravity - clamp(acceleration.x, -10, 10) * .004, -this.limit, this.limit),
      clamp(gravity.z * this.gravity - clamp(acceleration.z, -10, 10) * .004, -this.limit, this.limit),
    );
    const steps = Math.ceil(dt * 120), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity.addScaledVector(target.clone().sub(this.value), this.stiffness * h);
      this.velocity.multiplyScalar(Math.exp(-this.damping * h));
      this.value.addScaledVector(this.velocity, h);
      for (const axis of ['x', 'y']) {
        const bounded = clamp(this.value[axis], -this.limit, this.limit);
        if (bounded !== this.value[axis]) this.velocity[axis] = 0;
        this.value[axis] = bounded;
      }
    }
    this.lastPosition.copy(position);
    this.lastVelocity.copy(velocity);
    this.lastTime = time;
    return this.value;
  }
}

/** Approved GLBs stay immutable. Each attachment owns its deformed geometry only;
 * materials/textures remain borrowed. Skin, body and face are read-only. */
export class SupportedWearable {
  constructor({actorRoot, parent, asset}, kind, motion) {
    if (!actorRoot || !parent || !asset) throw new TypeError('Actor, external parent and asset required');
    for (let p = parent; p; p = p.parent) {
      if (p === actorRoot) throw new TypeError('Accessory must be outside validated actor tree');
    }
    this.skin = actorRoot.getObjectByName('A_mochi_skin');
    if (!this.skin?.isSkinnedMesh) throw new TypeError('Approved skinned body required');
    this.parent = parent;
    this.kind = kind;
    this.disposed = false;
    this.root = new T.Group();
    this.root.name = 'Accessory_milestone.' + kind;
    this.root.add(asset.clone(true));
    parent.add(this.root);
    let best = Infinity;
    const point = new T.Vector3();
    for (let i = 0; i < this.skin.geometry.attributes.position.count; i++) {
      this.skin.getVertexPosition(i, point);
      const distance = point.distanceToSquared(scalp);
      if (distance < best) { best = distance; this.vertex = i; }
    }
    if (Math.sqrt(best) > .04) {
      this.root.removeFromParent();
      throw new Error('Unexpected approved surface anchor');
    }
    this.assetAnchor = this.skin.getVertexPosition(this.vertex, new T.Vector3());
    if (kind === 'satchel' || kind === 'scarf') {
      const desired = new T.Vector3(...(kind === 'satchel' ? [0, .55, .75] : [0, 1.12, -.73]));
      best = Infinity;
      for (let i = 0; i < this.skin.geometry.attributes.position.count; i++) {
        this.skin.getVertexPosition(i, point);
        const distance = point.distanceToSquared(desired);
        if (distance < best) { best = distance; this.vertex = i; }
      }
    }
    this.vertexLocal = this.skin.getVertexPosition(this.vertex, new T.Vector3());
    this.support = {kind:kind === 'satchel' || kind === 'scarf' ? 'torso' : 'scalp', vertex:this.vertex, sourcePosition:this.vertexLocal.toArray()};
    this.geometryUpdates = 0;
    this.geometryCacheHits = 0;
    this.motion = new SupportMotion(motion);
    this.parts = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const relative = this.root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
      const inverse = relative.clone().invert();
      mesh.geometry = mesh.geometry.clone();
      const rest = new Float64Array(mesh.geometry.attributes.position.count * 3);
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(relative).add(this.assetAnchor);
        point.toArray(rest, i * 3);
      }
      this.parts.push({mesh, rest, inverse, originalNormals: mesh.geometry.attributes.normal.array.slice()});
    });
    if (!this.parts.length || !this.parts.some(p => p.mesh.name.startsWith(kind + '_'))) {
      this.dispose();
      throw new Error('Missing approved ' + kind + ' geometry');
    }
    // Build a cross-material normal seam map once, using approved rest positions.
    this.normalGroups = new Map();
    if (kind === 'scarf') for (const part of this.parts) {
      for (let i = 0; i < part.rest.length / 3; i++) {
        const key = Array.from(part.rest.slice(i * 3, i * 3 + 3), v => Math.round(v * 1e6)).join(',');
        if (!this.normalGroups.has(key)) this.normalGroups.set(key, []);
        this.normalGroups.get(key).push([part, i]);
      }
    }
    this.update(0, {reducedMotion:true});
  }
  update(time, {enabled = true, reducedMotion = false, contacts = []} = {}) {
    if (this.disposed) throw new Error('Accessory disposed');
    if (!Number.isFinite(time)) throw new RangeError('Finite host time required');
    this.root.visible = enabled;
    this.skin.updateWorldMatrix(true, false);
    this.parent.updateWorldMatrix(true, false);
    const point = this.skin.getVertexPosition(this.vertex, new T.Vector3());
    const world = this.skin.localToWorld(point.clone());
    this.root.position.copy(this.parent.worldToLocal(world.clone()));
    const relative = this.parent.matrixWorld.clone().invert().multiply(this.skin.matrixWorld);
    relative.decompose(new T.Vector3(), this.root.quaternion, this.root.scale);
    const motion = this.motion.sample(time, world, this.skin.matrixWorld, reducedMotion || !enabled);
    const shapeKey = [motion.x, motion.y, ...contacts.flatMap(c => [...c.center, ...c.radii])].join(',');
    if (shapeKey === this.shapeKey) {
      this.geometryCacheHits++;
      this.root.updateMatrixWorld(true);
      return motion.length();
    }
    this.shapeKey = shapeKey;
    this.geometryUpdates++;
    const scratch = new T.Vector3();
    this.maxDisplacement = 0;
    for (const part of this.parts) {
      const attribute = part.mesh.geometry.attributes.position;
      for (let i = 0; i < attribute.count; i++) {
        scratch.fromArray(part.rest, i * 3);
        const ox = scratch.x, oy = scratch.y, oz = scratch.z;
        this.deform(scratch, part.mesh.name, motion, contacts);
        this.maxDisplacement = Math.max(this.maxDisplacement, Math.hypot(scratch.x - ox, scratch.y - oy, scratch.z - oz));
        scratch.sub(this.vertexLocal).applyMatrix4(part.inverse);
        attribute.setXYZ(i, scratch.x, scratch.y, scratch.z);
      }
      attribute.needsUpdate = true;
      part.mesh.geometry.computeVertexNormals();
      part.mesh.geometry.computeBoundingBox();
      part.mesh.geometry.computeBoundingSphere();
    }
    for (const group of this.normalGroups.values()) {
      if (group.length < 2) continue;
      scratch.set(0, 0, 0);
      for (const [part, i] of group) scratch.add(new T.Vector3().fromBufferAttribute(part.mesh.geometry.attributes.normal, i));
      scratch.normalize();
      for (const [part, i] of group) part.mesh.geometry.attributes.normal.setXYZ(i, scratch.x, scratch.y, scratch.z);
    }
    this.root.updateMatrixWorld(true);
    return motion.length();
  }
  surfaceContacts(meshes) {
    const inverse = this.skin.matrixWorld.clone().invert();
    const result = [];
    for (const mesh of meshes.filter(m => m.name.startsWith('Bubu_hand'))) {
      mesh.updateWorldMatrix(true, false);
      const matrix = inverse.clone().multiply(mesh.matrixWorld);
      const box = new T.Box3(), point = new T.Vector3();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, point).applyMatrix4(matrix);
        box.expandByPoint(point);
      }
      result.push({center:box.getCenter(new T.Vector3()).toArray(), radii:box.getSize(new T.Vector3()).multiplyScalar(.5).toArray()});
    }
    return result;
  }
  deform() {}
  reset(time = 0) {
    this.motion.lastTime = null;
    return this.update(time, {reducedMotion:true});
  }
  dispose() {
    if (this.disposed) return;
    for (const part of this.parts ?? []) part.mesh.geometry.dispose();
    this.parts = [];
    this.normalGroups?.clear();
    this.root.removeFromParent();
    this.root.clear();
    this.disposed = true;
  }
}

/** Soft local contact response, under the palm rather than projecting fabric
 * across it. This limited pressure envelope is not a triangle collision solver. */
export function clothPressure(point, contacts, maximum = .018) {
  let pressure = 0;
  for (const {center, radii} of contacts) {
    const d = Math.hypot((point.x - center[0]) / (radii[0] + .045),
      (point.y - center[1]) / (radii[1] + .045), (point.z - center[2]) / (radii[2] + .045));
    const u = clamp((1.25 - d) / .6, 0, 1);
    pressure = Math.max(pressure, maximum * u * u * (3 - 2 * u));
  }
  return pressure;
}
export function tighten(point, distance) {
  const r = Math.hypot(point.x, point.z / .785);
  if (r > .001) { point.x *= 1 - distance / r; point.z *= 1 - distance / r; }
}
