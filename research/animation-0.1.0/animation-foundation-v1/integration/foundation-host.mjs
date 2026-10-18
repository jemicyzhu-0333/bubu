import * as T from "three";
import { cleanupOwned } from "./cleanup-owned.mjs";
import { SceneBudget } from "./scene-budget.mjs";
import { SURFACE_QUERY_RESERVATION_BYTES } from "../body-runtime/surface-query.mjs";
import { createAnchorRegistry } from "../anchors/index.mjs";
import { BUBU_D2_PROFILE, ANCHOR_IDS } from "../anchors/bubu-d2-profile.mjs";
import { createActionStrategy } from "../configuration/action-strategy.mjs";
import { compileRuntimeConfiguration } from "../configuration/index.mjs";
import { CATALOGUE } from "../configuration/fixtures/index.mjs";
import { createSecondaryMotion } from "../secondary-motion/index.mjs";
import { createEffectRuntime } from "../effects/bounded-effects.mjs";
import {
  createBody,
  loadGLB,
  revised,
  disposeAsset,
  disposeAssets,
} from "./asset-fixtures.mjs";
import { createD2BindingProvider } from "./asset-bindings.mjs";
import { createFrameOwner } from "./frame-owner.mjs";
import { createRoundTail } from "../../external-assets-v1/body-tail/round-tail-adapter.mjs";

