import fs from "node:fs";
import { createHash } from "node:crypto";
import { createContactRegistry } from "./admission.mjs";

/** Node research composition verifies actual bytes before admitting any evidence.
 * This registry currently contains a blocker, no production-compatible action.
 */
export function loadResearchContactEvidence() {
  const manifest = JSON.parse(fs.readFileSync(new URL("./research-evidence.json", import.meta.url)));
  for (const [name, expected] of Object.entries(manifest.sources)) {
    const bytes = fs.readFileSync(new URL(`../../${name}`, import.meta.url));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`Stale contact evidence: ${name}`);
  }
  return {
    actor: Object.freeze(manifest.actor),
    action: Object.freeze(manifest.action),
    garment: Object.freeze(manifest.garment),
    registry: createContactRegistry([manifest.record]),
  };
}
