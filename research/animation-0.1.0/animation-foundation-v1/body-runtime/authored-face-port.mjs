const tuple = (value) =>
  JSON.stringify([
    value.candidate,
    value.amount,
    value.enterSec,
    value.exitSec,
  ]);

export function admitAuthoredFaces(definitions, faceIds) {
  if (!Array.isArray(definitions) || definitions.length > 128)
    throw RangeError("Bounded authored faces required");
  const seen = new Set();
  return definitions.flatMap((value, index) => {
    if (
      !value ||
      !faceIds.includes(value.candidate) ||
      !Number.isFinite(value.amount) ||
      value.amount < 0 ||
      value.amount > 1 ||
      !Number.isFinite(value.enterSec) ||
      value.enterSec < 0.001 ||
      value.enterSec > 10 ||
      !Number.isFinite(value.exitSec) ||
      value.exitSec < 0.001 ||
      value.exitSec > 10
    ) {
      throw RangeError("Invalid authored face");
    }
    const id = tuple(value);
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        key: `authored${index}`,
        faceId: value.candidate,
        amount: value.amount,
        enterSec: value.enterSec,
        exitSec: value.exitSec,
        selectionWeight: 1,
        hold: { kind: "fixed", sec: 30 },
        gap: { kind: "fixed", sec: 0.001 },
        cooldownSec: 0,
        sources: ["testfixture"],
      },
    ];
  });
}

/** A bounded input port, not an expression owner. Only the pointer host drains it. */
export function createAuthoredFacePort(definitions) {
  const keys = new Map(
    definitions.map((value, index) => [tuple(value), `authored${index}`]),
  );
  // Match admission's first occurrence for duplicate tuples.
  definitions.forEach((value, index) => {
    if (
      definitions.findIndex((other) => tuple(other) === tuple(value)) === index
    )
      keys.set(tuple(value), `authored${index}`);
  });
  let queue = [],
    current = null,
    sealed = -Infinity,
    closed = false;
  function enqueue(value, candidate) {
    if (closed) throw Error("Authored face port disposed");
    if (!Number.isFinite(value.time) || value.time < 0 || value.time < sealed)
      throw RangeError("Stale authored face time");
    if (queue.length >= 128) throw RangeError("Authored face queue capacity");
    if (queue.length && value.time < queue.at(-1).time)
      throw RangeError("Authored face order");
    queue.push({ time: value.time, candidate });
  }
  const port = Object.freeze({
    request(value) {
      const candidate = keys.get(tuple(value));
      if (!candidate) throw RangeError("Unadmitted authored face tuple");
      if (value.time <= sealed) throw RangeError("Stale authored face time");
      enqueue(value, candidate);
    },
    release(value) {
      enqueue(value, null);
    },
    get pendingCount() {
      return queue.length;
    },
  });
  return Object.freeze({
    port,
    consume(time, pointerOwned, nextLifetime) {
      if (closed || time < sealed) throw Error("Invalid authored face batch");
      sealed = time;
      let candidate = current?.candidate ?? null;
      while (queue.length && queue[0].time <= time)
        candidate = queue.shift().candidate;
      if (pointerOwned) {
        candidate = null;
        queue = [];
      }
      const events = [];
      if (candidate !== (current?.candidate ?? null)) {
        if (current)
          events.push({
            type: "release",
            owner: "authored",
            requestId: current.requestId,
            lifetime: current.lifetime,
          });
        current = null;
        if (candidate) {
          const lifetime = nextLifetime();
          current = { candidate, lifetime, requestId: `authored${lifetime}` };
          events.push({
            type: "request",
            owner: "authored",
            ...current,
            holdMode: "restart",
          });
        }
      }
      return { events, active: current !== null };
    },
    reset() {
      queue = [];
      current = null;
    },
    dispose() {
      queue = [];
      current = null;
      closed = true;
    },
    get pendingCount() {
      return queue.length;
    },
  });
}
