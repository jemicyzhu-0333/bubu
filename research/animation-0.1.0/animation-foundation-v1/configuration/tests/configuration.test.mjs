import test from "node:test";
import assert from "node:assert/strict";
import { compileActionConfiguration } from "../index.mjs";
import { FIXTURES, CATALOGUE } from "../fixtures/index.mjs";
import { createSceneCoordinator } from "../../../scene-coordinator-v1/src/coordinator.mjs";
const anchorIds = [
  "crown",
  "earR.front",
  "earR.rear",
  "hip.sideR",
  "back.upper",
  "palm.gripR",
];
const context = {
  anchorIds,
  catalogue: CATALOGUE,
  clipIds: ["fixture-turn"],
  faceIds: ["P2"],
};
const copy = () => structuredClone(FIXTURES[4]);
for (const fixture of FIXTURES)
  test(`${fixture.id}: immutable compilation and existing scene owner admission`, () => {
    const plan = compileActionConfiguration(fixture, context);
    assert.equal(Object.isFrozen(plan.configuration.actions[0]), true);
    assert.equal(plan.bindings.persistentWrites.length, 0);
    const coordinator = createSceneCoordinator(
      {
        ...plan.sceneConfig,
        backgrounds: [{ id: "fixture", approved: true, ready: true }],
      },
      { selectBackground: () => "fixture" },
    );
    coordinator.startFocus(
      {
        sessionId: "fixture",
        localDate: "2026-10-18",
        timeBand: "day",
        timeZone: "UTC",
        candidateIds: ["fixture"],
      },
      0,
    );
    coordinator.setSourceGeneration("interaction", 1, true, 0);
    coordinator.applySnapshots(
      [
        {
          sourceId: "interaction",
          generation: 1,
          revision: 1,
          facts: [
            { id: "lp", key: "longpress", observedAt: 0, expiresAt: 100 },
            { id: "drag", key: "drag", observedAt: 0, expiresAt: 100 },
          ],
        },
      ],
      0,
    );
    assert.equal(coordinator.plan(0).mainAction, "drag");
    assert.equal(coordinator.plan(100).mainAction, null);
  });
const invalid = (name, mutate, code) =>
  test(name, () => {
    const c = copy();
    mutate(c);
    assert.throws(
      () => compileActionConfiguration(c, context),
      (e) => e.code === code,
    );
  });
