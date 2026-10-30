import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("evidence output refuses research destinations including symlinked parents and nested directories", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bubu-output-guard-"));
  const before = process.env.BUBU_FOUNDATION_EVIDENCE_DIR;
  const research = fileURLToPath(new URL("../../", import.meta.url));
  const reference = new URL("./evidence/report.json", import.meta.url);
  let version = 0;
  async function outputAt(directory) {
    process.env.BUBU_FOUNDATION_EVIDENCE_DIR = directory;
    return (await import(`../verification/evidence-output.mjs?guard=${++version}`)).evidencePath;
  }
  try {
    const direct = await outputAt(research);
    assert.throws(() => direct(reference), /outside the research/);
    const dotName = await outputAt(path.join(research, "..evidence"));
    assert.throws(() => dotName(reference), /outside the research/);
    fs.symlinkSync(research, path.join(tmp, "link"), "dir");
    const linked = await outputAt(path.join(tmp, "link", "new-report"));
    assert.throws(() => linked(reference), /outside the research/);
    const nested = path.join(tmp, "external");
    fs.mkdirSync(nested);
    fs.symlinkSync(research, path.join(nested, "integration"), "dir");
    const inner = await outputAt(nested);
    assert.throws(() => inner(reference), /outside the research/);
    const safe = await outputAt(path.join(tmp, "safe"));
    assert.equal(safe(reference), path.join(tmp, "safe", "integration", "evidence", "report.json"));
  } finally {
    if (before === undefined) delete process.env.BUBU_FOUNDATION_EVIDENCE_DIR;
    else process.env.BUBU_FOUNDATION_EVIDENCE_DIR = before;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
