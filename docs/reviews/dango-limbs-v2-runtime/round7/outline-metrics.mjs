// node outline-metrics.mjs <root> <reach.json> <out.json>
// Per unique within-tolerance plan: arm overhang outside canonical body, and
// composed-limb boundary pixels lacking ink (#1a1b26) against background/body.
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [,, root, reachPath, outPath] = process.argv; const imp = p => import(pathToFileURL(path.join(root, p)).href);
const { loadLimbSource } = await imp('tools/dango-limbs-qa.mjs');
const { solveLimb, composeLimb, contactContract, pawLayer, DANGO_LIMB_BOX: BOX } = await imp('src/capabilities/companion/presentation/dango-limb-compose.mjs');
const { DANGO_LIMB_RIG } = await imp('src/content/companion/dango-limbs.mjs');
const src = await loadLimbSource();
const rows = JSON.parse(fs.readFileSync(reachPath)).filter(r => r.err != null && r.err <= DANGO_LIMB_RIG.maxContactError);
const seen = new Map();
for (const r of rows) {
  const plan = solveLimb(src, { view: r.view, side: r.side, target: r.target, pose: r.pose, contract: r.normal ? { normal: r.normal, normalTolerance: 22.5 } : null });
  if (!plan) continue;
  const key = `${plan.view}|${plan.side}|${plan.joint.key}|${plan.paw.src}|${plan.pawMirror}`;
  if (seen.has(key)) { seen.get(key).uses.add(r.id); continue; }
  const { arm, paw } = composeLimb(src, plan), W = BOX.w, H = BOX.h;
  const A = (b, x, y) => x >= 0 && y >= 0 && x < W && y < H && b.data[(y * W + x) * 4 + 3] > 0;
  const ink = (b, x, y) => { const i = (y * W + x) * 4; return b.data[i] === 0x1a && b.data[i + 1] === 0x1b && b.data[i + 2] === 0x26; };
  const body = (x, y) => src.bodyAlpha(plan.view, x + BOX.x + .5, y + BOX.y + .5) === true;
  let overhang = 0, maxOut = 0, armGap = 0, pawGap = 0, pawEdge = 0;
  const front = pawLayer(plan) === 'front';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (A(arm, x, y) && !body(x, y) && !(front && A(paw, x, y))) {
      overhang++;
      // distance to nearest body pixel on this row
      let d = 99; for (let k = 1; k < 40; k++) if (body(x - k, y) || body(x + k, y)) { d = k; break; } maxOut = Math.max(maxOut, d);
      if (!ink(arm, x, y) && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !A(arm, x+dx, y+dy) && !A(paw, x+dx, y+dy) && !body(x+dx, y+dy))) armGap++;
    }
    if (front && A(paw, x, y) && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !A(paw, x+dx, y+dy) && !A(arm, x+dx, y+dy))) {
      pawEdge++; if (!ink(paw, x, y)) pawGap++;
    }
  }
  seen.set(key, { key, view: plan.view, side: plan.side, joint: plan.joint.key, paw: plan.paw.src, uses: new Set([r.id]), overhangPx: overhang, maxOutPx: maxOut, armEdgeNoInkPx: armGap, pawEdgePx: pawEdge, pawEdgeNoInkPx: pawGap });
}
const list = [...seen.values()].map(v => ({ ...v, uses: [...v.uses] }));
const agg = {};
for (const v of list) { const k = `${v.view}|${v.side}`; const a = agg[k] ||= { plans: 0, overhangPlans: 0, maxOutPx: 0, armEdgeNoInk: 0, pawEdgeNoInkRatioMax: 0 }; a.plans++; a.overhangPxTotal=(a.overhangPxTotal||0)+v.overhangPx; if (v.overhangPx) a.overhangPlans++; a.maxOutPx = Math.max(a.maxOutPx, v.maxOutPx); a.armEdgeNoInk += v.armEdgeNoInkPx; a.pawEdgeNoInkRatioMax = Math.max(a.pawEdgeNoInkRatioMax, +(v.pawEdgeNoInkPx / Math.max(1, v.pawEdgePx)).toFixed(3)); }
fs.writeFileSync(outPath, JSON.stringify({ aggregate: agg, plans: list }, null, 1));
console.log(JSON.stringify(agg, null, 1));
