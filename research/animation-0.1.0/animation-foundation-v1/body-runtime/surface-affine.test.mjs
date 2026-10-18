import test from "node:test";
import * as T from "three";
import { MeshBVH } from "three-mesh-bvh";
import { createSurfaceQuery } from "./surface-query.mjs";
test("independent seeded affine ray matrix matches native co-nearest surfaces", () => {
  let seed = 555,
    checks = 0;
  const rnd = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const mode of ["partition", "rigid", "blended", "morph", "grouped"]) {
    const g = new T.BoxGeometry(1, 1, 1, 2, 2, 2),
      n = g.attributes.position.count;
    if (mode !== "grouped") g.clearGroups();
    const si = new Uint16Array(n * 4),
      sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = 0;
      si[i * 4 + 1] = 1;
      if (mode === "partition") {
        sw[i * 4] = g.attributes.position.getX(i) > 0 ? 1 : 0;
        sw[i * 4 + 1] = 1 - sw[i * 4];
      } else if (mode === "rigid") sw[i * 4] = 1;
      else {
        sw[i * 4] = 0.4;
        sw[i * 4 + 1] = 0.6;
      }
    }
    g.setAttribute("skinIndex", new T.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new T.Float32BufferAttribute(sw, 4));
    if (mode === "morph") {
      g.morphTargetsRelative = true;
      g.morphAttributes.position = [
        new T.Float32BufferAttribute(
          Float32Array.from({ length: n * 3 }, (_, i) =>
            i % 3 === 0 ? 0.15 : 0,
          ),
          3,
        ),
      ];
    }
    const mats = Array.from({ length: 6 }, () => new T.MeshBasicMaterial());
    const s = new T.SkinnedMesh(g, mode === "grouped" ? mats : mats[0]);
    const b = new T.Bone(),
      c = new T.Bone();
    b.add(c);
    s.add(b);
    s.bind(new T.Skeleton([b, c]));
    s.updateMatrixWorld(true);
    const q = createSurfaceQuery({
      THREE: T,
      MeshBVH,
      skin: s,
      assertCurrent() {},
    });
    for (let k = 0; k < 20; k++) {
      s.scale.set(k % 2 ? -1.1 : 1.2, 0.8, 1.4);
      s.rotation.set(rnd(), rnd(), rnd());
      c.scale.set(k % 3 ? -1 : 1, 0.7, 1.3);
      c.rotation.set(rnd(), rnd(), rnd());
      c.position.set(rnd() * 0.2, rnd() * 0.2, 0);
      for (const m of mats) m.side = k % 3;
      if (s.morphTargetInfluences) s.morphTargetInfluences[0] = rnd();
      s.updateMatrixWorld(true);
      s.computeBoundingSphere();
      for (let j = 0; j < 30; j++) {
        const origin = new T.Vector3((rnd() - 0.5) * 4, (rnd() - 0.5) * 4, 3),
          dir = new T.Vector3(
            (rnd() - 0.5) * 0.3,
            (rnd() - 0.5) * 0.3,
            -1,
          ).normalize();
        const ray = new T.Raycaster(origin, dir, 0, 10);
        const hs = ray.intersectObject(s, false),
          hit = q.firstHit(ray);
        checks++;
        if (
          !!hs.length !== !!hit ||
          (hit &&
            (Math.abs(hs[0].distance - hit.distance) > 1e-7 ||
              !hs.some(
                (h) =>
                  h.faceIndex === hit.faceIndex &&
                  Math.abs(h.distance - hit.distance) < 1e-7,
              )))
        ) {
          console.log(
            JSON.stringify({
              FAILED: true,
              mode,
              k,
              j,
              native: hs[0]?.distance,
              actual: hit?.distance,
            }),
          );
          process.exit(1);
        }
      }
    }
    q.dispose();
    g.dispose();
    mats.forEach((m) => m.dispose());
    s.skeleton.dispose();
  }
  console.log(
    JSON.stringify({
      checks,
      passed: true,
      scope:
        "Nearest hit and native co-nearest face across synthetic partition/all-rigid/blended/morph/grouped reflected affine poses",
    }),
  );
});
