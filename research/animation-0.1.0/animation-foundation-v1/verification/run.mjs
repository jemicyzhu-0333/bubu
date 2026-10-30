import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

const research = fileURLToPath(new URL("../../", import.meta.url));
const foundation = "animation-foundation-v1";
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (!["--output", "--browser", "--software", "--headed"].includes(name) || options.has(name))
    throw new Error(`Unknown or duplicate option: ${name}`);
  const value = ["--software", "--headed"].includes(name) ? true : args[++i];
  if (!value || (typeof value === "string" && value.startsWith("--")))
    throw new Error(`Missing value: ${name}`);
  options.set(name, value);
}
if (!options.has("--output") || ((options.has("--software") || options.has("--headed")) && !options.has("--browser")))
  throw new Error("Usage: --output NEW_DIRECTORY [--browser EXECUTABLE [--software] [--headed]]");
const requestedOutput = path.resolve(options.get("--output"));
const output = path.join(fs.realpathSync(path.dirname(requestedOutput)), path.basename(requestedOutput));
const realResearch = fs.realpathSync(research);
if (output === realResearch || output.startsWith(realResearch + path.sep))
  throw new Error("Evidence directory must be outside the research sources");
fs.mkdirSync(output, { recursive: false });

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git", "__pycache__"].includes(entry.name)) return [];
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(name) : entry.isFile() ? [name] : [];
  });
}
function sourceHashes() {
  const sourceFiles = walk(research).filter(name => /\.(?:mjs|cjs|js|py|json|html|css)$/.test(name));
  return Object.fromEntries(sourceFiles.sort().map(name => [
    path.relative(research, name),
    createHash("sha256").update(fs.readFileSync(name)).digest("hex"),
  ]));
}
const tests = (...directories) => directories.flatMap(directory =>
  walk(path.join(research, directory)).filter(name => name.endsWith(".test.mjs")));
const node = process.execPath;
const stages = [];
const add = (id, command, argv, timeoutMs = 300000) =>
  stages.push({ id, command, argv, timeoutMs });
const script = (id, name, argv = []) => add(id, node, [path.join(research, name), ...argv]);
const suite = (id, directories) => add(id, node, [
  "--test", "--test-isolation=none", "--test-reporter=tap", ...tests(...directories),
]);
add("prepare-d2", "python3", ["runtime-facepath05/tools/materialize-d2.py"]);
add("prepare-full18", "python3", ["runtime-facepath05/tools/materialize-full18.py"]);
script("preflight", `${foundation}/integration/verify-portability.mjs`);
suite("foundation", [
  `${foundation}/body-runtime`, `${foundation}/configuration/tests`,
  `${foundation}/integration`, `${foundation}/contact`,
]);
suite("expression-owner", ["runtime-facepath05/tests", "runtime-facepath05/test"]);
suite("expression-policy", ["expression-scheduler-p1/test"]);
script("input-source-identity", "shared-input-workbench-v2/tools/verify-dependencies.mjs");
suite("input", ["shared-input-workbench-v2/tests"]);
suite("original-parts-tea", ["original-parts-hybrid-v1/runtime/tests", "original-parts-hybrid-v1/tea/tests"]);
suite("theme-ledger", ["theme-state-ledger-v2/test"]);
suite("scene-coordinator", ["scene-coordinator-v1/test"]);
add("theme-adapter-restore", "python3", [
  "theme-commit-adapter/restore-harness.py", "--repo", path.resolve(research, "../.."),
  "--out", path.join(output, "theme-adapter"),
]);
add("theme-adapter-tests", node, []);
script("anchor-profile", `${foundation}/anchors/tests/profile-extension.mjs`);
script("anchor-actual-pose", `${foundation}/anchors/tests/actual-pose.mjs`);
script("floor", `${foundation}/body-runtime/verify-floor.mjs`);
script("secondary-motion", `${foundation}/secondary-motion/test.mjs`);
script("secondary-recovery", `${foundation}/secondary-motion/test-recovery.mjs`);
script("effects", `${foundation}/effects/test-effects.mjs`);
script("contract", `${foundation}/integration/verify-contract.mjs`);
script("authored-actions", `${foundation}/integration/verify-authored.mjs`);
script("prop-release", `${foundation}/integration/verify-release.mjs`);
add("integration", node, ["--expose-gc", `${foundation}/integration/verify.mjs`]);
const diag = `${foundation}/integration/diagnostics/contact-contract-20261019`;
add("contact-replay", "python3", [
  `${diag}/portable-smoke.py`, "--output", path.join(output, "contact-replay.json"),
], 180000);
script("contact-cape-source", `${diag}/export.mjs`, ["--output-dir", path.join(output, "contact-source")]);
script("contact-motion-source", `${diag}/export-motion.mjs`, ["--output-dir", path.join(output, "contact-source")]);
script("contact-source-equivalence", `${foundation}/verification/verify-contact-exports.mjs`,
  [path.join(output, "contact-source")]);
