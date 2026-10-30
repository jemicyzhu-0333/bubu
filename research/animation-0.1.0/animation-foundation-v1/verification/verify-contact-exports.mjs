import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const output = process.argv[2];
if (!output) throw new Error("Export directory required");
for (const name of ["frozen-cape.json", "motion.json"]) {
  const actual = JSON.parse(fs.readFileSync(path.join(output, name)));
  const expected = JSON.parse(fs.readFileSync(
    new URL(`../integration/diagnostics/contact-contract-20261019/${name}`, import.meta.url)));
  assert.deepEqual(actual, expected, `Source export changed: ${name}`);
}
console.log("Frozen cape and tea trajectory match current source exports exactly");
