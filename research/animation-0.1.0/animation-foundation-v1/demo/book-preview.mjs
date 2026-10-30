import * as T from 'three';
import { createDetachedProp } from '../secondary-motion/rapier.mjs';
/** Same bounded synthetic release as integration/verify-authored, not grasp acceptance. */
export async function createBookPreview(actor) {
  const book = actor.mounts.get('book');
  const box = new T.Box3().setFromObject(book.asset), center = box.getCenter(new T.Vector3());
  const object = new T.Group(), content = book.asset.clone(true);
  content.position.sub(center); object.add(content);
  const physics = await createDetachedProp({ object, parent:actor.mountRoot,
    halfExtents:box.getSize(new T.Vector3()).multiplyScalar(.5).toArray() });
  physics.root.visible = false;
  const pose = () => book.delta.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(...center.toArray()));
  return {
    step(time, events, reducedMotion) {
      for (const event of events.splice(0)) {
        if (event.active || reducedMotion) {
          physics.reset(time, pose()); book.root.visible = true; physics.root.visible = false;
        } else {
          physics.setHeldPose(pose()); physics.release(); book.root.visible = false; physics.root.visible = true;
        }
      }
      if (reducedMotion) { physics.reset(time, pose()); book.root.visible = true; physics.root.visible = false; }
      if (!physics.diagnostics().released) physics.setHeldPose(pose());
      physics.update({ time, paused:reducedMotion });
    },
    reset(time) { physics.reset(time, pose()); book.root.visible = true; physics.root.visible = false; },
    snapshot: () => physics.diagnostics(),
    dispose() { physics.dispose(); book.root.visible = true; },
  };
}
