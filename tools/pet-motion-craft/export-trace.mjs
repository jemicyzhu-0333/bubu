// Read-only host adapter. Produces points from production artwork and painter
// transforms; it neither copies art nor edits a runtime/manifest/profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const root = path.resolve(arg('app-root', path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')));
const out = path.resolve(arg('out', path.join(root, 'dist/motion-trace')));
const character = arg('character', 'usagi'), id = arg('action', 'paper-return'), view = arg('view', 'three-quarter');
const load = name => import(pathToFileURL(path.join(root, name)).href);
const backend = createRequire(import.meta.url)(arg('canvas-package', path.join(root, 'node_modules/@napi-rs/canvas')));
const { installOffscreenImages } = await load('tools/usagi-gallery/offscreen-images.mjs');
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const [art, { PET_FORMS }, { PET_ACTIONS }, { applyPoint, multiply, localMatrix }, { usagiPropMatrix }, { toolMatrix },
  { DANGO_RASTER }] = await Promise.all([
  load('src/capabilities/companion/presentation/form-art.mjs'), load('src/capabilities/companion/form-registry.mjs'),
  load('src/content/behaviors.mjs'), load('src/capabilities/companion/presentation/rig/pose.mjs'),
  load('src/capabilities/companion/presentation/usagi-contact.mjs'), load('src/capabilities/companion/presentation/dango-raster-actions.mjs'),
  load('assets/companion/dango/raster/dango.raster.mjs')]);
const action = PET_ACTIONS[id], form = PET_FORMS[character];
if (!action || !form) throw Error('Unknown production character/action');
await art.prepareArtwork(form, { all: true });
const translate = (x, y) => [1, 0, 0, 1, x, y];
const frames = [], durationMs = action.duration;
const cuts = id === 'paper-return' ? [0,.08,.14,.34,.7,.76,.84,.96,1] : [0,.12,...Array.from({length:8},(_,i)=>.12+(i+1)*.095),1];
const times = [...new Set([...Array.from({length:631},(_,i)=>i/630*durationMs), ...cuts.map(p=>p*durationMs)])].sort((a,b)=>a-b);
const dataHashes = new Map();
for (const timeMs of times) {
  const progress = timeMs / durationMs;
  const artwork = art.resolveArtwork(form, { action, motion: action.motion, view, progress, elapsedMs: timeMs,
    channel: `trace:${id}:${character}`, face: { eyes: 'neutral', mouth: 'neutral' }, expressionId: action.expression });
  const offset = art.motionOffset(form, action, action.motion, progress, { bodySize: 66, calmVisual: false });
  let body = translate(offset.x, offset.y);
  const transform = m => { body = multiply(body, m); };
  const context = { translate: (x,y)=>transform(translate(x,y)), rotate: r=>transform([Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0]),
    scale: (x,y)=>transform([x,0,0,y,0,0]) };
  art.applyMotionTransform(context, form, action, action.motion, progress,
    { bodySize: 66, size: 66, calmVisual: false, artwork, translate: context.translate });
  const world = xy => applyPoint(body, ...xy), points = {}, visibleProps = [], support = [];
  if (character === 'usagi') {
    const data = artwork.rig.views[artwork.drawnView], pose = artwork.pose;
    for (const [i,side] of ['l','r'].entries()) {
      const foot = data.anchors[i ? 'usagi.footwear-r' : 'usagi.footwear'];
      points[`foot-${side}`] = world(applyPoint(pose.world[`leg_${side}`], foot.x, foot.y));
      points[`floor-${side}`] = [points[`foot-${side}`][0], foot.y];
      if (Math.abs(points[`foot-${side}`][1] - foot.y) < 1e-6) support.push(`foot-${side}`);
    }
    const wrist = data.bones.hand_r.pivot;
    points.hand = world(applyPoint(pose.world.hand_r, ...wrist));
    if (id === 'paper-return') {
      const prop = data.props.plane, pp = pose.sample.propPoses.plane || {};
      const raw = multiply(pose.world[prop.bone], localMatrix(wrist, pp));
      const matrix = usagiPropMatrix(raw, {id:'plane',artwork,data});
      points.grip = world(applyPoint(matrix, ...wrist));
      if ((pp.opacity ?? 1) > .001) visibleProps.push('plane');
    }
  } else {
    for (const [i,side] of ['l','r'].entries()) {
      const key = i ? 'foot-right' : 'foot-left', foot = artwork.anchors[key];
      points[`foot-${side}`] = world(applyPoint(artwork.matrices[key], foot.x, foot.y));
      points[`floor-${side}`] = [points[`foot-${side}`][0], foot.y];
      if (Math.abs(points[`foot-${side}`][1] - foot.y) < 1e-6) support.push(`foot-${side}`);
    }
    const hand = artwork.contact?.hands.find(h=>h.side==='right');
    const fin = DANGO_RASTER.tools['small-fin'];
    points.hand = world(hand?.pawMatrix ? applyPoint(hand.pawMatrix, ...fin.anchors.grip) : hand?.points.at(-1) || [59,49]);
    if (id === 'paper-return') {
      const item = artwork.contact.tools.find(t=>t.key==='paper-plane'), sprite = DANGO_RASTER.tools['paper-plane'];
      points.grip = world(applyPoint(toolMatrix(item,sprite), ...sprite.anchors.right));
      if (artwork.actionReady && (item.opacity ?? 1) > .001) visibleProps.push('plane');
    }
  }
  frames.push({timeMs,points,visibleProps,support});
}
const storyId = `${character}-${id}-${view}`;
const trace = {schema:'pet-trace/v1',storyId,sourceRevision:arg('revision','working-tree'),surface:'pure-pose',
  toolSha256:crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),units:'art-px',frames,
  limitations:['Production resolveArtwork, body transforms and propMatrix/toolMatrix; no synthetic contact solver.',
    'Floor points project onto the independently authored neutral attachment height; horizontal planted-foot drift needs a separate stationary-floor assertion.',
    'Visible props are ready production draw commands with opacity > .001, not a pixel occlusion classifier.',
    'No native desktop/GPU or memory evidence. Render costs and cache bytes intentionally omitted.']};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,`${storyId}.trace.json`),JSON.stringify(trace,null,2));
console.log(`${storyId}: ${frames.length} production samples -> ${out}`);
