// ARCHITECTURE「分层与能力」: pure admission; existing scene, pointer and face owners remain authoritative.
export class ConfigurationError extends Error {
  constructor(code, path) {
    super(`${code}: ${typeof path === "string" ? path : "configuration"}`);
    this.code = code;
  }
}
const requireThat = (ok, code, path) => {
  if (!ok) throw new ConfigurationError(code, path);
};
const exact = (v, keys, path) =>
  requireThat(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Object.keys(v).length === keys.length &&
      keys.every(
        (k) =>
          Object.hasOwn(v, k) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
    "FIELDS",
    path,
  );
const number = (v, min, max, path) =>
  requireThat(Number.isFinite(v) && v >= min && v <= max, "NUMBER", path);
const id = (v, path) =>
  requireThat(typeof v === "string" && /^[\w.:-]{1,128}$/.test(v), "ID", path);
const list = (v, max, path) => {
  requireThat(Array.isArray(v) && v.length <= max, "LIST", path);
  requireThat(Object.keys(v).length === v.length, "LIST_FIELDS", path);
  for (let i = 0; i < v.length; i++)
    requireThat(
      Object.hasOwn(v, i) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(v, String(i)), "value"),
      "LIST_FIELDS",
      path,
    );
};
const member = (v, choices, path) =>
  requireThat(choices.includes(v), "VALUE", path);
const unique = (v, path) =>
  requireThat(new Set(v).size === v.length, "DUPLICATE", path);
function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export const POINTER_LIFECYCLE = Object.freeze({
  owner: "shared-input-workbench-v2",
  drag: "continuous",
  longpress: "continuous",
  cancel: "synthetic-release",
  lostcapture: "synthetic-release",
  blur: "suspend-reset",
  hidden: "suspend-reset",
  resume: "fresh-input",
  dispose: "release-and-clear",
});
export const LIFECYCLE = Object.freeze({
  enter: "capture-current",
  loop: "while-owned",
  exit: "bounded-recovery",
  pause: "suspend-reset-no-catchup",
  reset: "neutral-and-clear",
  dispose: "release-and-clear",
  cleanupSec: 3,
});

