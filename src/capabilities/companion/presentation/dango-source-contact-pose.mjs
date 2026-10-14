'use strict';

import { sipContactSpriteKeys, sipSourceContactPoseEligible, applySipSourceContactPose } from './dango-sip-contact-pose.mjs';

// PET_RIG「并发配件的姿势隔离」: this authored contact layer owns only
// the two hands of one reviewed action. It never changes generic limb readiness.
const KEYS = Object.freeze({ left: 'hiccup-front-contact-left', right: 'hiccup-front-contact-right' });
const BODY_HASH = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9';
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
function sourceContactPoseEligible(manifest, pose, view, options = {}) {
  const action = options.action;
  if (action?.id !== 'hiccup' || action.motion !== 'hiccup' || action.prop !== 'cup'
    || view !== 'front' || (options.appearance?.items || []).length || options.state === 'dragged'
    || options.transform || options.matrix || action.handoffRecovery || (action.propOpacity ?? 1) !== 1) return false;
  const body = manifest.views?.front?.body;
  if (body?.src !== 'views/front/body.png' || !same(body.rect, [-1.789744, 8.533333, 69.415385, 49.066667])) return false;
  const cupSprite = manifest.tools?.cup, tools = pose.contact?.tools || [];
  const cup = tools.find(t => t.key === 'cup');
  if (tools.length !== 1 || !cup || cup.x !== 22 || cup.y !== 38 || !same(cupSprite?.rect, [0, 0, 22, 19])
    || (cup.scale ?? 1) !== 1 || (cup.rotate ?? 0) !== 0 || cup.flip || cup.pivot || cup.matrix
    || cup.coversPaw || (cup.opacity ?? 1) !== 1) return false;
  const hands = pose.contact?.hands || [];
  if (hands.length !== 2 || !['left', 'right'].every(side => hands.filter(h => h.side === side).length === 1)) return false;
  return ['left', 'right'].every(side => {
    const sprite = manifest.tools?.[KEYS[side]], c = sprite?.sourceContactPose, left = side === 'left';
    return sprite?.tint === 'body' && same(sprite.rect, [0, 0, 66, 72])
      && c?.id === 'hiccup-front-v1' && c.contractVersion === 1 && c.runtimeReady === true
      && c.action === 'hiccup' && c.view === 'front' && c.side === side
      && c.bodySha256 === BODY_HASH && same(c.fixedShoulder, [left ? 4.5 : 61.5, 45.5])
      && same(c.boundary, [left ? 23.25 : 44, 48.375]) && same(c.normal, [left ? 1 : -1, 0])
      && c.cup?.x === 22 && c.cup.y === 38 && c.cup.width === 22 && c.cup.height === 19;
  });
}

function createSourceContactPoseSelector({ manifest, source }) {
  // Shared artists serve interleaved pet/portrait/gallery calls. Reserve the
  // live pet and default channels; never evict an active window to admit another.
  // Unknown channels above the fixed budget fail closed until artist disposal.
  const windows = new Map([['pet', null], ['default', null], ['portrait', null]]);
  const maxChannels = 16;
  return Object.freeze({
    apply(pose, view, options = {}) {
      const channel = options.channel ?? 'default';
      if (typeof channel !== 'string' || channel.length > 128) return pose;
      if (!windows.has(channel)) {
        if (windows.size >= maxChannels) return pose;
        windows.set(channel, null);
      }
      let current = windows.get(channel);
      const p = Number.isFinite(options.progress) ? options.progress : 0;
      const elapsed = Number.isFinite(options.elapsedMs) ? options.elapsedMs : null;
      const explicitInstance = options.actionInstanceKey != null;
      const key = explicitInstance ? JSON.stringify([options.action?.id, options.actionInstanceKey])
        : JSON.stringify([options.action, options.motion]);
      const sip = options.action?.id === 'sip-tea';
      const keys = sip ? sipContactSpriteKeys() : Object.values(KEYS);
      const eligible = sip ? sipSourceContactPoseEligible(manifest, pose, view, options)
        : sourceContactPoseEligible(manifest, pose, view, options);
      if (!current || current.key !== key || !explicitInstance && (p < current.progress
        || elapsed !== null && current.elapsed !== null && elapsed < current.elapsed)) {
        const sprites = keys.map(k => manifest.tools?.[k]);
        const states = eligible ? sprites.map(s => source.state(s)) : [];
        current = { key, progress: p, elapsed, enabled: eligible && states.every(s => s === 'ready') };
        windows.set(channel, current);
      }
      current.progress = p; current.elapsed = elapsed;
      if (!eligible) current.enabled = false;
      if (!current.enabled) return pose;
      // If a bounded raster cache lost either image, fallback both together and
      // keep the window disabled. Never draw half of the source-contact pose.
      if (!keys.every(k => source.state(manifest.tools[k]) === 'ready')) { current.enabled = false; return pose; }
      if (sip) return applySipSourceContactPose(manifest, pose);
      return { ...pose, sourceContactPose: 'hiccup-front-v1', contact: { ...pose.contact,
        hands: pose.contact.hands.map(h => {
          const c = manifest.tools[KEYS[h.side]].sourceContactPose;
          return { ...h, pawSprite: KEYS[h.side], pawMatrix: [1, 0, 0, 1, 0, 0],
            legacyGripPoint: h.gripPoint || h.points?.at(-1), gripPoint: [...c.boundary],
            sourceContact: { kind: 'continuous-hold', target: [...c.boundary], boundaryNormal: [...c.normal],
              sourcePoseId: c.id, legacyHandleAxisSatisfied: h.side === 'right' ? false : null },
            connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' };
        }) } };
    },
    stats() { return Object.freeze({ channels: windows.size, maxChannels }); },
    dispose() { windows.clear(); windows.set('pet', null); windows.set('default', null); windows.set('portrait', null); }
  });
}
export { sourceContactPoseEligible, createSourceContactPoseSelector };
