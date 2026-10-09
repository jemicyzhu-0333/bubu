// Diagnostic only: exact production HTML/CSS, speech/status port and renderer.
// Categories and user interruptions are simulated; no native connector is used.
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { createSessionActivityController } from '../../src/core/session-activity.mjs';
import { activityControllerContent, activityModeFor } from '../../src/surfaces/pet/activity-mirror.mjs';
import { createContextEmphasis } from '../../src/surfaces/pet/context-emphasis.mjs';
import { createPetSpeech } from '../../src/surfaces/pet/speech.mjs';
import { checkFooterLayout } from '../status-footer-review/check-layout.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'normal';
const mode = params.get('mode') || 'idle';
const signals = params.get('signals')?.split(',');
const concurrent = signals ? { v: 1, music: signals.includes('music'), coding: signals.includes('coding'), ai: signals.includes('ai') } : null;
const skin = params.get('skin') || 'usagi', category = params.get('category') || 'ai';
const calm = params.get('calm') === 'true', facing = Number(params.get('facing')) || 1;
const dpr = Number(params.get('dpr')) || devicePixelRatio;
const root = new URL('../../', import.meta.url).href.replace(/\/$/, '');
const source = await loadSource(root);
let now = 0, timerSerial = 0;
const timers = new Map();
const speech = createPetSpeech({ bubble: document.getElementById('bubble'), contextSlot: document.getElementById('contextRow'),
  setTimeout: (callback, delay) => { const id = ++timerSerial; timers.set(id, { callback, at: now + delay }); return id; },
  clearTimeout: id => timers.delete(id) });
const stage = document.getElementById('stage');
stage.dataset.petForm = skin === 'usagi' ? 'usagi' : 'dango';
stage.dataset.petBubble = skin === 'usagi' ? 'side-start' : 'above';
const activityUi = createContextEmphasis({ stage, label: document.getElementById('activityLabel'),
  badge: document.getElementById('contextBadge'), speech });
const controller = createSessionActivityController({ ...activityControllerContent(source.sessions), clock: { now: () => now } });
const outfitId = params.get('outfit') || 'rain-walk';
const outfit = outfitId === 'bare' ? [] : skin === 'usagi'
  ? USAGI_OUTFIT_SETS.find(value => value.id === outfitId)?.itemIds || []
  : ['milestone.scarf', 'milestone.sunhat', 'milestone.boots', 'milestone.satchel', 'milestone.cape'];
let expression = null;
const title = params.get('long') === 'true' ? '整理一个很长的中文任务标题与接下来要做的所有便签' : null;
const displayActivity = activity => activity && title ? { ...activity, label: title } : activity;
const displayController = {
  current: at => displayActivity(controller.current(at)),
  snapshot: at => { const snapshot = controller.snapshot(at); return snapshot && { ...snapshot, activity: displayActivity(snapshot.activity) }; }
};
const harness = createRenderHarness(source, { skin, dpr, outfit, facing, calm, blink: false, activityUi,
  sessionActivityController: displayController, expressionFor: () => expression || controller.current(now)?.expression || 'life.idle' });
harness.select('expression', 'life.idle');
harness.updateState({ devPreview: null, activityMirror: null, stimulationMode: calm ? 'low' : 'normal' });
for (const [id, canvas] of [['petCanvas', harness.body], ['sceneCanvas', harness.scene], ['overlayCanvas', harness.overlay]]) {
  canvas.id = id; canvas.setAttribute('aria-hidden', 'true'); document.getElementById(id).replaceWith(canvas);
}
document.body.dataset.motion = calm ? 'reduced' : 'full';
document.body.dataset.stimulation = calm ? 'low' : 'normal';
document.body.style.background = params.get('background') === 'dark' ? '#20232e' : '#eceee9';
const frame = (at, patch = {}) => {
  now = at;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  harness.updateState(patch);
  return harness.draw(now);
};
const setCategory = value => {
  controller.setMode(activityModeFor(mode, value), now);
  harness.updateState({ activityMirror: value, activityMirrorConcurrent: concurrent, state: mode, sessionState: mode });
  activityUi.observeCategory(value, { concurrent });
};
frame(0); now = 100; setCategory(category); frame(now);
const phase = params.get('phase') || 'loop';
if (phase === 'phrase') frame(700);
else { frame(700); frame(1400); frame(3000); frame(6200); }
if (scenario === 'external-speech') { speech.say('先听你说', 3500); frame(now + 50); }
if (scenario === 'menu') { stage.classList.add('menu-open'); document.getElementById('commandMenu').classList.add('show'); frame(now + 50, { commandMenuOpen: true }); }
if (scenario === 'drag') { document.getElementById('petLayer').classList.add('dragging'); frame(now + 50, { dragging: true, state: 'dragged' }); }
if (scenario === 'dock') { stage.classList.add('is-docked', `dock-${params.get('edge') || 'bottom'}`); frame(now + 50, { dockedEdge: params.get('edge') || 'bottom' }); }
if (scenario === 'peek') { stage.classList.add('peek'); frame(now + 50); }
if (scenario === 'sleep') { expression = 'life.sleep'; frame(now + 50, { state: 'sleeping' }); }
if (scenario === 'hunger') { expression = 'react.hungry'; frame(now + 50, { state: 'hungry' }); }
if (scenario === 'focus') { controller.setMode('focused', now); frame(now + 50, { sessionState: 'focused', state: 'focused' }); }
if (scenario === 'exit') { setCategory(null); frame(now + 50); frame(now + 900); }
if (scenario === 'repeat') { setCategory(category); frame(now + 50); }
if (scenario === 'resume') {
  frame(now + 50, { dragging: true, state: 'dragged' });
  frame(now + 600, { dragging: false, state: 'idle' });
}
const rect = element => { const box = element.getBoundingClientRect(); const css = getComputedStyle(element);
  return { x: box.x, y: box.y, width: box.width, height: box.height, opacity: css.opacity, visibility: css.visibility,
    display: css.display, fontSize: css.fontSize, text: element.textContent }; };
const footerLayout = await checkFooterLayout({ scenario });
const proof = { footerLayout, origin: 'Simulated category; real production HTML/CSS, status/speech and Canvas renderer', skin, category,
  outfitId, facing, dpr, calm, phase, scenario, at: now, stage: rect(stage), badge: rect(document.getElementById('contextBadge')),
  bubble: rect(document.getElementById('bubble')), speech: speech.snapshot(), context: activityUi.snapshot(),
  mirrorPlayback: frame(now).mirrorPlayback };
document.body.dataset.reviewReady = 'true';
document.body.dataset.reviewPassed = String(footerLayout.passed);
if (parent !== window) parent.postMessage({ type: 'footer-layout-result', proof }, location.origin);
const result = document.createElement('script'); result.id = 'contextReviewResult'; result.type = 'application/json';
result.textContent = JSON.stringify(proof); document.body.append(result);
