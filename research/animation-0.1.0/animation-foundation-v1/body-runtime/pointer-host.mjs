import { createBodyAdapterClass } from "./body-adapter.mjs";
import { createAuthoredFacePort } from "./authored-face-port.mjs";
import { MeshBVH } from "three-mesh-bvh";
import { createSurfaceQuery } from "./surface-query.mjs";
import { createPointerCoordinateReader, readClientPoint } from "./pointer-coordinates.mjs";
import { readPointerView, samePointerView } from "./pointer-view.mjs";
export function createPointerHostFactory({
  THREE: T,
  createAdmittedHost,
  facts,
  DragController,
  smooth,
  PettingController,
}) {
  const BodyRigAdapter = createBodyAdapterClass(T);
  const blend = (a, b, u) => {
    const out = { body: {}, joints: {} };
    for (const k of ["x", "y", "z"])
      out.body[k] = (a.body?.[k] ?? 0) * (1 - u) + (b.body?.[k] ?? 0) * u;
    for (const n of ["Shoulder_L", "Shoulder_R", "Hip_L", "Hip_R"]) {
      out.joints[n] = {};
      for (const k of ["x", "y", "z"])
        out.joints[n][k] =
          (a.joints?.[n]?.[k] ?? 0) * (1 - u) + (b.joints?.[n]?.[k] ?? 0) * u;
    }
    return out;
  };
  /** DOM pointer adapter, one actor/face owner/body writer. scheduler uses seconds,
   * while browser default maps performance.now and RAF milliseconds to seconds.
   * Admission is internal Raycaster against owned skin; no public eligible/hit input.
   * CSS client coordinates map through rect to the ray. Motion DIP are separate:
   * native window travel must not be counted twice or disappear from inertia.
   * Backbuffer/DPR never enters either space. The default remains client DIP.
   */
  async function createPointerHost({
    target,
    windowTarget = globalThis.window,
    documentTarget = globalThis.document,
    camera,
    profile,
    readPack,
    modelVariant = "full18",
    dragOptions = {},
    bodyOptions = {},
    scheduler = {
      now: () => performance.now() / 1000,
      request: (cb) => requestAnimationFrame((ms) => cb(ms / 1000)),
      cancel: (id) => cancelAnimationFrame(id),
    },
    dragPixels = 8,
    qualifySec = 0.4,
    authoredFaces = [],
    beforeCommit = () => {},
    readMotionPoint,
  } = {}) {
    if (
      !target?.addEventListener ||
      !camera?.isCamera ||
      !profile ||
      !Number.isFinite(dragPixels) ||
      dragPixels <= 0
    )
      throw Error(
        "DOM target, camera, profile and bounded thresholds required",
      );
    const readCoordinates = createPointerCoordinateReader(readMotionPoint);
    const yawDegrees =
      bodyOptions?.yawDegrees === undefined ? 52 : bodyOptions.yawDegrees;
    if (
      !bodyOptions ||
      typeof bodyOptions !== "object" ||
      Array.isArray(bodyOptions) ||
      Object.keys(bodyOptions).some((k) => k !== "yawDegrees") ||
      !Number.isFinite(yawDegrees) ||
      Math.abs(yawDegrees) > 180
    )
      throw RangeError(
        "Only finite bodyOptions.yawDegrees within -180..180 is supported",
      );
    const drag = new DragController(profile, dragOptions),
      pet = new PettingController({ qualifySec, dragPixels });
    let admitted, body;
    try {
      admitted = await createAdmittedHost(readPack, {
        modelVariant,
        authoredFaces,
      });
      body = new BodyRigAdapter(admitted.owner.root, { yawDegrees });
    } catch (error) {
      for (const clean of [
        () => drag.dispose(),
        () => pet.dispose(),
        () => body?.dispose(),
        () => admitted?.owner.dispose(),
        () => admitted?.pool.dispose(),
      ]) {
        try {
          clean();
        } catch {}
      }
      throw error;
    }
    const { owner, pool, pack } = admitted;
    const faceInput = createAuthoredFacePort(authoredFaces, admitted.authoredFaceKeys);
    const facePort = faceInput.port;
    let surfaceQuery = null;
    let cleanup = () => {
      for (const fn of [
        () => surfaceQuery?.dispose(),
        () => drag.dispose(),
        () => pet.dispose(),
        () => body.dispose(),
        () => owner.dispose(),
        () => pool.dispose(),
      ]) {
        try {
          fn();
        } catch {}
      }
    };
    try {
      const raycaster = new T.Raycaster();
      surfaceQuery = createSurfaceQuery({
        THREE: T,
        MeshBVH,
        skin: body.skin,
        assertCurrent: () => owner.assertCurrent(),
      });
      let queue = [],
        sealed = -Infinity,
        lastReceived = -Infinity,
        active = null,
        mode = "idle",
        face = null,
        life = owner.maxAdmittedLifetime,
        lastFaceAt = -Infinity,
        closed = false,
        hidden = false,
        blurred = false,
        raf = null,
        release = null,
        transition = null,
        restContext = false,
        lastPose = { body: {}, joints: {} },
        last = null;
      let ground = body.minimumFoot();
      const listeners = [];
      const diagnostics = {
        surface: surfaceQuery.diagnostics,
        rejected: 0,
        captureFailures: 0,
        releaseFailures: 0,
        commits: 0,
        lifecycleInvalidations: 0,
        viewInvalidations: 0,
        fixtureDownRejections: 0,
      };
      let contactGeneration = 0;
      // Collector-only ownership fence. It outlives release/cancellation until a
      // verified return disarms it; ordinary gestures never enter this branch.
      let fixtureGrip = null, finishedFixtureGrip = null, downNotBefore = null;
      let currentView = readPointerView(target, camera);
      function admitView(queuedView = null) {
        const observed = readPointerView(target, camera);
        const changed = !samePointerView(currentView, observed)
          || (queuedView !== null && !samePointerView(queuedView, observed));
        currentView = observed;
        if (changed && (active || queue.length || mode !== "idle")) {
          diagnostics.viewInvalidations++;
          // Same lifecycle barrier as blur/hidden. No fake timestamps or replay
          // of old local coordinates under a new camera/rect mapping.
          suspend(); resume();
          return null;
        }
        return observed;
      }
      function ray(x, y) {
        const r = target.getBoundingClientRect();
        if (
          ![x, y, r.left, r.top, r.width, r.height].every(Number.isFinite) ||
          r.width <= 0 ||
          r.height <= 0
        )
          return null;
        camera.updateMatrixWorld(true);
        body.root.updateMatrixWorld(true);
        raycaster.setFromCamera(
          new T.Vector2(
            ((x - r.left) / r.width) * 2 - 1,
            1 - ((y - r.top) / r.height) * 2,
          ),
          camera,
        );
        return {
          ray: raycaster.ray.clone(),
          inside:
            x >= r.left &&
            x <= r.left + r.width &&
            y >= r.top &&
            y <= r.top + r.height,
        };
      }
      function hit(x, y) {
        const r = ray(x, y);
        if (!r?.inside) return null;
        return surfaceQuery.firstHit(raycaster);
      }
      function viewStamp() {
        const rect = target.getBoundingClientRect();
        camera.updateMatrixWorld(true);
        return [
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          ...camera.matrixWorld.elements,
          ...camera.projectionMatrix.elements,
        ];
      }
      function sameStamp(left, right) {
        return (
          left?.length === right.length &&
          right.every((value, index) => value === left[index])
        );
      }
      function pendingSurfaceChanged() {
        body.root.updateMatrixWorld(true);
        const skin = body.skin;
        const stamp = [
          ...viewStamp(),
          ...skin.matrixWorld.elements,
          skin.geometry.attributes.position.version,
          ...skin.bindMatrix.elements,
          ...skin.bindMatrixInverse.elements,
          ...(skin.morphTargetInfluences ?? []),
        ];
        for (const bone of skin.skeleton.bones)
          stamp.push(...bone.matrixWorld.elements);
        const changed = !sameStamp(active.pendingSurfaceStamp, stamp);
        active.pendingSurfaceStamp = stamp;
        return changed;
      }
      function contact(h) {
        if (!h) return { eligible: false, side: 0 };
        const p = body.skin.worldToLocal(h.point.clone());
        return {
          eligible: p.y >= 1.2 && p.y <= 1.65,
          side: Math.max(-1, Math.min(1, p.x / 0.7)),
        };
      }
      function capture() {
        try {
          target.setPointerCapture(active.id);
          active.captured = target.hasPointerCapture?.(active.id) ?? true;
        } catch {
          diagnostics.captureFailures++;
          active.captured = false;
        }
      }
      function dropCapture(a) {
        if (!a?.captured) return;
        a.captured = false;
        try {
          target.releasePointerCapture(a.id);
        } catch {
          diagnostics.releaseFailures++;
        }
      }
      function advancePet(t) {
        while (pet.deadline <= t) {
          pet.advance(pet.deadline);
          pet.drain();
        }
        pet.advance(t);
        pet.drain();
      }
      function petInput(type, t, e = {}, c = {}) {
        advancePet(t);
        pet.input({
          type,
          time: t,
          pointerId: active?.id ?? 0,
          x: e.motionX ?? 0,
          y: e.motionY ?? 0,
          ...c,
        });
        pet.drain();
      }
      function updatePointer(e) {
        // Keep the original surface target, not a frozen body/root pose. The
        // ordinary applyPose -> surfaceAnchor correction remains the only writer.
        if (fixtureGrip?.contact === active) return;
        const r = ray(e.x, e.y);
        if (r && active) {
          const p = r.ray.intersectPlane(active.plane, new T.Vector3());
          if (p) active.point.copy(p);
        }
      }
      function startDrag(t, e) {
        const from = lastPose;
        petInput("interrupt", t);
        mode = "drag";
        transition = { from, time: t };
        drag.begin(t, { x: active.downMotion.x, y: -active.downMotion.y });
        drag.move(t, { x: e.motionX, y: -e.motionY });
        updatePointer(e);
      }
      function finish(t, reason) {
        if (!active) return;
        const a = active;
        if (mode === "drag") {
          apply(t);
          const height = Math.max(0, body.minimumFoot() - ground),
            duration = Math.max(
              0.35,
              Math.min(1.5, 0.35 + Math.sqrt(height) * 0.45),
            );
          release = {
            time: t,
            duration,
            height,
            x: body.root.position.x,
            z: body.root.position.z,
          };
          drag.release(t, { duration, cancel: reason !== "up" });
          mode = "landing";
        } else {
          petInput(reason === "up" ? "up" : "cancel", t);
          mode = pet.snapshot().phase === "idle" ? "idle" : "petting";
        }
        active = null;
        dropCapture(a);
        if (fixtureGrip?.contact === a) fixtureGrip.releaseObserved = reason === "up";
        if (finishedFixtureGrip?.contactGeneration === a.contactGeneration) {
          finishedFixtureGrip = reason === "up" ? { ...finishedFixtureGrip, releaseObserved: true,
            terminal: true, captured: false, domCaptured: target.hasPointerCapture(a.id) } : null;
        }
      }
      function process(e) {
        const t = e.t;
        if (e.type === "down") {
          const regrabbing = mode === "landing" && drag.mode === "settle";
          if (
            fixtureGrip ||
            active ||
            e.primary === false ||
            e.button !== 0 ||
            hidden ||
            (mode === "landing" && !regrabbing)
          )
            return;
          const h = hit(e.x, e.y);
          if (!h) return;
          const c = contact(h);
          restContext = false;
          if (regrabbing || drag.snapshot().faceIntent) drag.interrupt(t);
          if (!regrabbing) ground = body.minimumFoot();
          const normal = camera.getWorldDirection(new T.Vector3());
          finishedFixtureGrip = null;
          active = {
            id: e.id,
            contactGeneration: ++contactGeneration,
            downMotion: { x: e.motionX, y: e.motionY },
            latest: { x: e.x, y: e.y },
            anchor: body.surfaceAnchor(h),
            point: h.point.clone(),
            plane: new T.Plane().setFromNormalAndCoplanarPoint(normal, h.point),
            captured: false,
            petEligible: c.eligible,
          };
          mode = "pending";
          release = null;
          transition = regrabbing
            ? { from: lastPose, time: t, duration: 0.12 }
            : null;
          petInput("down", t, e, c);
          capture();
          return;
        }
        if (!active || e.id !== active.id) return;
        if (["up", "cancel", "lostcapture"].includes(e.type)) {
          if (
            e.type === "up" &&
            mode === "drag" &&
            [e.x, e.y, e.motionX, e.motionY].every(Number.isFinite)
          ) {
            drag.move(t, { x: e.motionX, y: -e.motionY });
            updatePointer(e);
          }
          finish(t, e.type);
          return;
        }
        if (e.type === "leave") {
          // A fixture terminal releases DOM capture on receipt, but a leave
          // queued before it still belongs to the previously captured drag.
          const captured = active.captured || fixtureGrip?.contact === active && fixtureGrip.terminalPending;
          if (mode === "pending" || !captured) finish(t, "cancel");
          return;
        }
        if (e.type === "move") {
          if (e.buttons === 0) {
            finish(t, "cancel");
            return;
          }
          active.latest = { x: e.x, y: e.y };
          if (mode === "drag") {
            drag.move(t, { x: e.motionX, y: -e.motionY });
            updatePointer(e);
            return;
          }
          // Once a held gesture exceeds drag threshold, capture permits leaving skin.
          if (
            Math.hypot(e.motionX - active.downMotion.x, e.motionY - active.downMotion.y) > dragPixels
          ) {
            if (active.captured || hit(e.x, e.y)) startDrag(t, e);
            else finish(t, "cancel");
            return;
          }
          const c = contact(hit(e.x, e.y));
          if (!c.eligible) {
            finish(t, "cancel");
            return;
          }
          petInput("move", t, e, c);
        }
      }
      function advanceControllers(t) {
        // Lost pending eligibility must be revoked before crossing its qualification
        // boundary. This cancellation has no emitted face/body intent to backdate.
        if (
          active &&
          mode === "pending" &&
          pet.phase === "pending" &&
          pendingSurfaceChanged() &&
          !contact(hit(active.latest.x, active.latest.y)).eligible
        ) {
          petInput("cancel", pet.time);
          const a = active;
          active = null;
          mode = "idle";
          dropCapture(a);
        }
        drag.advance(t);
        advancePet(t);
        if (active && mode === "pending") {
          // Qualify against the current surface once. A held gesture owns its
          // admitted target until pointer movement or a lifecycle event revokes
          // it; the character's own animation must not repeatedly retarget it.
          // The move handler still checks the actual deformed surface.
          if (pet.snapshot().held) {
            if (!contact(hit(active.latest.x, active.latest.y)).eligible) {
              finish(t, "cancel");
            } else {
              mode = "petting";
              active.heldViewStamp = viewStamp();
            }
          }
        } else if (active && mode === "petting") {
          const stamp = viewStamp();
          if (!sameStamp(active.heldViewStamp, stamp)) {
            if (!contact(hit(active.latest.x, active.latest.y)).eligible)
              finish(t, "cancel");
            else active.heldViewStamp = stamp;
          }
        }
        if (mode === "landing" && drag.mode === "rest") {
          restContext = true;
          mode = "idle";
          release = null;
          transition = null;
        }
        if (mode === "petting" && !active && pet.phase === "idle")
          mode = "idle";
      }
      function apply(t) {
        let pose =
          mode === "idle"
            ? { body: {}, joints: {} }
            : mode === "drag" || mode === "landing"
              ? drag.snapshot().pose
              : pet.snapshot();
        if (transition && mode !== "idle")
          pose = blend(
            transition.from,
            pose,
            smooth((t - transition.time) / (transition.duration ?? 0.22)),
          );
        lastPose = pose;
        body.applyPose(pose);
        if (active && mode === "drag") {
          const p = body.surfacePoint(active.anchor);
          body.place({
            x: body.root.position.x + active.point.x - p.x,
            y: body.root.position.y + active.point.y - p.y,
            z: body.root.position.z + active.point.z - p.z,
          });
          body.constrainGround(ground);
        } else if (release) {
          const y =
            ground +
            release.height *
              (1 - smooth((t - release.time) / release.duration));
          body.place({ x: release.x, z: release.z });
          body.place({ y: body.root.position.y + y - body.minimumFoot() });
        } else
          body.place({ y: body.root.position.y + ground - body.minimumFoot() });
      }
      function snapshot(t) {
        return {
          time: t,
          mode,
          hidden,
          pointerId: active?.id ?? null,
          contactGeneration: active?.contactGeneration ?? null,
          captured: active?.captured ?? false,
          drag: drag.snapshot(),
          pet: pet.snapshot(),
          body: body.snapshot(),
          face: owner.state,
        };
      }
      function commit(t) {
        beforeCommit({ time: t, mode });
        apply(t);
        const candidate =
            mode === "drag" || mode === "landing" || mode === "idle"
              ? drag.snapshot().faceIntent
              : mode === "petting" && pet.phase !== "idle"
                ? pet.snapshot().face
                : null,
          events = [];
        if (
          candidate !== face?.candidate ||
          (candidate && t - lastFaceAt >= 20)
        ) {
          lastFaceAt = t;
          if (face && candidate !== face.candidate)
            events.push({
              type: "release",
              owner: "interaction",
              requestId: face.requestId,
              lifetime: face.lifetime,
            });
          face = null;
          if (candidate) {
            face = { candidate, lifetime: ++life, requestId: "pointer" + life };
            events.push({
              type: "request",
              owner: "interaction",
              ...face,
              holdMode: "restart",
            });
          }
        }
        const authored = faceInput.consume(
          t,
          !!active || mode !== "idle" || !!candidate,
          () => ++life,
        );
        events.push(...authored.events);
        owner.completeBatch({
          wallTime: t,
          epoch: owner.epoch,
          facts: facts(
            !!active || mode !== "idle" || !!candidate || authored.active,
            { rest: mode === "idle" && restContext && !candidate },
          ),
          events,
        });
        owner.assertCurrent();
        sealed = t;
        diagnostics.commits++;
        last = snapshot(t);
        return last;
      }
      function doFrame(t) {
        if (closed || hidden) return;
        if (!Number.isFinite(t) || t < sealed)
          throw Error("Monotonic frame time");
        if (!admitView()) return last;
        while (queue.length && queue[0].t <= t) {
          if (!admitView(queue[0].view)) return last;
          const at = queue[0].t;
          advanceControllers(at);
          apply(at);
          while (queue.length && queue[0].t === at) {
            if (!admitView(queue[0].view)) return last;
            process(queue.shift());
          }
          commit(at);
        }
        if (t > sealed) {
          advanceControllers(t);
          commit(t);
        }
        return last;
      }
      function frame(t) {
        try {
          return doFrame(t);
        } catch (error) {
          try {
            dispose();
          } catch {}
          throw error;
        }
      }
      function receive(type, event) {
        if (closed || hidden) return false;
        if (type === "down" && (fixtureGrip || downNotBefore !== null
          && (!Number.isFinite(event.timeStamp) || event.timeStamp <= downNotBefore))) {
          diagnostics.fixtureDownRejections++;
          return false;
        }
        const t = scheduler.now();
        if (fixtureGrip?.contact === active && event.pointerId === active?.id
          && type === "move" && event.buttons === 0) type = "cancel";
        if (
          Number.isFinite(t) &&
          t <= sealed &&
          active?.id === event.pointerId &&
          ["up", "cancel", "lostcapture"].includes(type)
        ) {
          diagnostics.lifecycleInvalidations++;
          suspend();
          resume();
          return true;
        }
        if (fixtureGrip?.contact === active && active?.id === event.pointerId
          && ["up", "cancel", "lostcapture"].includes(type) && queue.length >= 1024
          && Number.isFinite(t) && t >= lastReceived) {
          // No room for a terminal batch: retain the fence and use the existing
          // lifecycle fallback rather than leave native capture stranded.
          diagnostics.lifecycleInvalidations++;
          suspend(); resume();
          return true;
        }
        if (
          !Number.isFinite(t) ||
          t < 0 ||
          t <= sealed ||
          t < lastReceived ||
          queue.length >= 1024
        ) {
          diagnostics.rejected++;
          return false;
        }
        if (
          !Number.isSafeInteger(event.pointerId) ||
          event.pointerId < 0
        ) {
          diagnostics.rejected++;
          return false;
        }
        const view = admitView();
        if (!view) { diagnostics.rejected++; return false; }
        const clientPoint = readClientPoint(event);
        if (["down", "move"].includes(type) && !clientPoint) {
          diagnostics.rejected++;
          return false;
        }
        const point = ["down", "move", "up"].includes(type)
          ? readCoordinates(event, clientPoint) : null;
        if (["down", "move"].includes(type) && !point) {
          diagnostics.rejected++;
          // Revoke this pointer in queue order, including a down not yet framed.
          // Never reuse the last motion sample or change coordinate spaces.
          if (type === "move") {
            queue.push({ type: "cancel", t, id: event.pointerId, view });
            lastReceived = t;
            releaseFixtureCapture(event.pointerId);
          }
          return false;
        }
        queue.push({
          type,
          t,
          view,
          id: event.pointerId,
          primary: event.isPrimary,
          button: event.button,
          buttons: event.buttons,
          ...point,
        });
        lastReceived = t;
        // Release DOM capture even while a host receipt is in flight. Keep the
        // original queue order and clock: the next ordinary frame owns landing.
        if (fixtureGrip?.contact === active && event.pointerId === active?.id
          && ["up", "cancel", "lostcapture"].includes(type)) {
          releaseFixtureCapture(event.pointerId);
        }
        return true;
      }
      function releaseFixtureCapture(pointerId) {
        if (fixtureGrip?.contact !== active || active?.id !== pointerId) return;
        fixtureGrip.terminalPending = true;
        dropCapture(active);
        last = snapshot(sealed);
      }
      function projectFixtureGrip(contact) {
        const stamp = readPointerView(target, camera);
        if (!stamp) return null;
        const world = body.surfacePoint(contact.anchor);
        const projected = world.clone().project(camera);
        const client = { x: stamp[0] + (projected.x + 1) * stamp[2] / 2,
          y: stamp[1] + (1 - projected.y) * stamp[3] / 2 };
        if (![...world.toArray(), projected.z, client.x, client.y].every(Number.isFinite)) return null;
        return { stamp: [...stamp], gripWorld: { x: world.x, y: world.y, z: world.z }, gripClient: client };
      }
      function readFixtureGrip(probeId) {
        if (!closed && !fixtureGrip && finishedFixtureGrip?.probeId === probeId)
          return structuredClone(finishedFixtureGrip);
        if (closed || !fixtureGrip || fixtureGrip.probeId !== probeId)
          return { ok: false, reason: closed ? "disposed" : "not-armed" };
        const current = projectFixtureGrip(fixtureGrip.contact);
        if (!current) return { ok: false, reason: "invalid-view" };
        const owns = fixtureGrip.contact === active;
        return { ok: true, probeId, contactGeneration: fixtureGrip.contact.contactGeneration,
          pointerId: fixtureGrip.contact.id, mode, pendingCount: queue.length,
          captured: owns && active.captured, domCaptured: target.hasPointerCapture(fixtureGrip.contact.id),
          terminal: !owns || fixtureGrip.terminalPending, terminalPending: owns && fixtureGrip.terminalPending,
          releaseObserved: fixtureGrip.releaseObserved,
          cancelled: fixtureGrip.cancelled, fenced: true, finished: false,
          localGrip: { ...fixtureGrip.localGrip }, ...current };
      }
      function prepareFixtureGrip({ probeId } = {}) {
        if (typeof probeId !== "string" || !probeId || probeId.length > 128)
          return { ok: false, reason: "invalid-probe" };
        if (closed || hidden || fixtureGrip || queue.length || !admitView() || mode !== "drag"
          || !active?.captured || !target.hasPointerCapture(active.id))
          return { ok: false, reason: "contact-unavailable" };
        const current = projectFixtureGrip(active);
        if (!current) return { ok: false, reason: "invalid-view" };
        fixtureGrip = { probeId, contact: active, stamp: current.stamp,
          localGrip: { x: active.point.x, y: active.point.y, z: active.point.z },
          cancelled: false, terminalPending: false, releaseObserved: false };
        finishedFixtureGrip = null;
        return readFixtureGrip(probeId);
      }
      function finishFixtureGrip(probeId, { eventNotBefore } = {}) {
        if (!fixtureGrip) return { ok: false, reason: closed ? "disposed" : "not-armed" };
        const current = readFixtureGrip(probeId);
        if (!current.ok) return current;
        if (!Number.isFinite(eventNotBefore) || eventNotBefore < 0 || queue.length
          || !samePointerView(fixtureGrip.stamp, current.stamp))
          return { ok: false, reason: "unsafe-disarm" };
        // The bound is a real DOM timestamp supplied by the browser facade, not
        // actor time. Events generated inside the fence cannot arrive after it.
        downNotBefore = Math.max(downNotBefore ?? 0, eventNotBefore);
        if (fixtureGrip.contact === active) active.latest = { ...current.gripClient };
        fixtureGrip = null;
        // Retain one copied completion observation, never a retired actor/anchor.
        finishedFixtureGrip = { ...current, fenced: false, finished: true };
        return structuredClone(finishedFixtureGrip);
      }
      function cancelFixtureGrip(probeId) {
        if (closed || fixtureGrip?.probeId !== probeId) return false;
        fixtureGrip.cancelled = true;
        if (fixtureGrip.contact !== active) return true;
        suspend(); resume();
        return true;
      }
      // Lifecycle barriers invalidate queued input/capture synchronously, even when the
      // current clock equals a sealed frame. They do not invent epsilon timestamps.
      function suspend() {
        if (closed || hidden) return;
        finishedFixtureGrip = null;
        const t = Math.max(sealed, drag.time, pet.time, scheduler.now());
        hidden = true;
        faceInput.reset();
        queue = [];
        const a = active;
        // A lifecycle/view barrier revokes unqualified contact before advancing
        // over its deadline. It must not manufacture a held/release expression
        // during a frame gap; no face/body intent has been emitted for pending.
        if (active && mode === "pending" && pet.phase === "pending")
          petInput("cancel", pet.time);
        active = null;
        dropCapture(a);
        drag.suspend(t);
        petInput("hidden", t);
        face = null;
        release = null;
        transition = null;
        restContext = false;
        mode = "idle";
        lastPose = { body: {}, joints: {} };
        body.restore();
        body.place({ y: body.root.position.y + ground - body.minimumFoot() });
        owner.suspend(t);
        if (
          owner.weightedState.facts.context === "rest" ||
          owner.state.owner === "p1_idle"
        )
          owner.invalidate(owner.epoch);
        hidden = true;
        sealed = t;
        last = snapshot(t);
      }
      function resume() {
        if (closed || !hidden || documentTarget?.hidden || blurred) return;
        const t = Math.max(sealed, scheduler.now());
        drag.resume(t);
        advancePet(t);
        owner.resume(t);
        hidden = false;
        sealed = t;
        last = snapshot(t);
      }
      function dispose() {
        if (closed) return;
        closed = true;
        faceInput.dispose();
        queue = [];
        last = {
          ...last,
          mode: "disposed",
          pointerId: null,
          contactGeneration: null,
          captured: false,
          disposed: true,
        };
        const a = active;
        active = null;
        dropCapture(a);
        fixtureGrip = null;
        finishedFixtureGrip = null;
        const ticket = raf;
        raf = null;
        let error;
        for (const clean of [
          () => {
            if (ticket !== null) scheduler.cancel(ticket);
          },
          ...listeners.splice(0),
          () => surfaceQuery.dispose(),
          () => drag.dispose(),
          () => pet.dispose(),
          () => body.dispose(),
          () => owner.dispose(),
          () => pool.dispose(),
        ]) {
          try {
            clean();
          } catch (e) {
            error ??= e;
          }
        }
        if (error) throw error;
      }
      cleanup = dispose;
      function listen(obj, type, fn) {
        if (!obj?.addEventListener) return;
        listeners.push(() => obj.removeEventListener(type, fn));
        obj.addEventListener(type, fn);
      }
      try {
        for (const [dom, type] of Object.entries({
          pointerdown: "down",
          pointermove: "move",
          pointerup: "up",
          pointercancel: "cancel",
          lostpointercapture: "lostcapture",
          pointerleave: "leave",
        }))
          listen(target, dom, (e) => receive(type, e));
        listen(windowTarget, "blur", () => {
          blurred = true;
          suspend();
        });
        listen(windowTarget, "focus", () => {
          blurred = false;
          resume();
        });
        listen(documentTarget, "visibilitychange", () =>
          documentTarget.hidden ? suspend() : resume(),
        );
        // A release outside target is observed even after capture acquisition failed.
        listen(windowTarget, "pointerup", (e) => {
          if (e.target !== target) receive("up", e);
        });
        listen(windowTarget, "pointercancel", (e) => {
          if (e.target !== target) receive("cancel", e);
        });
        if (documentTarget?.hidden) suspend();
        function loop(t) {
          raf = null;
          if (closed) return;
          try {
            frame(t);
            if (!closed) raf = scheduler.request(loop);
          } catch (error) {
            try {
              dispose();
            } catch {}
            throw error;
          }
        }
        raf = scheduler.request(loop);
      } catch (error) {
        try {
          dispose();
        } catch {}
        throw error;
      }
      return {
        owner,
        pool,
        pack,
        body,
        facePort,
        diagnostics,
        frame,
        prepareFixtureGrip,
        readFixtureGrip,
        finishFixtureGrip,
        cancelFixtureGrip,
        get state() {
          return last;
        },
        get pendingCount() {
          return queue.length;
        },
        get contactGenerationHighWater() {
          return contactGeneration;
        },
        get interactionTailActive() {
          if (closed) return false;
          const weighted = owner.weightedState, director = weighted.director;
          // Body rest precedes the smile deadline. Its owner's fade and the
          // existing gentle rest-face entry must also complete before pausing.
          return Boolean(active || queue.length || mode !== "idle" || drag.snapshot().faceIntent
            || pet.phase !== "idle" || weighted.facts.interactionOwned || director.owner === "interaction"
            || ["enter", "exit", "reset"].includes(director.phase));
        },
        discardUnownedInput() {
          if (closed || active || queue.length === 0) return false;
          queue = [];
          diagnostics.lifecycleInvalidations++;
          return true;
        },
        dispose,
        suspend,
        resume,
      };
    } catch (error) {
      try {
        cleanup();
      } catch {}
      throw error;
    }
  }

  // Explicit opt-in: policy and pack admission are selected together.
  const createD2PointerHost = (options) =>
    createPointerHost({ ...options, modelVariant: "d2" });

  return { createPointerHost, createD2PointerHost };
}
