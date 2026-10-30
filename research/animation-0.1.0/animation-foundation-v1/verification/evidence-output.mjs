import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const foundation = fileURLToPath(new URL("../", import.meta.url));
const research = fs.realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
let output;
function canonicalDestination(requested) {
  let existing = path.resolve(requested);
  const missing = [];
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) throw Error("Unresolvable evidence directory");
    existing = parent;
  }
  const resolved = path.join(fs.realpathSync(existing), ...missing);
  const relative = path.relative(research, resolved);
  if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
    throw new Error("Choose an evidence directory outside the research sources");
  return resolved;
}
/** Verification outputs are separate from immutable historical measurements. */
export function evidencePath(reference) {
  const name = path.relative(foundation, fileURLToPath(reference));
  if (name.startsWith("..") || path.isAbsolute(name))
    throw new Error("Evidence must belong to this foundation package");
  output ??= canonicalDestination(process.env.BUBU_FOUNDATION_EVIDENCE_DIR
    ? path.resolve(process.env.BUBU_FOUNDATION_EVIDENCE_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), "bubu-foundation-")));
  const destination = canonicalDestination(path.join(output, name));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return destination;
}
