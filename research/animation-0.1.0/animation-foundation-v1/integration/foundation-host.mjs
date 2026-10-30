/** Node research composition; the browser supplies equivalent bounded asset ports. */
import { createFoundationRuntime } from "./foundation-runtime.mjs";
import { createBody, createHybridSource, loadGLB, revised } from "./asset-fixtures.mjs";
import { createD2BindingProvider } from "./asset-bindings.mjs";
import { loadResearchContactEvidence } from "../contact/research-evidence.mjs";
export { RESOURCE_LIMITS } from "./resource-admission.mjs";
export const { FoundationPool, FoundationActor } = createFoundationRuntime({
  createBody, createHybridSource, loadGLB, revised,
  createD2BindingProvider, loadResearchContactEvidence,
});
