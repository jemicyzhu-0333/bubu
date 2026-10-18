import { POINTER_LIFECYCLE, LIFECYCLE } from "../index.mjs";
export { CATALOGUE } from "../catalogue.mjs";
const mount = (id, assetId, anchor, layer = "front") => ({
  id,
  assetId,
  anchor,
  offset: [0, 0, 0],
  layer,
  writer: "mount-registry",
});
const secondary = (mountId, mode = "rigid-follow") => ({
  mountId,
  mode,
  writer: "secondary-motion",
  maxAngleRad: 0.25,
  reset: "rest-local-transform",
  status: mode === "rigid-follow" ? "supported" : "research-blocked",
});
const effect = (id, effectId, mountId, space) => ({
  id,
  effectId,
  mountId,
  space,
  maxParticles: 12,
  lifetimeSec: 1.2,
  rateHz: 4,
  durationSec: 8,
  cleanup: "immediate-on-reset-dispose",
});
const actions = () => [
  {
    id: "baseline",
    factKey: "idle",
    priority: 0,
    resources: ["body.action"],
    body: "baseline-idle",
    bones: [],
    expressions: [],
    contactWindows: [],
    enterSec: 0.16,
    exitSec: 0.2,
    loop: "while-fact-active",
    interrupt: "sample-current-release-owner",
    durationSec: 1,
    maxLoops: 1,
    effectTracks: [],
  },
  {
    id: "longpress",
    factKey: "longpress",
    priority: 50,
    resources: ["body.action", "face.semantic"],
    body: "pointer-longpress",
    bones: [],
    expressions: [],
    contactWindows: [],
    enterSec: 0.16,
    exitSec: 0.2,
    loop: "while-input-held",
    interrupt: "sample-current-release-owner",
    durationSec: 1,
    maxLoops: 1,
    effectTracks: [],
  },
  {
    id: "drag",
    factKey: "drag",
    priority: 100,
    resources: ["body.action", "face.semantic"],
    body: "pointer-drag",
    bones: [],
    expressions: [],
    contactWindows: [],
    enterSec: 0.22,
    exitSec: 1.5,
    loop: "while-input-held",
    interrupt: "sample-current-release-owner",
    durationSec: 1,
    maxLoops: 1,
    effectTracks: [],
  },
];
function fixture(id, mounts, secondaryMotion, effects = []) {
  return {
    format: "bubu-action-configuration",
    version: "0.1.0-foundation",
    id,
    actor: {
      id: "xiaobu-approved-d2",
      modelVariant: "d2",
      bodyOwner: "shared-input-workbench-v2",
      faceOwner: "WeightedExpressionOwner",
    },
    mounts,
    secondaryMotion,
    effects,
    actions: actions(),
    input: { ...POINTER_LIFECYCLE },
    lifecycle: { ...LIFECYCLE },
  };
}
const ear = fixture(
  "ear-sakura-leaf",
  [
    mount("sakura", "skin.sakura-flower", "earR.front"),
    mount("leaf", "skin.forest-leaf", "earR.rear"),
  ],
  [secondary("sakura"), secondary("leaf")],
  [
    effect("petals", "petal-stream", "sakura", "world"),
    effect("leaves", "leaf-stream", "leaf", "local"),
  ],
);
const satchel = fixture(
  "satchel",
  [mount("satchel", "milestone.satchel", "hip.sideR")],
  [secondary("satchel", "spring-chain")],
);
const cape = fixture(
  "cape-tail",
  [mount("cape", "milestone.cape", "back.upper", "back")],
  [secondary("cape", "authored-chain")],
);
const book = fixture(
  "held-book-release",
  [mount("book", "open-book", "palm.gripR")],
  [secondary("book")],
);
// Authored contact windows belong to executable authored actions, not inherited pointer presets.
const halo = fixture(
  "halo-particles",
  [mount("halo", "milestone.halo", "crown")],
  [secondary("halo")],
  [
    effect("halo-local", "halo-sparks", "halo", "local"),
    effect("halo-world", "halo-sparks", "halo", "world"),
  ],
);
export const FIXTURES = [ear, satchel, cape, book, halo];