add("contact-endpoint-feasibility", "python3", [
  `${foundation}/contact/endpoint-feasibility.py`, "--output",
  path.join(output, "endpoint-exclusion.json"),
]);
script("frame-profile", `${foundation}/verification/frame-profile.mjs`,
  ["--output", path.join(output, "frame-profile.json")]);
script("outfit-surface-sweep", `${foundation}/contact/outfit-sweep.mjs`,
  [path.join(output, "outfit-contact")]);
script("outfit-reference-sweep", `${foundation}/contact/outfit-sweep.mjs`,
  [path.join(output, "outfit-reference"), "--reference"]);
script("tea-cup-clearance", `${foundation}/contact/tea-clearance-sweep.mjs`,
  [path.join(output, "tea-cup-clearance")]);
script("cape-fixed-support-continuity", `${foundation}/contact/cape-pin-sweep.mjs`,
  [path.join(output, "cape-fixed-supports")]);
script("bounded-fit-obstruction", `${foundation}/contact/fit-obstruction.mjs`,
  [path.join(output, "fit-obstruction")]);
suite("cloth-probe-contracts", [`${foundation}/secondary-motion/cloth-probe`]);
if (options.has("--browser")) add("browser-evidence-format", "python3", [
  `${foundation}/verification/test_json_evidence.py`,
]);
if (options.has("--browser")) add("browser-webgl", "python3", [
  `${foundation}/verification/browser-verify.py`, "--output", path.join(output, "browser"),
  "--browser", options.get("--browser"),
  ...(options.has("--software") ? ["--software"] : []),
  ...(options.has("--headed") ? ["--headed"] : []),
]);

