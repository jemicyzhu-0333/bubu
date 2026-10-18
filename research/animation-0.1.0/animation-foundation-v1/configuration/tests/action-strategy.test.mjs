import test from "node:test";
import assert from "node:assert/strict";
import { Object3D } from "three";
import { compileRuntimeConfiguration } from "../index.mjs";
import { createActionStrategy } from "../action-strategy.mjs";
import { FIXTURES, CATALOGUE } from "../fixtures/index.mjs";
import {
  AUTHORED_CLIP_LIBRARY,
  AUTHORED_HALO_FIXTURE,
} from "../fixtures/authored.mjs";

const context = {
  anchorIds: ["crown"],
  catalogue: CATALOGUE,
  clipIds: ["halo-tilt"],
  faceIds: ["P2"],
  authoredActions: true,
  effectPort: true,
  facePort: true,
  contactPort: true,
};
function make(config = AUTHORED_HALO_FIXTURE) {
  const node = new Object3D();
  const events = [];
  const plan = compileRuntimeConfiguration(config, context);
  const strategy = createActionStrategy({
    plan,
    clipLibrary: AUTHORED_CLIP_LIBRARY,
    nodes: new Map([["accessory:halo", node]]),
    effectPort: (event) => events.push(event),
    contactPort: (event) => events.push(event),
    facePort: {
      request: (event) => events.push(event),
      release: (event) => events.push({ ...event, release: true }),
    },
  });
  return { strategy, node, events };
}
test("authored timing changes actual existing QuaternionLane output", () => {
  const a = make();
  const changed = structuredClone(AUTHORED_HALO_FIXTURE);
  changed.actions.at(-1).enterSec = 0.4;
  const b = make(changed);
  for (const item of [a, b]) {
    item.strategy.tick(0, { facts: ["greeting"] });
    item.strategy.tick(0.4, { facts: ["greeting"] });
  }
  assert(a.node.quaternion.z > 0.05);
  assert.equal(b.node.quaternion.z, 0);
  a.strategy.dispose();
  b.strategy.dispose();
});
test("finite strategy dispatches configured effects and restores neutral without replay", () => {
  const { strategy, node, events } = make();
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(0.4, { facts: ["greeting"] });
  assert.equal(events[0].event, "burst");
  assert.equal(events[0].time, 0.35);
  strategy.tick(2, { facts: ["greeting"] });
  assert.equal(strategy.snapshot().phase, "idle");
  assert.equal(node.quaternion.z, 0);
  assert.equal(events.filter((event) => event.event === "burst").length, 1);
  strategy.tick(3, { facts: [] });
  strategy.tick(4, { facts: ["greeting"] });
  assert.equal(strategy.snapshot().phase, "active");
  strategy.dispose();
});
test("drag priority interrupts from sampled value then obeys configured exit duration", () => {
  const { strategy, node } = make();
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(0.4, { facts: ["greeting"] });
  const value = node.quaternion.z;
  strategy.tick(0.4, { facts: ["greeting"], pointerMode: "drag" });
  assert.equal(node.quaternion.z, value);
  assert.equal(strategy.snapshot().phase, "exit");
  strategy.tick(0.6, { facts: [], pointerMode: "drag" });
  assert(Math.abs(node.quaternion.z) < 1e-12);
  strategy.dispose();
});
test("contacts and face requests execute and release on lifecycle reset", () => {
  const config = structuredClone(AUTHORED_HALO_FIXTURE);
  const action = config.actions.at(-1);
  action.resources.push("face.semantic");
  action.expressions = [
    { at: 0.1, candidate: "P2", amount: 0.5, owner: "WeightedExpressionOwner" },
  ];
  action.contactWindows = [
    {
      mountId: "halo",
      anchor: "crown",
      start: 0.1,
      end: 0.9,
      release: "synthetic-release",
    },
  ];
  const { strategy, events } = make(config);
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(0.3, { facts: ["greeting"] });
  assert(
    events.some((event) => event.candidate === "P2" && event.amount === 0.5),
  );
  assert.equal(strategy.snapshot().contacts, 1);
  strategy.reset(0.3);
  assert(events.some((event) => event.active === false));
  assert(events.some((event) => event.release));
  assert.equal(strategy.snapshot().contacts, 0);
  strategy.dispose();
});
test("loop bound, pause and disposal leave no queued work", () => {
  const config = structuredClone(AUTHORED_HALO_FIXTURE);
  config.actions.at(-1).loop = "while-fact-active";
  config.actions.at(-1).maxLoops = 2;
  const { strategy, events } = make(config);
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(5, { facts: ["greeting"] });
  assert.equal(events.filter((event) => event.event === "burst").length, 2);
  assert.equal(strategy.snapshot().phase, "idle");
  strategy.pause(5);
  strategy.resume(6);
  strategy.dispose();
  assert.equal(strategy.snapshot().queuedEvents, 0);
  assert.equal(strategy.snapshot().disposed, true);
});
test("runtime admission rejects full18, ignored pointer knobs and missing executable ports", () => {
  const c = structuredClone(FIXTURES[4]);
  c.actor.modelVariant = "full18";
  assert.throws(() => compileRuntimeConfiguration(c, context));
  c.actor.modelVariant = "d2";
  c.actions[0].enterSec = 0.3;
  assert.throws(
    () => compileRuntimeConfiguration(c, context),
    /INHERITED_POINTER_POLICY/,
  );
  assert.throws(
    () =>
      compileRuntimeConfiguration(AUTHORED_HALO_FIXTURE, {
        ...context,
        authoredActions: false,
      }),
    /AUTHORED_ACTION_PORT_REQUIRED/,
  );
});

