import { RIG_VIEWS, resolveRigView } from '../../src/capabilities/companion/presentation/rig/schema.mjs';
import { EYE_FALLBACKS, MOUTH_FALLBACKS, resolveRigFace } from '../../src/capabilities/companion/presentation/rig/face.mjs';
import { MOTIONS, PROP_NAMES, sampleMotion } from '../../src/capabilities/companion/presentation/rig/motions.mjs';

// 会被某个动作驱动的骨骼。躯干（body）只做呼吸缩放，画在静态层不算断层，所以不算进来。
const MOVING_BONES = new Set(Object.values(MOTIONS).flatMap(motion => [
  ...Object.keys(motion.bones), ...Object.values(motion.views || {}).flatMap(Object.keys)
]).filter(bone => bone !== 'body' && bone !== 'root'));

// Human-readable coverage of a validated rig against a form descriptor: what
// the author drew, and what each missing piece falls back to at runtime.
function coverageReport(rig, form, { bounds = null } = {}) {
  const lines = [];
  const gaps = [];
  const say = line => lines.push(line);
  say(`rig ${rig.id}@${rig.version} for form ${rig.form}${form ? '' : ' (form not found)'}`);

  say('\nviews');
  for (const view of RIG_VIEWS) {
    const resolved = resolveRigView(rig, view);
    if (resolved.exact) say(`  ok  ${view}`);
    else { say(`  ->  ${view} uses ${resolved.view}`); gaps.push(`view ${view}`); }
  }

  for (const view of Object.keys(rig.views)) {
    const data = rig.views[view];
    say(`\n[${view}] bones: ${Object.keys(data.bones).join(', ')}`);
    const layers = { back: 0, body: 0, front: 0 };
    for (const part of data.parts) layers[part.layer] += part.shapes.length;
    say(`  shapes: back ${layers.back} · body ${layers.body} · front ${layers.front}`);
    if (!layers.body) gaps.push(`${view}: no body layer`);
    // 身体位图只缓存 body 层，只有 back / front 层跟着骨骼动。耳朵、手臂画在 body 层，骨骼在动、图形却一动不动，
    // 还会和同一根骨骼上别的部件脱节——看起来像“断开”。在作者手里就拦下来。
    const stuck = data.parts.filter(part => part.layer === 'body' && MOVING_BONES.has(part.bone));
    if (stuck.length) {
      const names = [...new Set(stuck.map(part => part.bone))];
      say(`  static parts on moving bones: ${names.join(', ')}`);
      gaps.push(`${view}: parts on the "body" layer are bound to moving bones (${names.join(', ')}) and will not move; move them to layer "back" or "front"`);
    }

    if (view !== 'back') {
      if (!data.face) {
        say('  face: none drawn -> vector face');
        gaps.push(`${view}: face`);
      } else {
        const eyes = Object.keys(EYE_FALLBACKS).map(state => {
          const pick = resolveRigFace(data.face, { eyes: state, mouth: 'neutral' })?.eyes;
          return pick?.exact ? state : `${state}->${pick ? pick.state : 'none'}`;
        });
        const mouths = Object.keys(MOUTH_FALLBACKS).map(state => {
          const pick = resolveRigFace(data.face, { eyes: 'neutral', mouth: state })?.mouth;
          return pick?.exact ? state : `${state}->${pick ? pick.state : 'none'}`;
        });
        say(`  eyes: ${eyes.join(' ')}`);
        say(`  mouth: ${mouths.join(' ')}`);
        say(`  gaze: ${data.face.eyes.neutral?.pupil ? 'pupils move' : 'no pupil group; eyes stay still'}`);
        if (!data.face.eyes.neutral) gaps.push(`${view}: eyes:neutral`);
        if (!data.face.mouth.neutral) gaps.push(`${view}: mouth:neutral`);
        if (!data.face.eyes.closed) gaps.push(`${view}: eyes:closed (blink)`);
      }
    }

    const still = Object.keys(MOTIONS).filter(motion => {
      const sample = sampleMotion(motion, { view, progress: 0.5 });
      return !Object.keys(sample.bones).some(bone => data.bones[bone]);
    });
    say(`  motions with no bone to move: ${still.length ? still.join(', ') : 'none'}`);
    const props = PROP_NAMES.map(prop => data.props[prop] ? prop : `${prop}->vector`);
    say(`  props: ${props.join(' ')}`);
    if (form?.supportedSlots) {
      const anchors = form.supportedSlots.map(slot => data.anchors[slot]
        ? `${slot}@${data.anchors[slot].bone}` : `${slot}->form anchor`);
      say(`  accessory anchors: ${anchors.join(' ')}`);
    }
  }

  if (bounds && form?.artBounds) {
    const safe = form.artBounds;
    const inside = bounds.x >= safe.x && bounds.y >= safe.y
      && bounds.x + bounds.width <= safe.x + safe.width && bounds.y + bounds.height <= safe.y + safe.height;
    say(`\nink bounds ${JSON.stringify(bounds)} vs form artBounds ${JSON.stringify(safe)}: ${inside ? 'inside' : 'OUTSIDE'}`);
    if (!inside) gaps.push('ink outside the form art bounds (motion may clip at the window edge)');
  }
  say(`\n${gaps.length ? `${gaps.length} gap(s); the app falls back as listed above:` : 'no gaps'}`);
  for (const gap of gaps) say(`  - ${gap}`);
  return { text: lines.join('\n'), gaps };
}

export { coverageReport };
