import { admitAuthoredFaces } from "./authored-face-port.mjs";
export function createAdmissionFactory({
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
}) {
  const facts = (interactionOwned, { rest = false } = {}) => ({
    context: rest ? "rest" : "none",
    source: "testfixture",
    enabled: rest,
    interactionOwned,
  });
  async function createAdmittedHost(
    readPack,
    { modelVariant = "full18", authoredFaces = [] } = {},
  ) {
    if (!["full18", "d2"].includes(modelVariant))
      throw new TypeError("Explicit full18 or d2 model variant required");
    const admission =
      modelVariant === "d2"
        ? {
            sourceSha256: APPROVED_D2_FACE_SOURCE.sha256,
            profileSha256: D2_FACE_PROFILE_SHA256,
          }
        : ADMISSION;
    if (typeof readPack !== "function")
      throw Error("Bounded full18 pack reader required");
    const pack = await (
        modelVariant === "d2" ? prepareD2FacePack : prepareFullFacePack
      )(readPack),
      pool = new ActorPool({ bodyProfile: BODY_PROFILE_ID });
    const policy = {
      format: "bubu-expression-scheduler",
      version: "0.1.0-p1",
      sourceSha256: admission.sourceSha256,
      profileSha256: admission.profileSha256,
      rng: { algorithm: "xorshift32-split-v1", seed: 42 },
      candidates: FULL_FACE_SLOT_IDS.map((faceId) => ({
        key: faceId,
        faceId,
        amount: 1,
        selectionWeight: 1,
        enterSec: 0.16,
        exitSec: 0.2,
        hold: { kind: "fixed", sec: 30 },
        gap: { kind: "fixed", sec: 0.3 },
        cooldownSec: 0,
        sources: ["testfixture"],
      })),
      contexts: [
        { key: "none", candidates: [], excludeRecent: 0 },
        { key: "rest", candidates: ["restR0"], excludeRecent: 0 },
      ],
    };
    // Landing-only timing never changes the ordinary petting P2 candidate.
    policy.candidates.push({
      key: "landingP2",
      faceId: "P2",
      amount: 1,
      selectionWeight: 1,
      enterSec: 0.1,
      exitSec: 0.4,
      hold: { kind: "fixed", sec: 30 },
      gap: { kind: "fixed", sec: 0.001 },
      cooldownSec: 0,
      sources: ["testfixture"],
    });
    policy.candidates.push({
      key: "restR0",
      faceId: "R0",
      amount: 1,
      selectionWeight: 1,
      enterSec: 0.16,
      exitSec: 0.2,
      hold: { kind: "fixed", sec: 30 },
      gap: { kind: "fixed", sec: 0.001 },
      cooldownSec: 0,
      sources: ["testfixture"],
    });
    policy.candidates.push(...PET_CANDIDATES);
    policy.candidates.push(
      ...admitAuthoredFaces(authoredFaces, FULL_FACE_SLOT_IDS),
    );
    let owner;
    try {
      owner = new WeightedExpressionOwner({
        pool,
        pack,
        policy,
        initialFacts: facts(false),
        visibilityPolicy: "freeze",
      });
      await owner.ready;
      return { owner, pool, pack };
    } catch (error) {
      try {
        owner?.dispose();
      } finally {
        pool.dispose();
      }
      throw error;
    }
  }

  return { facts, createAdmittedHost };
}