test("all five authored fixture strategies execute their declared ports and terminate", async () => {
  const { AUTHORED_CASES } = await import("../fixtures/authored.mjs");
  for (const fixture of AUTHORED_CASES) {
    const events = [];
    const plan = compileRuntimeConfiguration(fixture.configuration, {
      ...context,
      anchorIds: [
        "crown",
        "earR.front",
        "earR.rear",
        "hip.sideR",
        "back.upper",
        "palm.gripR",
      ],
      clipIds: fixture.clipLibrary?.clips.map((clip) => clip.id) ?? [],
    });
    const nodes = new Map(
      fixture.configuration.mounts.map((mount) => [
        `accessory:${mount.id}`,
        new Object3D(),
      ]),
    );
    const strategy = createActionStrategy({
      plan,
      clipLibrary: fixture.clipLibrary,
      nodes,
      effectPort: (event) => events.push(event),
      contactPort: (event) => events.push(event),
      facePort: {
        request: (event) => events.push(event),
        release: (event) => events.push({ ...event, release: true }),
      },
    });
    strategy.tick(0, { facts: ["acknowledge"] });
    strategy.tick(0.5, { facts: ["acknowledge"] });
    assert(
      events.some((event) => event.candidate === "P2"),
      fixture.configuration.id,
    );
    strategy.tick(2, { facts: ["acknowledge"] });
    assert.equal(strategy.snapshot().phase, "idle", fixture.configuration.id);
    assert.equal(strategy.snapshot().contacts, 0);
    strategy.dispose();
  }
});

test("throwing release ports cannot retain action ownership or prevent other cleanup", () => {
  const config = structuredClone(AUTHORED_HALO_FIXTURE);
  const action = config.actions.at(-1);
  action.resources.push("face.semantic");
  action.expressions = [
    { at: 0, candidate: "P2", amount: 0.5, owner: "WeightedExpressionOwner" },
  ];
  action.contactWindows = [
    {
      mountId: "halo",
      anchor: "crown",
      start: 0,
      end: 1,
      release: "synthetic-release",
    },
  ];
  const released = [];
  const strategy = createActionStrategy({
    plan: compileRuntimeConfiguration(config, context),
    clipLibrary: AUTHORED_CLIP_LIBRARY,
    nodes: new Map([["accessory:halo", new Object3D()]]),
    facePort: {
      request() {},
      release() {
        released.push("face");
        throw Error("face failure");
      },
    },
    contactPort: (event) => {
      if (!event.active) released.push("contact");
    },
    effectPort: (event) => {
      if (event.event === "stop") released.push("effect");
    },
  });
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(0.4, { facts: ["greeting"] });
  assert.throws(() => strategy.dispose(), /cleanup/);
  assert.deepEqual(released, ["face", "contact", "effect"]);
  assert.equal(strategy.snapshot().disposed, true);
  assert.equal(strategy.snapshot().contacts, 0);
  assert.equal(strategy.snapshot().queuedEvents, 0);
  strategy.dispose();
});
test("reentrant disposal during dispatch cannot revive contacts or queued action", () => {
  let strategy;
  strategy = createActionStrategy({
    plan: compileRuntimeConfiguration(AUTHORED_HALO_FIXTURE, context),
    clipLibrary: AUTHORED_CLIP_LIBRARY,
    nodes: new Map([["accessory:halo", new Object3D()]]),
    effectPort: (event) => {
      if (event.event === "burst") strategy.dispose();
    },
  });
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(0.4, { facts: ["greeting"] });
  assert.equal(strategy.snapshot().disposed, true);
  assert.equal(strategy.snapshot().phase, "idle");
  assert.equal(strategy.snapshot().queuedEvents, 0);
});

test("late face keys coalesce at the observed owner frame without backdating or queue amplification", () => {
  const config = structuredClone(AUTHORED_HALO_FIXTURE);
  const action = config.actions.at(-1);
  action.resources.push("face.semantic");
  action.loop = "while-fact-active";
  action.maxLoops = 8;
  action.expressions = Array.from({ length: 64 }, (_, index) => ({
    at: index / 63,
    candidate: "P2",
    amount: index / 63,
    owner: "WeightedExpressionOwner",
  }));
  const { strategy, events } = make(config);
  strategy.tick(0, { facts: ["greeting"] });
  strategy.tick(0.6, { facts: ["greeting"] });
  const faceEvents = events.filter((event) => event.candidate);
  assert.equal(faceEvents.length, 1);
  assert.equal(faceEvents[0].time, 0.6);
  strategy.tick(20, { facts: ["greeting"] });
  assert.equal(events.filter((event) => event.candidate).length, 1);
  assert.equal(events.filter((event) => event.release).length, 1);
  strategy.dispose();
});
