import test from "node:test";
import assert from "node:assert/strict";
import { validateMixedBindingContract } from "../mixed-binding-contract.mjs";
function fixture() {
  return {
    sourceSkin: {
      skeleton: {
        bones: [
          "Body",
          "Shoulder_L",
          "Shoulder_R",
          "Hip_L",
          "Hip_R",
          "HeadTouch",
          "AccessoryAnchor",
        ].map((name) => ({ name })),
      },
    },
    admittedSourceSHA256: "a".repeat(64),
    candidateSHA256: "b".repeat(64),
    contract: {
      source_sha256: "a".repeat(64),
      asset_sha256: "b".repeat(64),
      source_skin_joint_order: [
        "Body",
        "Shoulder_L",
        "Shoulder_R",
        "Hip_L",
        "Hip_R",
        "HeadTouch",
        "AccessoryAnchor",
      ],
      native_skinned_parts: ["Bubu_body", "Bubu_foot-left", "Bubu_foot-right"],
      rigid_parts: { "Bubu_hand-left": 1, "Bubu_hand-right": 2 },
    },
  };
}
test("matching admitted source, candidate and complete joint order passes", () =>
  assert.equal(validateMixedBindingContract(fixture()), true));
test("same bone count does not authorize a different source asset or bone order", () => {
  let f = fixture();
  f.admittedSourceSHA256 = "c".repeat(64);
  assert.throws(() => validateMixedBindingContract(f), /hash/);
  f = fixture();
  f.sourceSkin.skeleton.bones.reverse();
  assert.throws(() => validateMixedBindingContract(f), /order/);
  f = fixture();
  f.candidateSHA256 = "c".repeat(64);
  assert.throws(() => validateMixedBindingContract(f), /hash/);
});
