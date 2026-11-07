const finite = value => Number.isFinite(value) && Math.abs(value) <= 1e5;
export function readClientPoint(event) {
  const x = event.clientX, y = event.clientY;
  return finite(x) && finite(y) ? { x, y } : null;
}

/** The host keeps ray coordinates in CSS client space. An optional synchronous
 * adapter supplies the matching event's motion point in one stable DIP space.
 * Never use unverified screen coordinates or render-pixel/DPR arithmetic.
 * An adapter must prove the delivered event field belongs to its declared space.
 * A missing sample fails closed; switching to client coordinates mid-gesture
 * would inject a discontinuity into the inertia controller.
 */
export function createPointerCoordinateReader(readMotionPoint) {
  if (readMotionPoint !== undefined && typeof readMotionPoint !== "function")
    throw new TypeError("Motion coordinates require a synchronous event reader");
  return (event, client = readClientPoint(event)) => {
    if (!client) return null;
    const { x, y } = client;
    try {
      const motion = readMotionPoint ? readMotionPoint(event) : { x, y };
      if (!motion || Object.getPrototypeOf(motion) !== Object.prototype
        || Object.keys(motion).length !== 2
        || !Object.hasOwn(motion, "x") || !Object.hasOwn(motion, "y")) return null;
      const motionX = motion.x, motionY = motion.y;
      if (!finite(motionX) || !finite(motionY)) return null;
      // Copy once at event receipt. A retained/mutable adapter result cannot
      // change an already queued input before the actor's next frame.
      return { x, y, motionX, motionY };
    } catch {
      return null;
    }
  };
}
