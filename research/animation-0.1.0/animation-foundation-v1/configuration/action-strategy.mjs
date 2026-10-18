import { QuaternionLane } from "../../bubu-recovery-20261017/repo-check/research/animation-0.1.0/runtime/src/timeline.mjs";
import { validateClipLibrary } from "../../bubu-recovery-20261017/repo-check/research/animation-0.1.0/runtime/src/clip-contract.mjs";
import { createSceneCoordinator } from "../../bubu-recovery-20261017/repo-check/research/animation-0.1.0/scene-coordinator-v1/src/coordinator.mjs";

const IDENTITY = [0, 0, 0, 1];
const clock = (time) => Math.round(time * 1e6);

/** Explicit application adapter. Selection belongs to SceneCoordinator, interpolation to QuaternionLane.
 * Nodes must be accessory-owned delta nodes, never body bones or final-pose mount matrices.
 * facePort enqueues into the single pointer owner's batch; it must not submit a second batch.
 */
export function createActionStrategy({
  plan,
  clipLibrary,
  nodes = new Map(),
  facePort,
  contactPort,
  effectPort,
}) {
  const configuration = plan.configuration;
  const authored = configuration.actions.filter(
    (action) => action.body === "accessory-authored",
  );
  if (!clipLibrary && authored.some((action) => action.bones.length)) {
    throw new Error("Authored clip library required");
  }
  if (clipLibrary) {
    validateClipLibrary(
      clipLibrary,
      { joints: [], capabilities: [] },
      configuration.mounts,
    );
  }
  const clips = new Map(
    (clipLibrary?.clips ?? []).map((clip) => [clip.id, clip]),
  );
  const lanes = new Map();
  for (const action of authored) {
    for (const reference of action.bones) {
      const clip = clips.get(reference.clipId);
      const track = clip?.tracks.find(
        (item) => item.target === reference.target,
      );
      if (
        !track ||
        clip.durationSec !== action.durationSec ||
        !nodes.has(reference.target)
      ) {
        throw new Error(`Unbound authored track ${reference.target}`);
      }
      if (!lanes.has(reference.target)) {
        const node = nodes.get(reference.target);
        lanes.set(reference.target, new QuaternionLane(node, node.quaternion));
      }
    }
    if (
      action.expressions.length &&
      (!facePort?.request || !facePort?.release)
    ) {
      throw new Error("Single-owner face batch port required");
    }
    if (action.contactWindows.length && typeof contactPort !== "function") {
      throw new Error("Contact lifecycle port required");
    }
    if (action.effectTracks.length && typeof effectPort !== "function") {
      throw new Error("Effect lifecycle port required");
    }
  }
  const coordinator = createSceneCoordinator(
    {
      ...plan.sceneConfig,
      backgrounds: [{ id: "action-context", approved: true, ready: true }],
    },
    { selectBackground: () => "action-context" },
  );
  // This token opens action arbitration only; it never selects or draws background artwork.
  coordinator.startFocus(
    {
      sessionId: "authored-actions",
      localDate: "2000-01-01",
      timeBand: "explicit",
      timeZone: "UTC",
      candidateIds: ["action-context"],
    },
    0,
  );
  coordinator.setSourceGeneration("interaction", 1, true, 0);
  let revision = 0;
  let lastTime = 0;
  let active = null;
  let paused = false;
  let disposed = false;
  let busy = false;
  let epoch = 0;
  let pendingFace = null;
  const consumed = new Set();
  const contacts = new Map();
  const effectIds = new Set();

  function sample(time) {
    for (const lane of lanes.values()) {
      lane.sample(time);
      lane.apply();
    }
  }

  function releasePorts(
    time,
    releaseFace = !!active?.action.expressions.length,
    immediate = false,
  ) {
    const pendingContacts = [...contacts.values()];
    const pendingEffects = [...effectIds];
    contacts.clear();
    effectIds.clear();
    const operations = [
      ...(releaseFace
        ? [
            () => {
              if (busy && !disposed && !immediate)
                pendingFace = { type: "release", time: lastTime };
              else facePort.release({ time: Math.max(time, lastTime) });
            },
          ]
        : []),
      ...pendingContacts.map(
        (contact) => () => contactPort({ ...contact, active: false, time }),
      ),
      ...pendingEffects.map(
        (effectId) => () =>
          effectPort({ effectId, event: "stop", count: 0, time }),
      ),
    ];
    const errors = [];
    for (const operation of operations) {
      try {
        operation();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Action port cleanup failed");
  }

  function exit(time) {
    if (!active) return;
    sample(time);
    const action = active.action;
    active.events = [];
    active.phase = "exit";
    active.deadline = time + action.exitSec;
    for (const reference of action.bones) {
      lanes.get(reference.target).plan(time, IDENTITY, action.exitSec);
    }
    releasePorts(time);
  }

  function enter(action, time, iteration = 1) {
    const events = [];
    const phaseStart = time + action.enterSec;
    for (const reference of action.bones) {
      const clip = clips.get(reference.clipId);
      const track = clip.tracks.find(
        (item) => item.target === reference.target,
      );
      lanes
        .get(reference.target)
        .planClip(time, track, action.durationSec, action.enterSec);
    }
    for (const expression of action.expressions) {
      events.push({
        time: phaseStart + expression.at * action.durationSec,
        type: "expression",
        value: expression,
      });
    }
    for (const contact of action.contactWindows) {
      events.push({
        time: phaseStart + contact.start * action.durationSec,
        type: "contact-start",
        value: contact,
      });
      events.push({
        time: phaseStart + contact.end * action.durationSec,
        type: "contact-end",
        value: contact,
      });
    }
    for (const effect of action.effectTracks) {
      events.push({
        time: phaseStart + effect.at * action.durationSec,
        type: "effect",
        value: effect,
      });
    }
    events.sort((a, b) => a.time - b.time);
    active = {
      action,
      phase: "active",
      iteration,
      events,
      deadline: phaseStart + action.durationSec,
    };
  }

  function dispatch(event) {
    const { value, time } = event;
    if (event.type === "expression") {
      pendingFace = {
        type: "request",
        time: lastTime,
        candidate: value.candidate,
        amount: value.amount,
        enterSec: active.action.enterSec,
        exitSec: active.action.exitSec,
      };
    } else if (event.type === "effect") {
      if (value.event === "burst") effectIds.add(value.effectId);
      else effectIds.delete(value.effectId);
      effectPort({ ...value, time });
    } else {
      const enabled = event.type === "contact-start";
      if (enabled) contacts.set(value.mountId, value);
      else contacts.delete(value.mountId);
      contactPort({ ...value, active: enabled, time });
    }
  }

  function advanceEvents(time, keys, before = false) {
    const version = epoch;
    const due = (at) => (before ? at < time : at <= time);
    while (active && due(active.deadline)) {
      while (active?.events.length) {
        dispatch(active.events.shift());
        if (version !== epoch || disposed) return;
      }
      if (!active) return;
      const boundary = active.deadline;
      sample(boundary);
      if (active.phase === "exit") {
        active = null;
      } else if (
        active.action.loop === "while-fact-active" &&
        keys.has(active.action.factKey) &&
        active.iteration < active.action.maxLoops
      ) {
        const { action, iteration } = active;
        releasePorts(boundary);
        if (version !== epoch || disposed) return;
        enter(action, boundary, iteration + 1);
      } else {
        consumed.add(active.action.factKey);
        exit(boundary);
      }
    }
    while (active?.events.length && due(active.events[0].time)) {
      dispatch(active.events.shift());
      if (version !== epoch || disposed) return;
    }
  }

  function tick(time, { facts = [], pointerMode = "idle" } = {}) {
    if (disposed || !Number.isFinite(time) || time < lastTime || time > 86400) {
      throw new Error("Active strategy and bounded monotonic time required");
    }
    if (
      !Array.isArray(facts) ||
      facts.length > 32 ||
      facts.some((key) => typeof key !== "string")
    ) {
      throw new Error("Bounded fact keys required");
    }
    if (paused) return snapshot();
    lastTime = time;
    const version = epoch;
    const keys = new Set(facts);
    if (pointerMode === "drag" || pointerMode === "landing") keys.add("drag");
    if (pointerMode === "petting" || pointerMode === "pending")
      keys.add("longpress");
    for (const key of consumed) if (!keys.has(key)) consumed.delete(key);
    const now = clock(time);
    coordinator.applySnapshots(
      [
        {
          sourceId: "interaction",
          generation: 1,
          revision: ++revision,
          facts: [...keys].map((key, i) => ({
            id: `fact-${i}`,
            key,
            observedAt: now,
            expiresAt: now + 1,
          })),
        },
      ],
      now,
    );
    const selectedId = coordinator.plan(now).mainAction;
    const selected = authored.find(
      (action) => action.id === selectedId && !consumed.has(action.factKey),
    );
    advanceEvents(time, keys, true);
    if (version !== epoch || disposed) return snapshot();
    // Interrupt at the exact input boundary before dispatching events at that boundary.
    if (active && active.action.id !== selected?.id && active.phase !== "exit")
      exit(time);
    advanceEvents(time, keys);
    if (version !== epoch || disposed) return snapshot();
    if (
      selected &&
      !consumed.has(selected.factKey) &&
      (!active || active.action.id !== selected.id)
    ) {
      if (active) exit(time);
      if (version !== epoch || disposed) return snapshot();
      enter(selected, time);
    }
    advanceEvents(time, keys);
    if (version !== epoch || disposed) return snapshot();
    if (pendingFace) {
      const { type, ...intent } = pendingFace;
      pendingFace = null;
      facePort[type](intent);
      if (version !== epoch || disposed) return snapshot();
    }
    sample(time);
    lastTime = time;
    return snapshot();
  }

  function clearOwnedState(time) {
    epoch++;
    const releaseFace = !!active?.action.expressions.length;
    active = null;
    pendingFace = null;
    consumed.clear();
    lastTime = time;
    const errors = [];
    for (const lane of lanes.values()) {
      try {
        lane.plan(time, IDENTITY, 0);
        lane.sample(time);
        lane.apply();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      releasePorts(time, releaseFace, true);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "Action cleanup failed");
  }

  function reset(time = lastTime) {
    if (disposed) throw new Error("Strategy disposed");
    if (!Number.isFinite(time) || time < lastTime || time > 86400)
      throw new Error("Monotonic reset time required");
    clearOwnedState(time);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      clearOwnedState(lastTime);
    } finally {
      lanes.clear();
    }
  }

  function guarded(operation) {
    return (...args) => {
      if (busy) throw new Error("Reentrant action strategy call");
      busy = true;
      try {
        return operation(...args);
      } catch (error) {
        try {
          dispose();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Action operation and cleanup failed",
          );
        }
        throw error;
      } finally {
        busy = false;
      }
    };
  }

  function snapshot() {
    return Object.freeze({
      actionId: active?.action.id ?? null,
      phase: active?.phase ?? "idle",
      iteration: active?.iteration ?? 0,
      queuedEvents: active?.events.length ?? 0,
      contacts: contacts.size,
      disposed,
      paused,
    });
  }

  return Object.freeze({
    tick: guarded(tick),
    reset: guarded(reset),
    snapshot,
    pause: guarded((time = lastTime) => {
      reset(time);
      paused = true;
    }),
    resume: guarded((time = lastTime) => {
      reset(time);
      paused = false;
    }),
    dispose,
  });
}
