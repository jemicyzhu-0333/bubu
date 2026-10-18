import { fixture } from "./fixture.mjs";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const samples = Number(process.argv[2] ?? 180);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10000)
  throw Error("Sample count must be 1..10000");
const f = await fixture(),
  times = [],
  slow = [];
try {
  const point = f.point();
  f.emit("pointerdown", 0.01, point);
  f.tick(0.01);
  f.tick(0.7);
  assert.equal(f.h.state.mode, "petting");
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 1; i <= samples; i++) {
    const t = 0.7 + i / 60,
      p = {
        ...point,
        clientX: point.clientX + Math.sin(i * 0.2),
        clientY: point.clientY + Math.cos(i * 0.2),
      };
    f.emit("pointermove", t, p);
    const start = performance.now();
    f.tick(t);
    const ms = performance.now() - start;
    times.push(ms);
    if (ms > 16.667) slow.push({ frame: i, ms });
    assert.equal(f.h.state.mode, "petting");
  }
  times.sort((a, b) => a - b);
  global.gc?.();
  const report = {
    scope:
      "CPU-only actual longpress with continuous sub-drag-threshold pointer movement; not GPU",
    samples: times.length,
    p50: times[Math.floor(samples * 0.5)],
    p95: times[Math.floor(samples * 0.95)],
    max: times.at(-1),
    over16ms: slow.length,
    surface: { ...f.h.diagnostics.surface },
    heapBefore,
    heapAfter: process.memoryUsage().heapUsed,
    gcAvailable: typeof global.gc === "function",
    moduleHashes: Object.fromEntries(
      [
        "surface-query.mjs",
        "rigid-surface-partition.mjs",
        "pointer-host.mjs",
      ].map((name) => [
        name,
        createHash("sha256")
          .update(fs.readFileSync(new URL(name, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  };
  fs.writeFileSync(
    new URL(
      samples === 180
        ? "./surface-interaction-evidence.json"
        : `./surface-interaction-${samples}-evidence.json`,
      import.meta.url,
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  f.h.dispose();
}
