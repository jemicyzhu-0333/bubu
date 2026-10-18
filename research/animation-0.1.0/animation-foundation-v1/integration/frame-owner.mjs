/** Orders one frame without owning any character, asset loader, or solver implementation. */
export function createFrameOwner({
  advanceBody,
  finalizeBody,
  sampleAnchors,
  updateAttachments,
  updateEffects,
  render,
  initialTime = 0,
}) {
  const ports = [
    advanceBody,
    finalizeBody,
    sampleAnchors,
    updateAttachments,
    updateEffects,
    render,
  ];
  if (ports.some((port) => typeof port !== "function"))
    throw new TypeError("Complete frame ports required");
  let time = initialTime;
  let revision = 0;
  let disposed = false;
  let stepping = false;
  let trace = [];

  function step(nextTime, policy = {}) {
    if (disposed) throw new Error("Frame owner disposed");
    if (stepping) throw new Error("Reentrant frame update");
    if (!Number.isFinite(nextTime))
      throw new TypeError("Finite injected host time required");
    stepping = true;
    trace = [];
    try {
      trace.push("body");
      const state = advanceBody(nextTime);
      finalizeBody();
      revision += 1;
      const frame = Object.freeze({
        time: nextTime,
        previousTime: time,
        dt: nextTime - time,
        revision,
        policy,
      });
      trace.push("anchors");
      sampleAnchors(frame);
      trace.push("secondary");
      updateAttachments(frame);
      trace.push("accessory-transforms");
      trace.push("effects");
      updateEffects(frame);
      trace.push("render");
      render(frame);
      time = nextTime;
      return state;
    } catch (error) {
      disposed = true;
      throw error;
    } finally {
      stepping = false;
    }
  }

  return Object.freeze({
    step,
    assertRevision(candidate) {
      if (disposed || candidate !== revision)
        throw new Error("Stale pose revision");
    },
    get time() {
      return time;
    },
    get revision() {
      return revision;
    },
    get trace() {
      return [...trace];
    },
    dispose() {
      disposed = true;
    },
  });
}
