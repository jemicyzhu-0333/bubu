// SYNTHETIC TEST IDENTIFIERS ONLY. Not production presets or approved artwork.
export const T = 1_800_000_000_000;
export function config() {
  return {schemaVersion:1, namespaces:['fixture:account-a','fixture:account-b'], maxRecords:128,
    capabilities:[{id:'fixture:overlay',approved:true,runtimeReady:true,channel:'environment.overlay'}],
    mappings:['routine','feed'].map(sourceKind => ({sourceKind,definitionId:sourceKind === 'routine' ? 'fixture:preset-coffee' : 'fixture:food-coffee',mappingVersion:'fixture:v1',themeId:'fixture:coffee',recipeVersion:'fixture:r1',approved:true,presentationMode:'overlay_only',overlayPolicyId:'fixture:compatible-budget-1',actionPolicyId:null,requiredCapabilities:['fixture:overlay'],assetPolicyDigest:'fixture:not-a-production-digest'}))};
}
export function event(overrides = {}) {
  const sourceKind = overrides.sourceKind ?? 'routine';
  const occurredAt = overrides.occurredAt ?? T;
  const original = {occurredAt, committedAt:occurredAt, origin:'live_completion',definitionId:sourceKind === 'routine' ? 'fixture:preset-coffee' : 'fixture:food-coffee',mappingVersion:'fixture:v1'};
  return {schemaVersion:1,namespace:'fixture:account-a',eventId:'fixture:event-1',transactionId:'fixture:transaction-1',sourceKind,entityId:'fixture:occurrence-1',completionGeneration:'fixture:g1',completionOrdinal:1,revision:1,operation:'complete',completionState:'completed',origin:'live_completion',postCommit:true,replayed:false,occurredAt,committedAt:occurredAt,receivedAt:occurredAt,timeDomain:'trusted_utc_ms',original,deadlineOccurredAt:occurredAt,revokeReason:null,...overrides};
}
export function revise(e, overrides = {}) {
  return {...structuredClone(e), eventId:`${e.eventId}:next`,transactionId:`${e.transactionId}:next`,revision:e.revision+1,...overrides};
}
