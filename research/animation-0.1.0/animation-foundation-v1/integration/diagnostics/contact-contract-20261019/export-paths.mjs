import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Explicit paths only. Historical provenance paths are never dependency fallbacks. */
export function exportPaths(argv = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i], value = argv[i + 1];
    if (!["--research-root", "--output-dir"].includes(name) ||
        typeof value !== "string" || value.startsWith("--") || options.has(name))
      throw new TypeError("Use --research-root PATH and --output-dir PATH once each");
    options.set(name, path.resolve(value));
  }
  const research = options.get("--research-root") ??
    fileURLToPath(new URL("../../../../", import.meta.url));
  const out = options.get("--output-dir");
  if (!out) throw new TypeError("--output-dir is required; frozen evidence is read-only");
  for (const name of ["package.json", "original-parts-hybrid-v1/tea/src/rigid-tea.mjs",
    "wearable-approved-round5/accessory-expansion/models/07-cape.glb"]) {
    if (!fs.statSync(path.join(research, name)).isFile())
      throw new Error(`Incomplete research root: ${name}`);
  }
  const frozen = fs.realpathSync(fileURLToPath(new URL("./", import.meta.url)));
  fs.mkdirSync(out, { recursive: true });
  if (fs.realpathSync(out) === frozen)
    throw new Error("Cannot overwrite frozen contact exports");
  return { research, out };
}
