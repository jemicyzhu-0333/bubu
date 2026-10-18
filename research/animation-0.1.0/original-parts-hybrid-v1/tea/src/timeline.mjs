/** Offline deterministic experiment only. Caller owns the one time value.
 * No RAF, owner, listener, runtime registration or production profile mutation. */
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
export const DURATION = 9;
export function normal(t) {
  if (!Number.isFinite(t) || t < 0)
    throw RangeError("finite nonnegative scene time");
  let handEntry = 1,
    lift = 0,
    cupScale = 1,
    phase = "hold";
  if (t < 1.2) {
    phase = "hands-enter";
    handEntry = smooth(t / 1.2);
    cupScale = 0;
  } else if (t < 1.5) {
    phase = "cup-enter";
    cupScale = smooth((t - 1.2) / 0.3);
  } else if (t < 2) {
    phase = "hold";
  } else if (t < 3.4) {
    phase = "lift";
    lift = smooth((t - 2) / 1.4);
  } else if (t < 4.8) {
    phase = "sip";
    lift = 1;
  } else if (t < 6.2) {
    phase = "return";
    lift = 1 - smooth((t - 4.8) / 1.4);
  } else if (t < 6.6) {
    phase = "hold";
  } else if (t < 6.9) {
    phase = "cup-exit";
    cupScale = 1 - smooth((t - 6.6) / 0.3);
  } else if (t < 8.1) {
    phase = "hands-exit";
    cupScale = 0;
    handEntry = 1 - smooth((t - 6.9) / 1.2);
  } else {
    phase = "rest";
    cupScale = 0;
    handEntry = 0;
  }
  return {
    time: t,
    phase,
    handEntry,
    lift,
    cupScale,
    cupOpacity: cupScale,
    faceRequestAt: 0.2,
    faceReleaseAt: 7.2,
    done: t >= DURATION,
  };
}
export function sample(t, { cancelAt = null, reducedMotion = false } = {}) {
  if (!Number.isFinite(t) || t < 0)
    throw RangeError("finite nonnegative scene time");
  if (cancelAt !== null && (!Number.isFinite(cancelAt) || cancelAt < 0))
    throw RangeError("cancel time");
  if (typeof reducedMotion !== "boolean")
    throw TypeError("reducedMotion must be boolean");
  if (reducedMotion)
    return {
      ...normal(0),
      time: t,
      phase: "reduced-motion-rest",
      faceRequestAt: null,
      faceReleaseAt: null,
      done: true,
    };
  if (cancelAt === null || t < cancelAt) return normal(t);
  if (!Number.isFinite(cancelAt) || cancelAt < 0)
    throw RangeError("cancel time");
  const at = normal(cancelAt),
    elapsed = t - cancelAt,
    fade = at.cupScale > 0 ? 0.18 : 0;
  let handEntry = at.handEntry,
    lift = at.lift,
    cupScale = at.cupScale * (1 - smooth(elapsed / Math.max(fade, 1e-9))),
    phase = "cancel-cup";
  const rewind = at.lift > 0 ? 0.32 : 0;
  if (elapsed >= fade) {
    cupScale = 0;
    if (elapsed < fade + rewind) {
      phase = "cancel-lift";
      lift = at.lift * (1 - smooth((elapsed - fade) / rewind));
    } else {
      phase = "cancel-hands";
      lift = 0;
      handEntry = at.handEntry * (1 - smooth((elapsed - fade - rewind) / 0.6));
    }
  }
  const done = elapsed >= fade + rewind + 0.6;
  if (done) {
    phase = "rest";
    handEntry = 0;
    lift = 0;
    cupScale = 0;
  }
  return {
    time: t,
    phase,
    handEntry,
    lift,
    cupScale,
    cupOpacity: cupScale,
    faceRequestAt: cancelAt < 0.2 ? null : 0.2,
    faceReleaseAt: Math.min(7.2, cancelAt + fade),
    done,
  };
}
