import fs from "node:fs";
import * as T from "three";
import { MeshBVH } from "three-mesh-bvh";
import {
  loadGLB,
  disposeAsset,
  hybrid,
} from "../../integration/asset-fixtures.mjs";
const raw = await loadGLB(hybrid),
  skin = raw.getObjectByName("Bubu_body");
const data = JSON.parse(
  fs.readFileSync(new URL("./cape-coarse.json", import.meta.url)),
);
const coarse = new T.BufferGeometry()
  .setAttribute("position", new T.Float32BufferAttribute(data.positions, 3))
  .setIndex(data.indices);
const body = skin.geometry.clone(),
  tree = new MeshBVH(body, { indirect: true });
let render;
try {
  const coarseIntersects = tree.intersectsGeometry(coarse, new T.Matrix4());
  render = await loadGLB(
    new URL(
      "../../../wearable-approved-round5/accessory-expansion/models/07-cape.glb",
      import.meta.url,
    ),
  );
  const renderIntersections = {};
  render.updateMatrixWorld(true);
  render.traverse((m) => {
    if (m.isMesh) {
      const other = new MeshBVH(m.geometry, { indirect: true });
      renderIntersections[m.name] = tree.bvhcast(other, m.matrixWorld, {
        intersectsTriangles: (a, b) => a.intersectsTriangle(b),
      });
    }
  });

  const point = new T.Vector3(),
    hit = {};
  let minVertexGap = Infinity;
  for (let i = 0; i < coarse.attributes.position.count; i++) {
    point.fromBufferAttribute(coarse.attributes.position, i);
    tree.closestPointToPoint(point, hit);
    minVertexGap = Math.min(minVertexGap, hit.distance);
  }
  const report = {
    scope:
      "Rest geometry triangle intersection and unsigned vertex clearance against approved body accessor geometry; not continuous or containment proof",
    particles: coarse.attributes.position.count,
    triangles: coarse.index.count / 3,
    coarseIntersectsBody: coarseIntersects,
    approvedRenderPartIntersections: renderIntersections,
    minimumVertexGap: minVertexGap,
  };
  fs.writeFileSync(
    new URL("./rest-clearance.json", import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  if (render) disposeAsset(render);
  coarse.dispose();
  body.dispose();
  disposeAsset(raw);
}
