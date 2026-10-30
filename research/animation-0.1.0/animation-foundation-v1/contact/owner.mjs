/** Single contact-action lease. Geometry/wear state remains owned by the caller.
 * Admission runs before any external start and again before an equip commits.
 */
export function createContactOwner({ actor, registry, readGarments }) {
  let active = null, closed = false, generation = 0, starting = false;
  const evaluate = (action, garments = readGarments()) =>
    registry.evaluate({ actor, action, garments });
  function stop(reason = "cancel") {
    generation++;
    const previous = active;
    active = null;
    previous?.handle.stop(reason);
  }
  return Object.freeze({
    check: evaluate,
    checkEquipment(garments) {
      if (closed) throw new Error("Contact owner closed");
      if (starting) throw new Error("Equipment change during contact action construction");
      return active ? evaluate(active.action, garments) : null;
    },
    begin(action, start) {
      if (closed || active || starting) throw new Error("Contact action owner unavailable");
      if (typeof start !== "function") throw new TypeError("Synchronous contact action port required");
      if (start.constructor?.name === "AsyncFunction")
        throw new TypeError("Contact action start must be synchronous");
      const decision = evaluate(action);
      if (!decision.allowed) return decision;
      const version = ++generation;
      starting = true;
      let handle;
      try {
        handle = start(decision);
        if (handle?.then) {
          // A misdeclared port may already be loading. Retire its eventual handle;
          // it never becomes the active writer.
          Promise.resolve(handle).then(late => late?.stop?.("unsupported-async-start")).catch(() => {});
          throw new TypeError("Contact action start must be synchronous");
        }
        if (typeof handle?.stop !== "function")
          throw new TypeError("Contact action must supply owned cleanup");
        if (closed || version !== generation) {
          handle.stop("stale");
          handle = null;
          throw new Error("Contact action invalidated during construction");
        }
        active = { action: decision.action, handle };
        return decision;
      } finally {
        starting = false;
      }
    },
    stop,
    snapshot() {
      return Object.freeze({ closed, active: active?.action ?? null });
    },
    dispose() {
      if (closed) return;
      closed = true;
      stop("dispose");
    },
  });
}
