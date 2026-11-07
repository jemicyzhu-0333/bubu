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
import { disposeAsset, disposeAssets } from "./asset-resources.mjs";
import { createFrameOwner } from "./frame-owner.mjs";
import { createRoundTail } from "../../external-assets-v1/body-tail/round-tail-adapter.mjs";
import { createContactOwner } from "../contact/owner.mjs";
import { validateClipLibrary } from "../../runtime/src/clip-contract.mjs";

import { admitAsset } from "./resource-admission.mjs";
export { RESOURCE_LIMITS } from "./resource-admission.mjs";
import { setWorld, sampler } from "./transform-sampling.mjs";
export function createFoundationRuntime({ createBody, createHybridSource, loadGLB,
  revised, createD2BindingProvider, loadResearchContactEvidence }) {
/** Research fixture coordinator. No canonical state, body replacement, timers or loaders per frame. */
class FoundationPool {
  constructor({ maxActors = 2, maxBytes } = {}) {
    if (!Number.isInteger(maxActors) || maxActors < 1 || maxActors > 2)
      throw Error("Actor budget is 1..2");
    this.maxActors = maxActors;
    this.budget = new SceneBudget({ maxBytes });
    this.partsSource = createHybridSource(this.budget);
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
      actor = await FoundationActor.create({
        ...options, budget: this.budget, partsSource: this.partsSource,
      });
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
      parts: this.partsSource.diagnostics(),
      actors: this.actors.size,
      pending: this.pending,
      mounts: [...this.actors].reduce((n, a) => n + a.mounts.size, 0),
      emitters: [...this.actors].map((a) => a.effects.diagnostics()),
    };
  }
  dispose() {
    this.disposed = true;
    this.budget.close();
    this.partsSource.close();
    cleanupOwned(
      [...this.actors].map((actor) => () => actor.dispose()),
      "Pool disposal failures",
    );
  }
}
class FoundationActor {
  static async create({ budget = new SceneBudget(), partsSource, equipmentMode = "prepared", ...bodyOptions } = {}) {
    if (!["prepared", "bare"].includes(equipmentMode))
      throw new TypeError("Equipment mode must be prepared or bare");
    const ownPartsSource = !partsSource;
    partsSource ??= createHybridSource(budget);
    const cacheLease = budget.reserve(
      equipmentMode === "prepared" ? 32 * 1024 * 1024 : 64 * 1024,
      equipmentMode === "prepared" ? "actor accessory cache and admission staging" : "bare actor anatomical tail",
    );
    let actor, body, surfaceLease;
    try {
      surfaceLease = budget.reserve(
        SURFACE_QUERY_RESERVATION_BYTES,
        "actor posed surface query and build staging",
      );
      body = await createBody({
        ...bodyOptions,
        partsSource,
        beforeCommit: (context) => {
          if (context.mode !== "idle") actor?.contactOwner?.stop("pointer-interruption");
          actor?.strategy?.tick(context.time, {
            facts: actor.contactOwner?.snapshot().active ? [] : actor.actionFacts ?? [],
            pointerMode: context.mode,
          });
          bodyOptions.beforeCommit?.(context);
        },
      });
    } catch (error) {
      cacheLease.release();
      surfaceLease?.release();
      if (ownPartsSource) partsSource.close();
      throw error;
    }
    try {
      actor = new FoundationActor(body);
      actor.budget = budget;
      actor.equipmentMode = equipmentMode;
      actor.cacheLease = cacheLease;
      actor.surfaceLease = surfaceLease;
      actor.ownedPartsSource = ownPartsSource ? partsSource : null;
      const contactEvidence = await loadResearchContactEvidence();
      actor.contactOwner = createContactOwner({
        actor: contactEvidence.actor,
        registry: contactEvidence.registry,
        readGarments: () => [...actor.mounts.values()].map(item => item.contact),
      });
      // G1 has no wardrobe mapping. Keep the approved anatomy and pointer owner,
      // without preparing templates that this actor cannot equip. Preparation is
      // still eager for wardrobe actors because calibration requires the rest pose.
      actor.bindings = equipmentMode === "prepared"
        ? await createD2BindingProvider(body, actor.anchors, admitAsset)
        : null;
      await actor.attachAnatomicalTail();
      cacheLease.commit((actor.bindings?.residentBytes ?? 0) + 64 * 1024);
      surfaceLease.commit(body.f.h.diagnostics.surface.residentUpperBoundBytes);
      return actor;
    } catch (error) {
      try {
        cleanupOwned(
          [
            () => (actor ? actor.dispose() : body.dispose()),
            () => cacheLease.release(),
            () => surfaceLease?.release(),
            () => { if (ownPartsSource) partsSource.close(); },
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
    this.contactSuspended = false;
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
    this.createEffects = scene => createEffectRuntime({
      THREE: T,
      scene,
      seed: 9,
    });
    this.effectRoot = new T.Group();
    this.effects = this.createEffects(this.effectRoot);
    this.scene.add(this.effectRoot);
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
  checkContactAction(action) {
    this.assertActive();
    if ([...this.mounts.values()].some(item => item.unverifiedSource))
      throw new Error("Unverified equipment source cannot use contact evidence");
    return this.contactOwner.check(action);
  }
  beginContactAction(action, start) {
    this.assertActive();
    if ([...this.mounts.values()].some(item => item.unverifiedSource))
      throw new Error("Unverified equipment source cannot use contact evidence");
    if (this.pendingEquips) throw new Error("Contact action waits for equipment settlement");
    if (this.f.h.pendingCount || this.f.h.state?.mode !== "idle" ||
        this.f.doc.hidden || this.contactSuspended || this.strategy?.snapshot().actionId ||
        this.strategy?.snapshot().paused)
      throw new Error("Contact action requires an idle, visible, unowned body");
    return this.contactOwner.begin(action, start);
  }
  endContactAction() {
    this.assertActive();
    this.contactOwner.stop("completed");
  }
  async equip(
    raw,
    { load, clipLibrary, facePort, faceIds = [], contactPort } = {},
  ) {
    this.assertActive();
    if (this.equipmentMode === "bare")
      throw new Error("Bare actor has no prepared equipment; create a wardrobe actor before equipping");
    // A caller-owned clip library must not change while async loading/hashing
    // is in flight or after its contact identity has been admitted.
    if (clipLibrary) {
      validateClipLibrary(clipLibrary, { joints: [], capabilities: [] }, raw.mounts ?? []);
      clipLibrary = structuredClone(clipLibrary);
    }
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
    if (load && this.contactOwner?.snapshot().active)
      throw new Error("Unverified equipment source during contact action");
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
    let pendingEffects = null, pendingEffectRoot = null;
    const unclaimed = new Set();
    let equipError = null;
    try {
      generation = ++this.generation;
      this.assertActive();
      const contactGarments = [], contactsByMount = new Map();
      for (const mount of raw.mounts) {
        let contact;
        if (this.contactOwner) {
          contact = this.bindings.contactFor(mount, raw, clipLibrary);
          if (contact?.then) contact = await contact;
          if (this.disposed || generation !== this.generation) return { stale: true };
        }
        contactGarments.push(contact); contactsByMount.set(mount.id, contact);
      }
      const contactDecision = this.contactOwner?.checkEquipment(contactGarments);
      if (contactDecision && !contactDecision.allowed) {
        const error = new Error(`Equipment contact ${contactDecision.status}`);
        error.decision = contactDecision;
        throw error;
      }
      // Keep the current outfit visible and owned throughout asynchronous I/O.
      // Admission also runs before retirement; a failed replacement changes no
      // committed equipment. Late loads remain owned by this request.
      const loaded = [];
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
        loaded.push({ spec, descriptor, asset, resources });
      }
      const loadedContactDecision = this.contactOwner?.checkEquipment(contactGarments);
      if (loadedContactDecision && !loadedContactDecision.allowed)
        throw new Error(`Equipment contact ${loadedContactDecision.status}`);
      if (this.disposed || generation !== this.generation)
        return { stale: true };
      for (const { spec, descriptor, asset, resources } of loaded) {
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
          contact: contactsByMount.get(spec.id),
          unverifiedSource: Boolean(load),
          last: authoredWorld.clone(),
        };
        pending.push(record);
        unclaimed.delete(asset);
        // Binding-owned static assembly, after cleanup owns the private root.
        descriptor.fitParts?.(root);
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
      // The old outfit can occupy every emitter slot. Stage a separate bounded
      // runtime, accounted by this request's lease, instead of dropping effects.
      if (this.createEffects) {
        pendingEffectRoot = new T.Group();
        pendingEffects = this.createEffects(pendingEffectRoot);
      }
      for (const spec of raw.effects) {
        const item = stagedMounts.get(spec.mountId);
        pendingHandles.push(
          (pendingEffects ?? this.effects).enter({ ...spec, anchor: item.delta }),
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
      const finalContactDecision = this.contactOwner?.checkEquipment(contactGarments);
      if (finalContactDecision && !finalContactDecision.allowed)
        throw new Error(`Equipment contact ${finalContactDecision.status}`);
      if (pendingEffectRoot) this.scene.add(pendingEffectRoot);
      this.contactOwner?.stop("equipment-replacement");
      if (this.disposed || generation !== this.generation)
        return { stale: true };
      lease.commit(residentBytes);
      const retired = {
        strategy: this.strategy, handles: this.handles,
        mounts: this.mounts, equipLease: this.equipLease,
        effects: pendingEffects ? this.effects : null,
        effectRoot: pendingEffects ? this.effectRoot : null,
      };
      // No external callbacks below: transfer all staged ownership atomically.
      this.mounts = new Map();
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
      if (pendingEffects) {
        this.effects = pendingEffects; this.effectRoot = pendingEffectRoot;
        pendingEffects = null; pendingEffectRoot = null;
      }
      committed = true;
      // A post-commit disposal failure must not turn the applied replacement
      // into a retryable failure. Old resources are independently released.
      let cleanupError = null;
      try { releaseEquipment(retired); } catch (error) { cleanupError = error; }
      return { stale: this.disposed || generation !== this.generation, plan,
        ...(cleanupError ? { cleanupError } : {}) };
    } catch (error) {
      equipError = error;
      // Pending resources are released below. Never remove a committed outfit
      // because its replacement failed to load or validate.
      throw equipError;
    } finally {
      this.pendingEquips--;
      const cleanup = [
        () => {
          if (this.equipLease !== lease) lease.release();
        },
        () => pendingStrategy?.dispose(),
        ...pendingHandles.map((handle) => () => handle?.dispose()),
        () => pendingEffects?.dispose(),
        () => pendingEffectRoot?.removeFromParent(),
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
      this.contactSuspended = Boolean(hidden || reducedMotion);
      if (hidden || reducedMotion) this.f.h.suspend();
      else this.f.h.resume();
      this.actionFacts = facts;
      if (hidden || reducedMotion) this.contactOwner?.stop(hidden ? "hidden" : "reduced-motion");
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
    this.configuration = null;
    cleanupOwned([
      () => this.contactOwner?.stop("unequip"),
      () => releaseEquipment({ strategy, handles, mounts, equipLease }),
    ], "Equipment cleanup failures");
  }
  reset() {
    this.assertActive();
    this.generation++;
    this.actionFacts = [];
    const time = this.time;
    try {
      cleanupOwned(
      [
        () => this.contactOwner?.stop("reset"),
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
    } catch (error) {
      try { this.dispose(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Reset failure and actor cleanup");
      }
      throw error;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    cleanupOwned(
      [
        () => this.remove(),
        () => this.contactOwner?.dispose(),
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
        () => this.ownedPartsSource?.close(),
        () => this.scene.clear(),
        () => this.onDispose?.(),
      ],
      "Actor disposal failures",
    );
  }
}
function releaseEquipment({ strategy, handles, mounts, equipLease, effects, effectRoot }) {
  cleanupOwned([
    () => equipLease?.release(),
    () => strategy?.dispose(),
    ...handles.map(handle => () => handle?.dispose()),
    () => effects?.dispose(), () => effectRoot?.removeFromParent(),
    ...[...mounts.values()].flatMap(item => [
      () => item.secondary?.dispose(), () => item.root.removeFromParent(),
    ]),
    () => disposeAssets([...mounts.values()].map(item => item.asset)),
  ], "Retired equipment cleanup failures");
}

return Object.freeze({ FoundationPool, FoundationActor });
}