invalid(
  "unknown anchor fails closed",
  (c) => (c.mounts[0].anchor = "invented"),
  "UNKNOWN_ANCHOR",
);
invalid(
  "unknown asset fails closed",
  (c) => (c.mounts[0].assetId = "invented"),
  "UNKNOWN_ASSET",
);
invalid(
  "unbounded lifetime rejected",
  (c) => (c.effects[0].lifetimeSec = Infinity),
  "NUMBER",
);
invalid("NaN rate rejected", (c) => (c.effects[0].rateHz = NaN), "NUMBER");
invalid(
  "unbounded duration rejected",
  (c) => (c.effects[0].durationSec = Infinity),
  "NUMBER",
);
invalid(
  "fractional capacity rejected",
  (c) => (c.effects[0].maxParticles = 1.5),
  "NUMBER",
);
invalid(
  "unknown emitter rejected",
  (c) => (c.effects[0].effectId = "fireworks"),
  "VALUE",
);
invalid("unknown root field rejected", (c) => (c.timer = 1), "FIELDS");
invalid(
  "second body owner rejected",
  (c) => (c.actor.bodyOwner = "new-scheduler"),
  "OWNER",
);
invalid(
  "input lifecycle override rejected",
  (c) => (c.input.blur = "continue"),
  "INPUT_OWNER",
);
invalid(
  "equal priority shared writers rejected",
  (c) => (c.actions[1].priority = c.actions[2].priority),
  "WRITER_CONFLICT",
);
invalid(
  "body bone writer rejected",
  (c) =>
    c.actions[0].bones.push({
      target: "joint:body",
      clipId: "fixture-turn",
      writer: "authored-quaternion-clips",
    }),
  "BODY_WRITER_CONFLICT",
);
invalid(
  "unknown clip rejected",
  (c) =>
    c.actions[0].bones.push({
      target: "accessory:halo",
      clipId: "missing",
      writer: "authored-quaternion-clips",
    }),
  "UNKNOWN_CLIP",
);
invalid(
  "cleanup shorter than particle TTL rejected",
  (c) => (c.lifecycle.cleanupSec = 0.5),
  "CLEANUP_BOUND",
);
invalid(
  "duplicate mount rejected",
  (c) => c.mounts.push({ ...c.mounts[0] }),
  "DUPLICATE",
);
invalid(
  "invalid offset rejected",
  (c) => (c.mounts[0].offset[0] = NaN),
  "NUMBER",
);
invalid(
  "invalid contact interval rejected",
  (c) =>
    c.actions[0].contactWindows.push({
      mountId: "halo",
      anchor: "crown",
      start: 0.7,
      end: 0.2,
      release: "synthetic-release",
    }),
  "CONTACT_ORDER",
);
invalid(
  "authored and secondary writers conflict",
  (c) => {
    c.secondaryMotion[0].mode = "spring-chain";
    c.secondaryMotion[0].status = "research-blocked";
    c.actions[0].bones.push({
      target: "accessory:halo",
      clipId: "fixture-turn",
      writer: "authored-quaternion-clips",
    });
  },
  "WRITER_CONFLICT",
);
test("admitted accessory clip and face references preserve existing wire semantics", () => {
  const c = copy();
  c.actions[0].resources.push("accessory:halo", "face.semantic");
  c.actions[0].bones = [
    {
      target: "accessory:halo",
      clipId: "fixture-turn",
      writer: "authored-quaternion-clips",
    },
  ];
  c.actions[0].expressions = [
    { at: 0, candidate: "P2", amount: 0.5, owner: "WeightedExpressionOwner" },
  ];
  assert.deepEqual(
    compileActionConfiguration(c, context).configuration.actions[0].bones,
    c.actions[0].bones,
  );
});
test("catalogue exhaustively maps 18 wearables, 39 props, 2 variants without false action completion", () => {
  assert.equal(CATALOGUE.filter((x) => x.kind === "wearable").length, 18);
  assert.equal(CATALOGUE.filter((x) => x.kind === "prop").length, 39);
  assert.equal(CATALOGUE.filter((x) => x.kind === "variant").length, 2);
  assert.equal(new Set(CATALOGUE.map((x) => x.id)).size, 59);
  assert.ok(
    CATALOGUE.every(
      (x) =>
        x.actionStatus === "research-blocked" &&
        x.native === "research-blocked",
    ),
  );
});
test("oversized input rejects before cloning", () => {
  const c = copy();
  c.mounts = new Array(1000000);
  assert.throws(
    () => compileActionConfiguration(c, context),
    (e) => e.code === "LIST",
  );
});
test("configuration getter is rejected without invocation", () => {
  const c = copy();
  let reads = 0;
  Object.defineProperty(c, "actor", {
    enumerable: true,
    get() {
      reads++;
      throw Error("must not read");
    },
  });
  assert.throws(
    () => compileActionConfiguration(c, context),
    (e) => e.code === "FIELDS",
  );
  assert.equal(reads, 0);
});
test("array getters are rejected without invocation", () => {
  const c = copy();
  let reads = 0;
  Object.defineProperty(c.mounts, "0", {
    enumerable: true,
    get() {
      reads++;
      throw Error("must not read");
    },
  });
  assert.throws(
    () => compileActionConfiguration(c, context),
    (e) => e.code === "LIST_FIELDS",
  );
  assert.equal(reads, 0);
});
test("compiled plans do not freeze or alias caller input", () => {
  const c = copy();
  const plan = compileActionConfiguration(c, context);
  c.mounts[0].anchor = "changed";
  assert.equal(plan.configuration.mounts[0].anchor, "crown");
  assert.equal(Object.isFrozen(c), false);
});
for (const [name, select, key] of [
  ["mount", (c) => c.mounts[0], "id"],
  ["secondary", (c) => c.secondaryMotion[0], "mountId"],
  ["effect", (c) => c.effects[0], "id"],
  ["action", (c) => c.actions[0], "id"],
  [
    "bone",
    (c) => {
      c.actions[0].bones = [
        {
          target: "accessory:halo",
          clipId: "fixture-turn",
          writer: "authored-quaternion-clips",
        },
      ];
      return c.actions[0].bones[0];
    },
    "target",
  ],
])
  test(`${name} nested getter rejected before uniqueness`, () => {
    const c = copy();
    let reads = 0;
    const target = select(c);
    Object.defineProperty(target, key, {
      enumerable: true,
      get() {
        reads++;
        return "hostile";
      },
    });
    assert.throws(
      () => compileActionConfiguration(c, context),
      (e) => e.code === "FIELDS",
    );
    assert.equal(reads, 0);
  });
