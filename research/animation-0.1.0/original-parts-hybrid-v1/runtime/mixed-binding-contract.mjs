import { createMixedBindingAdapter } from "./mixed-binding-adapter.mjs";
/** Caller supplies hashes computed from the actual candidate bytes and the
 * source bytes admitted by SourceOwner. Merely asserting owner freshness is
 * insufficient to establish that an arbitrary candidate belongs to that rig.
 */
export function validateMixedBindingContract({
  sourceSkin,
  contract,
  admittedSourceSHA256,
  candidateSHA256,
}) {
  const sha = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
  if (
    !sha(admittedSourceSHA256) ||
    !sha(candidateSHA256) ||
    contract?.source_sha256 !== admittedSourceSHA256 ||
    contract?.asset_sha256 !== candidateSHA256
  )
    throw new Error("Mixed-binding source/candidate asset hash mismatch");
  const expected = contract.source_skin_joint_order,
    actual = sourceSkin?.skeleton?.bones.map((b) => b.name);
  if (
    !Array.isArray(expected) ||
    !expected.length ||
    !actual ||
    actual.length !== expected.length ||
    actual.some((name, i) => name !== expected[i])
  )
    throw new Error("Mixed-binding skeleton joint order mismatch");
  if (
    JSON.stringify(contract.native_skinned_parts) !==
      JSON.stringify(["Bubu_body", "Bubu_foot-left", "Bubu_foot-right"]) ||
    contract.rigid_parts?.["Bubu_hand-left"] !== 1 ||
    contract.rigid_parts?.["Bubu_hand-right"] !== 2
  )
    throw new Error("Mixed-binding part-to-rig contract mismatch");
  return true;
}
export function createContractCheckedMixedBindingAdapter(options) {
  const { assertSourceCurrent, sourceSkin } = options;
  assertSourceCurrent();
  validateMixedBindingContract(options);
  // Asset/hash and part mapping are immutable admission facts. Snapshot names
  // once; frame guards do no map/JSON allocations or repeated hash assertions.
  const names = options.contract.source_skin_joint_order.slice();
  const guard = () => {
    assertSourceCurrent();
    const bones = sourceSkin.skeleton?.bones;
    if (!bones || bones.length !== names.length)
      throw new Error("Mixed-binding skeleton joint order mismatch");
    for (let i = 0; i < names.length; i++)
      if (bones[i].name !== names[i])
        throw new Error("Mixed-binding skeleton joint order mismatch");
  };
  return createMixedBindingAdapter({ ...options, assertSourceCurrent: guard });
}
