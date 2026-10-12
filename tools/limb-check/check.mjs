// npm run limbs:check — limb detectors for CI.
//  1. geometry trace over every action + session in every rig view (always);
//  2. pixel outline-gap scan with a real Canvas (USAGI_CANVAS_PACKAGE), on the
//     historical worst offenders by default, or every action with --all.
import { traceLimbs } from './trace.mjs';
import { scanLimbPixels } from './pixels.mjs';
const all = process.argv.includes('--all');
const geo = await traceLimbs();
console.log(`limb trace: ${Object.keys(geo.targets).length} target-views, ${geo.failures.length} failures`);
for (const f of geo.failures.slice(0, 30)) console.log('  ' + f);
let failures = geo.failures.length;
if (process.env.USAGI_CANVAS_PACKAGE) {
  const ids = all ? null : ['workout', 'catch-star', 'paper-plane', 'wave', 'sip-tea', 'high-five', 'yawn', 'take-note', 'umbrella-dance', 'build-blocks'];
  const px = await scanLimbPixels(undefined, { ids });
  console.log(`limb pixels: ${Object.keys(px.actions).length} actions, ${px.failures.length} outline-gap failures`);
  for (const f of px.failures) console.log('  ' + f);
  failures += px.failures.length;
} else console.log('limb pixels: skipped (set USAGI_CANVAS_PACKAGE for the outline-gap scan)');
process.exitCode = failures ? 1 : 0;
