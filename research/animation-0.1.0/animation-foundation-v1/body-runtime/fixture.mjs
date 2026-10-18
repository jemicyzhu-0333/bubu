import { PET_CANDIDATES } from "../../petting-continuous-r2/src/pet-policy.mjs";
import {
  APPROVED_D2_FACE_SOURCE,
  D2_FACE_PROFILE_SHA256,
} from "../../runtime-facepath05/src/approved-d2-face-source.mjs";
// Browser-safe admission: caller supplies a bounded pack reader, never an actor,
// eligibility claim, face owner, or body writer. No node:fs in this import graph.
import { ActorPool } from "../../runtime-facepath05/src/actor-pool.mjs";
import { WeightedExpressionOwner } from "../../runtime-facepath05/src/expression-owner.mjs";
import {
  prepareFullFacePack,
  prepareD2FacePack,
} from "../../runtime-facepath05/src/pack-loader.mjs";
import { FULL_FACE_SLOT_IDS } from "../../runtime-facepath05/src/face-contract.mjs";
import { BODY_PROFILE_ID } from "../../runtime-facepath05/src/body-profile.mjs";
import { ADMISSION } from "../../expression-scheduler-p1/src/p0-binding.mjs";

import { createAdmissionFactory } from "./host-admission.mjs";
import { createPointerHostFactory } from "./pointer-host.mjs";
import {
  DragController,
  smooth,
} from "../../drag-landing-r5/src/drag-controller.mjs";
import { PettingController } from "../../petting-continuous-r2/src/petting-controller.mjs";
import { localPackReader } from "../../runtime-facepath05/tools/read-local-pack.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as T from "three";

const profile = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../drag-body-prototype-v1/replay/body-poses.json",
      import.meta.url,
    ),
  ),
);
const admission = createAdmissionFactory({
  PET_CANDIDATES,
  APPROVED_D2_FACE_SOURCE,
  D2_FACE_PROFILE_SHA256,
  ActorPool,
  WeightedExpressionOwner,
  prepareFullFacePack,
  prepareD2FacePack,
  FULL_FACE_SLOT_IDS,
  BODY_PROFILE_ID,
  ADMISSION,
});
const host = createPointerHostFactory({
  THREE: T,
  ...admission,
  DragController,
  smooth,
  PettingController,
});
export const createD2PointerHost = (options) =>
  host.createD2PointerHost({
    ...options,
    readPack: localPackReader(
      fileURLToPath(new URL(
        "../../runtime-facepath05/fixtures/face-d2/",
        import.meta.url,
      )),
    ),
  });
export class Target extends EventTarget {
  constructor() {
    super();
    this.rect = { left: 0, top: 0, width: 384, height: 384 };
    this.hidden = false;
    this.captured = new Set();
  }
  getBoundingClientRect() {
    return this.rect;
  }
  setPointerCapture(id) {
    this.captured.add(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
  emit(type, props = {}) {
    const e = new Event(type);
    Object.assign(e, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: 1,
      ...props,
    });
    this.dispatchEvent(e);
  }
}
export async function fixture(options = {}) {
  let now = 0,
    next = 0;
  const pending = new Map(),
    target = new Target(),
    doc = new Target(),
    win = new Target(),
    camera = new T.OrthographicCamera(-2.5, 2.5, 4, -1, 0.01, 100);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const h = await createD2PointerHost({
    ...options,
    target,
    documentTarget: doc,
    windowTarget: win,
    camera,
    profile,
    bodyOptions: { yawDegrees: 10 },
    scheduler: {
      now: () => now,
      request: (cb) => {
        pending.set(++next, cb);
        return next;
      },
      cancel: (id) => pending.delete(id),
    },
  });
  const point = (x = 0, y = 1.4) => {
    const p = new T.Vector3(x, y, 0).project(camera);
    return { clientX: (p.x + 1) * 192, clientY: (1 - p.y) * 192 };
  };
  return {
    h,
    target,
    doc,
    win,
    camera,
    pending,
    point,
    at: (t) => {
      now = t;
    },
    tick: (t) => {
      now = t;
      return h.frame(t);
    },
    emit: (type, t, props = {}) => {
      now = t;
      target.emit(type, { ...point(), ...props });
    },
  };
}

export const createPointerHost = host.createPointerHost;
