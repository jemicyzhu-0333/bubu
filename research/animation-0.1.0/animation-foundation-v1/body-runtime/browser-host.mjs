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
import * as T from "three";

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
export const createD2PointerHost = host.createD2PointerHost;
export const createPointerHost = host.createPointerHost;
