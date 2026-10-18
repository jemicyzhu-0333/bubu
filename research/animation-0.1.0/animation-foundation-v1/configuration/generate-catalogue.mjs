import fs from "node:fs";
const source = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../bubu-asset-physics-revision-20261018/catalog.json",
      import.meta.url,
    ),
  ),
);
const fixtureIds = new Set([
  "skin.forest-leaf",
  "skin.sakura-flower",
  "milestone.satchel",
  "milestone.cape",
  "milestone.halo",
  "open-book",
]);
const wearableAnchor = {
  "milestone.sprout": "crown",
  "milestone.sunhat": "crown",
  "milestone.satchel": "hip.sideR",
  "milestone.scarf": "neck.front",
  "milestone.halo": "crown",
  "milestone.boots": "footR.top",
  "milestone.cape": "back.upper",
  "skin.forest-leaf": "earR.rear",
  "skin.sakura-flower": "earR.front",
  "skin.moon-crescent": "crown",
  "skin.flame-tip": "crown",
  "skin.crown": "crown",
  "skin.robot-antenna": "crown",
  "seasonal.pumpkin-beret": "crown",
  "skin.woodsman-cap": "crown",
  "skin.ocean-fin": "back.lower",
  "skin.bat-wings": "back.upper",
  "seasonal.plum-cape": "back.upper",
};
const ground = new Set([
  "ground-hole",
  "treasure-chest",
  "dirt-mound",
  "cushion",
  "keyboard",
  "telescope",
  "plant-pot",
  "drum",
  "cardboard-box",
  "building-block",
  "picnic-mat",
  "laptop",
  "pillow",
]);
const airborne = new Set([
  "butterfly",
  "energy-token",
  "paper-plane",
  "star",
  "ghost",
]);
const rows = [];
for (const [kind, items] of [
  ["wearable", source.wearables],
  ["prop", source.props],
])
  for (const item of items) {
    const anchor =
      kind === "wearable"
        ? wearableAnchor[item.id]
        : ground.has(item.id)
          ? null
          : airborne.has(item.id)
            ? null
            : "palm.gripR";
    rows.push({
      id: item.id,
      kind,
      model: item.model,
      sha256: item.sha256,
      semanticUsages: item.semanticUsages ?? [],
      anchor,
      mountStatus: anchor ? "supported" : "research-blocked",
      mountScope: anchor
        ? "semantic mapping; live contact requires fixture validation"
        : ground.has(item.id)
          ? "world ground placement requires stage contract"
          : "independent world trajectory requires authored choreography",
      fixtureStatus: fixtureIds.has(item.id) ? "supported" : "research-blocked",
      actionStatus: "research-blocked",
      secondaryMotion: "research-blocked",
      native: "research-blocked",
      wardrobe: "canonical-owner-only",
    });
    for (const v of item.variants ?? [])
      rows.push({
        id: v.id,
        kind: "variant",
        parent: item.id,
        model: v.model,
        sha256: v.sha256,
        semanticUsages: item.semanticUsages ?? [],
        anchor: "palm.gripR",
        mountStatus: "supported",
        mountScope: "semantic mapping only; static source evidence",
        fixtureStatus: "research-blocked",
        actionStatus: "research-blocked",
        secondaryMotion: "research-blocked",
        native: "research-blocked",
        wardrobe: "canonical-owner-only",
      });
  }
fs.writeFileSync(
  new URL("./catalogue.json", import.meta.url),
  JSON.stringify(rows, null, 2) + "\n",
);
fs.writeFileSync(
  new URL("./catalogue.mjs", import.meta.url),
  "// Generated from the existing candidate catalogue; statuses are scope-specific.\nexport const CATALOGUE = " +
    JSON.stringify(rows, null, 2) +
    ";\n",
);