import { admitAsset } from "./resource-admission.mjs";
export { RESOURCE_LIMITS } from "./resource-admission.mjs";
import { setWorld, sampler } from "./transform-sampling.mjs";
/** Research fixture coordinator. No canonical state, body replacement, timers or loaders per frame. */
export class FoundationPool {
  constructor({ maxActors = 2, maxBytes } = {}) {
    if (!Number.isInteger(maxActors) || maxActors < 1 || maxActors > 2)
      throw Error("Actor budget is 1..2");
    this.maxActors = maxActors;
    this.budget = new SceneBudget({ maxBytes });
    this.actors = new Set();
    this.pending = 0;
    this.disposed = false;
  }
  async create(options = {}) {
    if (this.disposed || this.actors.size + this.pending >= this.maxActors)
      throw Error("Actor budget exhausted");
    this.pending++;
    let actor;
    try {
      actor = await FoundationActor.create({ ...options, budget: this.budget });
      if (this.disposed) {
        actor.dispose();
        throw Error("Pool disposed during load");
      }
      this.actors.add(actor);
      actor.onDispose = () => this.actors.delete(actor);
      return actor;
    } finally {
      this.pending--;
    }
  }
  diagnostics() {
    return {
      budget: this.budget.diagnostics(),
      actors: this.actors.size,
      pending: this.pending,
      mounts: [...this.actors].reduce((n, a) => n + a.mounts.size, 0),
      emitters: [...this.actors].map((a) => a.effects.diagnostics()),
    };
  }
  dispose() {
    this.disposed = true;
    this.budget.close();
    cleanupOwned(
      [...this.actors].map((actor) => () => actor.dispose()),
      "Pool disposal failures",
    );
  }
}
export class FoundationActor {
  static async create({ budget = new SceneBudget(), ...bodyOptions } = {}) {
    const cacheLease = budget.reserve(
      32 * 1024 * 1024,
      "actor accessory cache and admission staging",
    );
    let actor, body, surfaceLease;
    try {
      surfaceLease = budget.reserve(
        SURFACE_QUERY_RESERVATION_BYTES,
        "actor posed surface query and build staging",
      );
      body = await createBody({
        ...bodyOptions,
        beforeCommit: (context) => {
          actor?.strategy?.tick(context.time, {
            facts: actor.actionFacts ?? [],
            pointerMode: context.mode,
          });
          bodyOptions.beforeCommit?.(context);
        },
      });
    } catch (error) {
      cacheLease.release();
      surfaceLease?.release();
      throw error;
    }
    try {
      actor = new FoundationActor(body);
      actor.budget = budget;
      actor.cacheLease = cacheLease;
      actor.surfaceLease = surfaceLease;
      actor.bindings = await createD2BindingProvider(
        body,
        actor.anchors,
        admitAsset,
      );
      await actor.attachAnatomicalTail();
      cacheLease.commit(actor.bindings.residentBytes + 64 * 1024);
      surfaceLease.commit(body.f.h.diagnostics.surface.residentUpperBoundBytes);
      return actor;
    } catch (error) {
      try {
        cleanupOwned(
          [
            () => (actor ? actor.dispose() : body.dispose()),
            () => cacheLease.release(),
            () => surfaceLease?.release(),
          ],
          "Actor construction cleanup failures",
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Actor construction and cleanup failed",
        );
      }
      throw error;
    }
  }
  constructor(body) {
    this.body = body;
    this.f = body.f;
    this.owner = body.owner;
    this.actionFacts = [];
    this.scene = new T.Group();
    this.scene.add(this.f.h.body.root);
    this.mountRoot = new T.Group();
    this.scene.add(this.mountRoot);
    this.generation = 0;
    this.mounts = new Map();
    this.pendingEquips = 0;
    this.handles = [];
    this.disposed = false;
    this.f.tick(0);
    this.owner.update();
    this.f.h.body.root.updateMatrixWorld(true);
    this.f.h.body.skin.skeleton.update();
    this.anchors = createAnchorRegistry({
      THREE: T,
      profile: BUBU_D2_PROFILE,
      sourceSkin: this.f.h.body.skin,
      hybridRoot: this.owner.root,
      assertSourceCurrent: () => this.f.h.owner.assertCurrent(),
      assertPoseCurrent: (r) => {
        if (this.frame) this.frame.assertRevision(r);
        else if (r !== 0) throw Error("Stale initial pose");
      },
    });
    this.anchors.sampleFinalPose(0);
    this.effects = createEffectRuntime({
      THREE: T,
      scene: this.scene,
      seed: 9,
    });
    this.frame = createFrameOwner({
      advanceBody: (time) => this.f.tick(time),
      finalizeBody: () => {
        this.owner.update();
        this.f.h.body.root.updateMatrixWorld(true);
        this.f.h.body.skin.skeleton.update();
      },
      sampleAnchors: (frame) => this.anchors.sampleFinalPose(frame.revision),
      updateAttachments: (frame) => this.updateAttachments(frame),
      updateEffects: (frame) =>
        this.effects.tick({
          dt: Math.max(0, frame.dt),
          poseRevision: frame.revision,
          hidden: frame.policy.hidden,
          reducedMotion: frame.policy.reducedMotion,
        }),
      render: () => this.scene.updateMatrixWorld(true),
    });
  }
  async attachAnatomicalTail() {
    const asset = await loadGLB(`${revised}/body-tail/bubu-round-tail.glb`);
    try {
      admitAsset(asset);
      this.tail = createRoundTail({
        sourceSkin: this.f.h.body.skin,
        parent: this.mountRoot,
        asset,
        assertSourceCurrent: () => this.f.h.owner.assertCurrent(),
      });
      this.tailAsset = asset;
    } catch (error) {
      disposeAsset(asset);
      throw error;
    }
  }
  assertActive() {
    if (this.disposed) throw Error("Actor disposed");
  }
  async equip(
    raw,
    { load, clipLibrary, facePort, faceIds = [], contactPort } = {},
  ) {
    this.assertActive();
    facePort ??= this.f.h.facePort;
    if (!faceIds.length)
      faceIds = this.body.authoredFaces.map((x) => x.candidate);
    const plan = compileRuntimeConfiguration(raw, {
      anchorIds: ANCHOR_IDS,
      catalogue: CATALOGUE,
      clipIds: clipLibrary?.clips.map((c) => c.id) ?? [],
      faceIds,
      authoredActions: true,
      facePort,
      contactPort,
      effectPort: true,
    });
    raw = plan.configuration;
    if (raw.actor.modelVariant !== "d2")
      throw Error("Only D2 fixture runtime admitted");
    for (const mount of raw.mounts)
      this.bindings.describe(
        mount,
        raw.secondaryMotion.find((s) => s.mountId === mount.id),
      );
    if (raw.mounts.length > 5) throw Error("Mount budget exceeded");
    if (this.pendingEquips >= 2) throw Error("Pending equip budget exhausted");
    const residentBytes =
      raw.mounts.reduce(
        (sum, m) =>
          sum +
          this.bindings.describe(
            m,
            raw.secondaryMotion.find((s) => s.mountId === m.id),
          ).bytes,
        0,
      ) +
      1024 * 1024;
    const lease = this.budget.reserve(
      residentBytes + 16 * 1024 * 1024,
      "equip staging",
    );
    this.pendingEquips++;
    let generation;
    const pending = [];
    const pendingHandles = [];
    let pendingStrategy = null;
    let committedStrategy = null;
    let committed = false;
    const unclaimed = new Set();
    let equipError = null;
    try {
      this.remove();
      generation = this.generation;
      this.assertActive();
      for (const spec of raw.mounts) {
        const descriptor = this.bindings.describe(
          spec,
          raw.secondaryMotion.find((s) => s.mountId === spec.id),
        );
        const asset = await this.bindings.load(spec, load);
        unclaimed.add(asset);
        if (this.disposed || generation !== this.generation)
          return { stale: true };
        const resources = admitAsset(asset);
        const calibration = descriptor.calibration;
        const authoredWorld = this.anchors
          .getTransform(spec.anchor, {
            poseRevision: this.revision,
            offset: spec.offset,
          })
          .multiply(calibration);
        const secondary = descriptor.admission
          ? createSecondaryMotion({
              admission: descriptor.admission,
              parent: this.mountRoot,
              maxAngleRad: descriptor.maxAngleRad,
              assertCurrent: () => this.f.h.owner.assertCurrent(),
            })
          : null;
        const root = secondary?.root ?? asset.clone(true);
        const delta = new T.Group();
        delta.name = "authored-delta:" + spec.id;
        // Own the root before any attach/traverse callback can throw.
        const record = {
          spec,
          asset,
          root,
          secondary,
          delta,
          calibration,
          resources,
          last: authoredWorld.clone(),
        };
        pending.push(record);
        unclaimed.delete(asset);
        if (!secondary) this.mountRoot.add(root);
        root.traverse((m) => {
          if (m.isMesh)
            m.renderOrder = { back: -1, body: 0, front: 1 }[spec.layer];
        });
        if (!secondary) {
          for (const child of [...root.children]) delta.add(child);
          root.add(delta);
        }
        setWorld(root, authoredWorld);
        if (this.disposed || generation !== this.generation)
          return { stale: true };
      }
      const stagedMounts = new Map(pending.map((item) => [item.spec.id, item]));
      for (const spec of raw.effects) {
        const item = stagedMounts.get(spec.mountId);
        pendingHandles.push(
          this.effects.enter({ ...spec, anchor: item.delta }),
        );
        if (this.disposed || generation !== this.generation)
          return { stale: true };
      }
      pendingStrategy = createActionStrategy({
        plan,
        clipLibrary,
        nodes: new Map(
          [...stagedMounts].map(([id, item]) => [
            "accessory:" + id,
            item.delta,
          ]),
        ),
        facePort,
        contactPort,
        effectPort: (event) => {
          if (!committed)
            throw Error("Effect callback before equipment commit");
          if (this.strategy !== committedStrategy) return;
          const index = raw.effects.findIndex((e) => e.id === event.effectId),
            spec = raw.effects[index];
          let handle = this.handles[index];
          if (event.event === "burst") {
            if (handle?.state === "disposed")
              handle = this.handles[index] = this.effects.enter({
                ...spec,
                anchor: this.mounts.get(spec.mountId).delta,
              });
            handle?.burst(event.count);
          } else handle?.stop({ immediate: true });
        },
      });
      if (this.disposed || generation !== this.generation)
        return { stale: true };
      lease.commit(residentBytes);
      // No external callbacks below: transfer all staged ownership atomically.
      while (pending.length) {
        const item = pending[0];
        this.mounts.set(item.spec.id, item);
        pending.shift();
      }
      this.handles = pendingHandles.splice(0);
      this.strategy = pendingStrategy;
      committedStrategy = pendingStrategy;
      pendingStrategy = null;
      this.equipLease = lease;
      this.configuration = plan;
      committed = true;
      return { stale: false, plan };
    } catch (error) {
      equipError = error;
      try {
        if (generation === this.generation) this.remove();
      } catch (cleanupError) {
        equipError = new AggregateError(
          [error, cleanupError],
          "Equipment failure and cleanup",
        );
      }
      throw equipError;
    } finally {
      this.pendingEquips--;
      const cleanup = [
        () => {
          if (this.equipLease !== lease) lease.release();
        },
        () => pendingStrategy?.dispose(),
        ...pendingHandles.map((handle) => () => handle?.dispose()),
        () =>
          disposeAssets([...unclaimed, ...pending.map((item) => item.asset)]),
      ];
      for (const item of pending)
        cleanup.push(
          () => item.secondary?.dispose(),
          () => item.root.removeFromParent(),
        );
      try {
        cleanupOwned(cleanup, "Pending equipment cleanup failures");
      } catch (cleanupError) {
        if (equipError)
          throw new AggregateError(
            [equipError, cleanupError],
            "Equipment failure and pending cleanup",
          );
        throw cleanupError;
      }
    }
  }
  get time() {
    return this.frame.time;
  }
  get revision() {
    return this.frame.revision;
  }
  get trace() {
    return this.frame.trace;
  }
  step(
    time,
    { hidden = this.f.doc.hidden, reducedMotion = false, facts = [] } = {},
  ) {
    this.assertActive();
    try {
      if (hidden || reducedMotion) this.f.h.suspend();
      else this.f.h.resume();
      this.actionFacts = facts;
      if (hidden || reducedMotion) this.strategy?.pause(time);
      else if (this.strategy?.snapshot().paused) this.strategy.resume(time);
      return this.frame.step(time, { hidden, reducedMotion });
    } catch (error) {
      try {
        this.dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Frame failure and actor cleanup",
        );
      }
      throw error;
    }
  }
  updateAttachments(frame) {
    this.tail?.update();
    for (const item of this.mounts.values()) {
      const current = this.anchors
        .getTransform(item.spec.anchor, {
          poseRevision: frame.revision,
          offset: item.spec.offset,
        })
        .multiply(item.calibration);
      const sampleAnchor = sampler(
        item.last,
        current,
        frame.previousTime,
        frame.time,
      );
      if (item.secondary)
        item.secondary.update({
          time: frame.time,
          paused: frame.policy.hidden,
          reducedMotion: frame.policy.reducedMotion,
          sampleAnchor,
        });
      setWorld(item.root, current);
      item.last.copy(current);
    }
    this.mountRoot.updateMatrixWorld(true);
  }
  remove() {
    this.generation++;
    const { strategy, handles, mounts, equipLease } = this;
    this.strategy = null;
    this.handles = [];
    this.mounts = new Map();
    this.equipLease = null;
    const operations = [
      () => equipLease?.release(),
      () => strategy?.dispose(),
      ...handles.map((handle) => () => handle?.dispose()),
    ];
    for (const item of mounts.values())
      operations.push(
        () => item.secondary?.dispose(),
        () => item.root.removeFromParent(),
      );

    operations.push(() =>
      disposeAssets([...mounts.values()].map((item) => item.asset)),
    );
    cleanupOwned(operations, "Equipment cleanup failures");
  }
  reset() {
    this.assertActive();
    this.generation++;
    this.actionFacts = [];
    const time = this.time;
    cleanupOwned(
      [
        () => this.strategy?.reset(time),
        () => this.f.at(time),
        () => this.f.h.suspend(),
        () => this.f.h.resume(),
        () => {
          if (!this.disposed) this.frame.step(time);
        },
        () => this.effects.reset(),
        () => {
          this.handles = [];
          for (const spec of this.configuration?.configuration.effects ?? []) {
            const item = this.mounts.get(spec.mountId);
            if (item && !this.disposed)
              this.handles.push(
                this.effects.enter({ ...spec, anchor: item.delta }),
              );
          }
        },
        ...[...this.mounts.values()].map(
          (item) => () => item.secondary?.reset(time),
        ),
      ],
      "Reset cleanup failures",
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    cleanupOwned(
      [
        () => this.remove(),
        () => this.effects.dispose(),
        () => this.anchors.dispose(),
        () => this.frame?.dispose(),
        () => this.tail?.dispose(),
        () => {
          if (this.tailAsset) disposeAsset(this.tailAsset);
          this.tailAsset = null;
        },
        () => this.bindings?.dispose(),
        () => this.cacheLease?.release(),
        () => this.surfaceLease?.release(),
        () => this.body.dispose(),
        () => this.scene.clear(),
        () => this.onDispose?.(),
      ],
      "Actor disposal failures",
    );
  }
}