const before = sourceHashes();
const report = {
  format: "bubu-foundation-validation-v1",
  status: "running",
  startedAt: new Date().toISOString(),
  scope: "Research CPU contracts, numeric contact evidence, and optional real Chromium D2 body-path verification",
  productionAccepted: false,
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: research, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
  workingTree: execFileSync("git", ["status", "--porcelain"], { cwd: research, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  stages: [],
  gates: {
    capeTea: { status: "blocked", reason: "endpoint-attachment-conflict" },
    dynamicCloth: { status: "blocked", reason: "real-time-budget-not-met" },
    nativeInput: { status: "not-run" },
    webglAndGPURecovery: { status: "not-run" },
    stableFrameTime: { status: "not-run" },
    fullWardrobeContact: { status: "not-run" },
  },
};
const writeReport = () => fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(output, "source-hashes.json"), JSON.stringify(before, null, 2) + "\n");
writeReport();

async function run(stage) {
  const log = path.join(output, stage.id + ".log");
  const fd = fs.openSync(log, "wx");
  const begin = performance.now();
  let timedOut = false;
  try {
    const result = await new Promise(resolve => {
      const child = spawn(stage.command, stage.argv, {
        cwd: research, stdio: ["ignore", fd, fd],
        env: { ...process.env, BUBU_FOUNDATION_EVIDENCE_DIR: output, PYTHONDONTWRITEBYTECODE: "1" },
      });
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, stage.timeoutMs);
      child.once("error", error => { clearTimeout(timer); resolve({ error: error.message }); });
      child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    const text = fs.readFileSync(log, "utf8");
    const counts = Object.fromEntries(["tests", "pass", "fail", "skipped"].flatMap(key => {
      const match = text.match(new RegExp(`^# ${key} (\\d+)$`, "m"));
      return match ? [[key, Number(match[1])]] : [];
    }));
    return {
      id: stage.id, status: result.code === 0 && !timedOut ? "passed" : "failed",
      command: [stage.command, ...stage.argv],
      ...result, timedOut, durationMs: performance.now() - begin, counts, log: path.basename(log),
    };
  } finally { fs.closeSync(fd); }
}

try {
  for (const stage of stages) {
    if (stage.id === "theme-adapter-tests") stage.argv = [
      "--test", "--test-isolation=none", "--test-reporter=tap",
      ...walk(path.join(output, "theme-adapter/tests")).filter(name => name.endsWith(".test.cjs")),
    ];
    console.log(`Running ${stage.id}`);
    const result = await run(stage);
    report.stages.push(result);
    writeReport();
    console.log(`${result.status}: ${stage.id}`);
    if (result.status !== "passed") throw new Error(`${stage.id} failed; inspect ${result.log}`);
  }
  const after = sourceHashes();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(name => before[name] !== after[name]);
  if (changed.length) throw new Error(`Verification changed research sources: ${changed.join(", ")}`);
  report.sourcesUnchanged = true;
  const outfit = JSON.parse(fs.readFileSync(path.join(output, "outfit-contact/report.json")));
  report.gates.fullWardrobeContact = {
    status: outfit.surfaceCrossingsObserved ? "failed" : "not-established",
    samples: outfit.samples, framesWithContacts: outfit.framesWithContacts,
    observedPairs: Object.keys(outfit.pairs), haloContactPairs: outfit.haloContactPairs,
    floraContactPairs: outfit.floraContactPairs, floraMinimumSurfaceGap: outfit.floraMinimumSurfaceGap,
    continuousContact: outfit.rigidMountContinuousDomain ? "partial-rigid-domain-only" : "not-run", containment: "not-run",
    rigidMountContinuousDomain: outfit.rigidMountContinuousDomain ?? null,
    reason: "Sampled full-outfit surfaces still require intentional-contact classification and continuous/containment verification",
  };
  const cup = JSON.parse(fs.readFileSync(path.join(output, "tea-cup-clearance/report.json")));
  report.gates.cupClaspCandidate = {
    status: cup.sampledCupClaspClear && cup.continuousCupClasp.status === "certified" ? "partial" : "failed",
    sampledCupCapeClear: cup.variants.candidate.framesWithContacts === 0,
    samples: cup.variants.candidate.samples,
    continuousFixedClasp: cup.continuousCupClasp.status,
    certifiedIntervals: cup.continuousCupClasp.intervals.length,
    scope: "Derived bounded motion candidate; hands/cloth/body and runtime admission remain unaccepted",
  };
  const supports=JSON.parse(fs.readFileSync(path.join(output,"cape-fixed-supports/report.json")));
  report.gates.capeFixedSupportCandidate={
    status:Object.values(supports.variants).every(v=>v.continuous.status==="certified")?"partial":"failed",
    profile:"tea-swept-51-v1",retained:51,released:14,
    variants:Object.fromEntries(Object.entries(supports.variants).map(([name,v])=>[name,{
      continuous:v.continuous.status,certifiedIntervals:v.continuous.intervals.length,
      originalInsideSupports:v.profileConflicts["original-65-v1"].length,
      legacyInsideSupports:v.profileConflicts["legacy-local-55-v1"].length,
    }])),
    scope:"Fixed points with original 0.003 radius only; free cloth, finite attachment patches, render contact and production admission remain unaccepted",
  };
  report.gates.capeTea.reason="original-65-pin-conflict; repaired-private-51-pin-profile-still-needs-free-cloth-and-render-contact";
  const cpu = JSON.parse(fs.readFileSync(path.join(output, "integration/evidence/integration-report.json"))).cpuFrameMs;
  const profile = JSON.parse(fs.readFileSync(path.join(output, "frame-profile.json")));
  const overBudgetFrames = profile.rows.filter(row => row.duration > 16.667).length;
  report.gates.stableFrameTime = {
    status: cpu.max > 16.667 || overBudgetFrames ? "failed" : "not-established",
    evidence: cpu, profilePasses: profile.summary, profileOverBudgetFrames: overBudgetFrames,
    reason: "All measured CPU passes contribute to this gate; passing samples cannot establish native frame stability",
  };
  if (options.has("--browser")) {
    const browser = JSON.parse(fs.readFileSync(path.join(output, "browser/browser-report.json")));
    report.gates.webglAndGPURecovery = {
      status: "partial", browserWebGL: browser.status,
      renderer: browser.runs[0]?.cold.renderer,
      hardwareGPURecovery: "not-run", nativeDesktop: "not-run",
      reason: "Browser object lifecycle counts do not establish physical GPU memory or desktop-window acceptance",
    };
    report.gates.stableFrameTime.browserFrameIntervals =
      browser.runs.find(r => r.timing)?.timing.intervalSummaryMs;
    if (report.gates.stableFrameTime.browserFrameIntervals?.p95 > 16.667) {
      report.gates.stableFrameTime.status = "failed";
      report.gates.stableFrameTime.reason =
        "Observed browser frame intervals exceed the 60 Hz budget; renderer identity remains explicit";
    }
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.log(`Summary: ${path.join(output, "summary.json")}`);
}