/** Returns immutable declarative extensions, not an actor, timer, scheduler or persistence owner. */
export function compileActionConfiguration(
  raw,
  { anchorIds, catalogue, clipIds = [], faceIds = [] } = {},
) {
  const c = raw; // Validate bounded, closed fields before allocating the admitted snapshot.
  exact(
    c,
    [
      "format",
      "version",
      "id",
      "actor",
      "mounts",
      "secondaryMotion",
      "effects",
      "actions",
      "input",
      "lifecycle",
    ],
    "config",
  );
  requireThat(
    c.format === "bubu-action-configuration" &&
      c.version === "0.1.0-foundation",
    "VERSION",
    "config",
  );
  id(c.id, "id");
  exact(c.actor, ["id", "modelVariant", "bodyOwner", "faceOwner"], "actor");
  id(c.actor.id, "actor.id");
  member(c.actor.modelVariant, ["d2"], "actor.modelVariant");
  requireThat(
    c.actor.bodyOwner === "shared-input-workbench-v2" &&
      c.actor.faceOwner === "WeightedExpressionOwner",
    "OWNER",
    "actor",
  );
  requireThat(anchorIds && catalogue, "CONTEXT", "anchors/catalogue");
  const anchors = new Set(anchorIds),
    assets = new Set(catalogue.map((x) => x.id));
  list(c.mounts, 32, "mounts");
  for (const m of c.mounts) {
    exact(m, ["id", "assetId", "anchor", "offset", "layer", "writer"], "mount");
    id(m.id, "mount.id");
    requireThat(assets.has(m.assetId), "UNKNOWN_ASSET", m.assetId);
    requireThat(anchors.has(m.anchor), "UNKNOWN_ANCHOR", m.anchor);
    list(m.offset, 3, "offset");
    requireThat(m.offset.length === 3, "OFFSET", "offset");
    m.offset.forEach((n) => number(n, -0.25, 0.25, "offset"));
    member(m.layer, ["back", "body", "front"], "layer");
    requireThat(m.writer === "mount-registry", "OWNER", "mount.writer");
  }
  unique(
    c.mounts.map((m) => m.id),
    "mounts",
  );
  const mounts = new Map(c.mounts.map((m) => [m.id, m]));
  list(c.secondaryMotion, 16, "secondaryMotion");
  for (const s of c.secondaryMotion) {
    exact(
      s,
      ["mountId", "mode", "writer", "maxAngleRad", "reset", "status"],
      "secondaryMotion",
    );
    requireThat(mounts.has(s.mountId), "UNKNOWN_MOUNT", s.mountId);
    member(
      s.mode,
      ["rigid-follow", "spring-chain", "authored-chain"],
      "secondary.mode",
    );
    requireThat(s.writer === "secondary-motion", "OWNER", "secondary.writer");
    number(s.maxAngleRad, 0.000001, 0.5, "maxAngleRad"); // Monitored rest-fallback threshold, not a spring-library clamp.
    requireThat(s.reset === "rest-local-transform", "RESET", "secondary.reset");
    member(s.status, ["supported", "research-blocked"], "secondary.status");
    requireThat(
      s.mode === "rigid-follow" || s.status === "research-blocked",
      "UNPROVEN_CHAIN",
      "secondary.status",
    );
  }
  unique(
    c.secondaryMotion.map((s) => s.mountId),
    "secondaryMotion",
  );
  list(c.effects, 4, "effects");
  let particleBudget = 0;
  for (const e of c.effects) {
    exact(
      e,
      [
        "id",
        "effectId",
        "mountId",
        "space",
        "maxParticles",
        "lifetimeSec",
        "rateHz",
        "durationSec",
        "cleanup",
      ],
      "effect",
    );
    id(e.id, "effect.id");
    member(
      e.effectId,
      ["leaf-stream", "petal-stream", "halo-sparks"],
      "effectId",
    );
    requireThat(mounts.has(e.mountId), "UNKNOWN_MOUNT", e.mountId);
    member(e.space, ["local", "world"], "effect.space");
    number(e.maxParticles, 1, 24, "maxParticles");
    requireThat(Number.isInteger(e.maxParticles), "NUMBER", "maxParticles");
    number(e.lifetimeSec, 0.01, 3, "lifetimeSec");
    number(e.rateHz, 0, 12, "rateHz");
    number(e.durationSec, 0.01, 60, "durationSec");
    requireThat(
      e.cleanup === "immediate-on-reset-dispose",
      "CLEANUP",
      "effect.cleanup",
    );
    particleBudget += e.maxParticles;
  }
  unique(
    c.effects.map((e) => e.id),
    "effects",
  );
  requireThat(particleBudget <= 96, "PARTICLE_BUDGET", "effects");
  exact(c.input, Object.keys(POINTER_LIFECYCLE), "input");
  requireThat(
    Object.entries(POINTER_LIFECYCLE).every(([k, v]) => c.input[k] === v),
    "INPUT_OWNER",
    "input",
  );
  exact(c.lifecycle, Object.keys(LIFECYCLE), "lifecycle");
  requireThat(
    Object.entries(LIFECYCLE).every(
      ([k, v]) => k === "cleanupSec" || c.lifecycle[k] === v,
    ),
    "LIFECYCLE",
    "lifecycle",
  );
  number(c.lifecycle.cleanupSec, 0, 3, "cleanupSec");
  requireThat(
    c.effects.every((e) => e.lifetimeSec <= c.lifecycle.cleanupSec),
    "CLEANUP_BOUND",
    "lifecycle.cleanupSec",
  );
  list(c.actions, 32, "actions");
  requireThat(c.actions.length > 0, "EMPTY", "actions");
  const recipes = [];
  for (const a of c.actions) {
    exact(
      a,
      [
        "id",
        "factKey",
        "priority",
        "resources",
        "body",
        "bones",
        "expressions",
        "contactWindows",
        "enterSec",
        "exitSec",
        "loop",
        "interrupt",
        "durationSec",
        "maxLoops",
        "effectTracks",
      ],
      "action",
    );
    id(a.id, "action.id");
    id(a.factKey, "factKey");
    number(a.priority, 0, 100, "priority");
    requireThat(Number.isInteger(a.priority), "NUMBER", "priority");
    list(a.resources, 40, "resources");
    unique(a.resources, "resources");
    a.resources.forEach((r) => {
      id(r, "resource");
      requireThat(
        r === "body.action" ||
          r === "face.semantic" ||
          (r.startsWith("accessory:") && mounts.has(r.slice(10))),
        "RESOURCE",
        r,
      );
    });
    requireThat(a.resources.includes("body.action"), "RESOURCE", "body.action");
    member(
      a.body,
      [
        "pointer-drag",
        "pointer-longpress",
        "baseline-idle",
        "accessory-authored",
      ],
      "body",
    );
    member(a.loop, ["while-input-held", "while-fact-active", "finite"], "loop");
    requireThat(
      a.interrupt === "sample-current-release-owner",
      "INTERRUPT",
      "interrupt",
    );
    number(a.enterSec, 0.02, 1, "enterSec");
    number(a.exitSec, 0.02, 3, "exitSec");
    number(a.durationSec, 0.02, 10, "durationSec");
    number(a.maxLoops, 1, 8, "maxLoops");
    requireThat(Number.isInteger(a.maxLoops), "NUMBER", "maxLoops");
    list(a.effectTracks, 16, "effectTracks");
    for (const track of a.effectTracks) {
      exact(track, ["at", "effectId", "event", "count"], "effectTrack");
      number(track.at, 0, 1, "effectTrack.at");
      requireThat(
        c.effects.some((effect) => effect.id === track.effectId),
        "UNKNOWN_EFFECT",
        track.effectId,
      );
      member(track.event, ["burst", "stop"], "effectTrack.event");
      number(track.count, 0, 8, "effectTrack.count");
      requireThat(Number.isInteger(track.count), "NUMBER", "effectTrack.count");
      requireThat(
        track.event === "stop" ? track.count === 0 : track.count > 0,
        "EFFECT_COUNT",
        "effectTrack.count",
      );
    }
    list(a.bones, 72, "bones");
    for (const b of a.bones) {
      exact(b, ["target", "clipId", "writer"], "bone");
      id(b.target, "bone.target");
      id(b.clipId, "bone.clipId");
      requireThat(
        /^accessory:/.test(b.target) && mounts.has(b.target.slice(10)),
        "BODY_WRITER_CONFLICT",
        b.target,
      );
      requireThat(clipIds.includes(b.clipId), "UNKNOWN_CLIP", b.clipId);
      requireThat(
        b.writer === "authored-quaternion-clips",
        "OWNER",
        "bones.writer",
      );
      requireThat(
        !c.secondaryMotion.some(
          (s) => s.mountId === b.target.slice(10) && s.mode !== "rigid-follow",
        ),
        "WRITER_CONFLICT",
        b.target,
      );
      requireThat(
        a.resources.includes(b.target),
        "UNDECLARED_WRITER",
        b.target,
      );
    }
    unique(
      a.bones.map((b) => b.target),
      "bone writers",
    );
    list(a.expressions, 64, "expressions");
    requireThat(
      a.expressions.length === 0 || a.resources.includes("face.semantic"),
      "UNDECLARED_WRITER",
      "face.semantic",
    );
    let previous = -1;
    for (const e of a.expressions) {
      exact(e, ["at", "candidate", "amount", "owner"], "expression");
      number(e.at, 0, 1, "expression.at");
      requireThat(e.at > previous, "KEY_ORDER", "expressions");
      previous = e.at;
      requireThat(faceIds.includes(e.candidate), "UNKNOWN_FACE", e.candidate);
      number(e.amount, 0, 1, "expression.amount");
      requireThat(
        e.owner === "WeightedExpressionOwner",
        "OWNER",
        "expression.owner",
      );
    }
    list(a.contactWindows, 16, "contactWindows");
    for (const w of a.contactWindows) {
      exact(
        w,
        ["mountId", "anchor", "start", "end", "release"],
        "contactWindow",
      );
      requireThat(mounts.has(w.mountId), "UNKNOWN_MOUNT", w.mountId);
      requireThat(anchors.has(w.anchor), "UNKNOWN_ANCHOR", w.anchor);
      number(w.start, 0, 1, "contact.start");
      number(w.end, 0, 1, "contact.end");
      requireThat(w.end > w.start, "CONTACT_ORDER", "contact");
      requireThat(
        w.release === "synthetic-release",
        "CONTACT_RELEASE",
        "release",
      );
    }
    recipes.push({
      id: a.id,
      factKey: a.factKey,
      kind: "action",
      approved: true,
      ready: true,
      resources: a.resources,
      mode: "sustained",
    });
  }
  unique(
    c.actions.map((a) => a.id),
    "actions",
  );
  const conflicts = [];
  for (let i = 0; i < c.actions.length; i++)
    for (let j = i + 1; j < c.actions.length; j++) {
      const a = c.actions[i],
        b = c.actions[j];
      if (a.resources.some((r) => b.resources.includes(r))) {
        requireThat(
          a.priority !== b.priority,
          "WRITER_CONFLICT",
          `${a.id}/${b.id}`,
        );
        conflicts.push({
          recipes: [a.id, b.id],
          winner: a.priority > b.priority ? a.id : b.id,
        });
      }
    }
  return freeze(
    structuredClone({
      configuration: c,
      sceneConfig: {
        policyVersion: c.id,
        maxOverlays: 0,
        sources: [{ id: "interaction", kind: "interaction" }],
        backgrounds: [],
        recipes,
        conflicts,
        overlayOrder: [],
      },
      bindings: {
        bodyOwner: c.actor.bodyOwner,
        faceOwner: c.actor.faceOwner,
        mountOwner: "anchor-registry",
        effectOwner: "bounded-effects",
        persistentWrites: [],
      },
      budgets: {
        mounts: c.mounts.length,
        emitters: c.effects.length,
        particles: particleBudget,
      },
      readiness: {
        configuration: "supported",
        production: "research-blocked",
        newActionChoreography: "research-blocked",
      },
    }),
  );
}
export { compileRuntimeConfiguration } from "./runtime-admission.mjs";
