import fs from "node:fs";
import path from "node:path";
import * as T from "three";
import { FoundationPool } from "./foundation-host.mjs";
import { AUTHORED_CASES } from "../configuration/fixtures/authored.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import { source } from "./asset-fixtures.mjs";
const out = path.resolve(new URL("./evidence", import.meta.url).pathname);
fs.mkdirSync(out + "/geometry", { recursive: true });
function exportFrame(root, label, index, shared) {
  let ordinal = 0;
  const meshes = [],
    p = new T.Vector3(),
    matrix = new T.Matrix4();
  root.updateMatrixWorld(true);
  root.traverseVisible((m) => {
    if (!m.isMesh || m.name === "A_mochi_skin") return;
    const nodeId = ordinal++;
    const instances = m.isInstancedMesh ? m.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      if (m.isInstancedMesh) {
        m.getMatrixAt(instance, matrix);
        matrix.premultiply(m.matrixWorld);
      } else matrix.copy(m.matrixWorld);
      const name =
        (m.name || "effect-node-" + nodeId) +
        (m.isInstancedMesh ? "-particle-" + instance : "");
      const g = m.geometry,
        count = g.attributes.position.count;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        m.getVertexPosition(i, p).applyMatrix4(matrix);
        if (!p.toArray().every(Number.isFinite))
          throw Error("Nonfinite export");
        p.toArray(positions, i * 3);
      }
      const filename = `geometry/${label}-${index}-${name.replace(/[^\w-]/g, "_")}.bin`;
      fs.writeFileSync(out + "/" + filename, Buffer.from(positions.buffer));
      if (!shared[name]) {
        const c = g.attributes.color;
        shared[name] = {
          indices: Array.from(
            g.index?.array ?? Array.from({ length: count }, (_, i) => i),
          ),
          colors: c
            ? Array.from({ length: c.count }, (_, i) => [
                c.getX(i),
                c.getY(i),
                c.getZ(i),
                c.itemSize > 3 ? c.getW(i) : 1,
              ]).flat()
            : null,
          materialColor: m.material.color?.toArray(),
          opacity: m.material.opacity,
        };
      }
      meshes.push({ name, positionsFile: out + "/" + filename });
    }
  });
  return { label, index, time: index / 30, meshes };
}
const pool = new FoundationPool();
const longpressRun = process.argv.includes("--longpress");
const motionRun = process.argv.includes("--motion");
const authoredRun = process.argv.includes("--authored");
const cases = longpressRun
  ? [1, 2].map((i) => ({ configuration: FIXTURES[i] }))
  : authoredRun
    ? AUTHORED_CASES.filter((_, i) => i !== 3)
    : FIXTURES.map((configuration) => ({ configuration }));
for (const entry of cases) {
  const config = entry.configuration;
  const actor = await pool.create({ authoredFaces: entry.authoredFaces });
  await actor.equip(config, { clipLibrary: entry.clipLibrary });
  const shared = {},
    frames = [];
  const start = actor.f.point(-0.2, 1.4);
  let pointer = start;
  for (let i = 0; i <= (longpressRun ? 1890 : authoredRun ? 90 : 60); i++) {
    const t = i / 30;
    if (i === (longpressRun ? 6 : authoredRun ? 33 : 3))
      actor.f.emit("pointerdown", t, start);
    if (
      !longpressRun &&
      i >= (authoredRun ? 42 : 12) &&
      i <= (authoredRun ? 65 : 35)
    ) {
      pointer = {
        clientX:
          start.clientX +
          Math.sin(((i - (authoredRun ? 42 : 12)) / 23) * Math.PI) * 60,
        clientY: start.clientY - (70 * (i - (authoredRun ? 42 : 12))) / 23,
      };
      actor.f.emit("pointermove", t, pointer);
    }
    if (i === (longpressRun ? 1806 : authoredRun ? 66 : 36))
      actor.f.emit("pointerup", t, pointer);
    actor.step(t, { facts: authoredRun ? ["acknowledge"] : [] });
    if (
      longpressRun
        ? [0, 6, 18, 45, 60, 900, 1800, 1806, 1820, 1860, 1890].includes(i)
        : motionRun
          ? i % 3 === 0
          : [0, 15, 30, 45, 60, 75, 90].includes(i)
    )
      frames.push(
        exportFrame(
          actor.scene,
          config.id + (longpressRun ? "-longpress" : ""),
          i,
          shared,
        ),
      );
  }
  fs.writeFileSync(
    out + "/" + config.id + (longpressRun ? "-longpress" : "") + ".json",
    JSON.stringify({
      scope:
        "Actual CPU final scene geometry; Blender rendering only; no native/WebGL acceptance",
      secondaryDiagnostics: [...actor.mounts.values()]
        .filter((x) => x.secondary)
        .map((x) => ({ mountId: x.spec.id, ...x.secondary.diagnostics() })),
      sourceGLB: source,
      sharedMeshes: shared,
      frames,
    }),
  );
  actor.dispose();
  console.log("exported", config.id);
}
pool.dispose();
