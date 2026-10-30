"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// Research snapshots are separate packages with their own restored assets and
// validation entrypoints. Preserve all application/tool/review behavior suites.
const root = path.resolve(__dirname, "..");
function tests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git"].includes(entry.name)) return [];
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return tests(name);
    return entry.isFile() && /\.test\.(?:js|mjs|cjs)$/.test(entry.name) ? [name] : [];
  });
}
const files = ["test", "tools", "docs/reviews"]
  .flatMap((name) => tests(path.join(root, name))).sort();
const child = spawn(process.execPath,
  ["--test", "--test-concurrency=4", ...process.argv.slice(2), ...files],
  { cwd: root, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("close", (code) => { process.exitCode = code ?? 1; });
