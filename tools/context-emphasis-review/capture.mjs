// Bounded layout proxy: actual production art and text/state modules, with
// explicit CSS dimensions painted by Canvas. This is NOT browser DOM evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
import { createSessionActivityController } from '../../src/core/session-activity.mjs';
import { activityControllerContent, activityModeFor } from '../../src/surfaces/pet/activity-mirror.mjs';
import { createContextEmphasis, CONTEXT_BADGE_BOUNDS } from '../../src/surfaces/pet/context-emphasis.mjs';
import { createPetSpeech } from '../../src/surfaces/pet/speech.mjs';
import { paintFooterProxy, foregroundIntersections } from '../status-footer-review/proxy.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/context-emphasis'));
const backend = createRequire(import.meta.url)(arg('canvas-package') || process.env.USAGI_CANVAS_PACKAGE);
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
backend.GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Review CJK');
const source = await loadSource(pathToFileURL(root).href);
fs.mkdirSync(out, { recursive: true });
const css = fs.readFileSync(path.join(root, 'src/surfaces/pet/status-footer.css'), 'utf8');
assert.ok(css.includes('top: 169px') && css.includes('grid-template-rows: 27px 20px'), 'shared footer geometry proxy contract');
function element() {
  const classes = new Set();
  return { textContent: '', style: {}, dataset: {}, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key),
      toggle(key, on) { const value = on === undefined ? !classes.has(key) : on; if (value) classes.add(key); else classes.delete(key); return value; } } };
}
const evidence = { sourceSeal: arg('source-seal') || null,
  origin: 'Production renderer plus production context/speech ports in simulated DOM; Canvas layout proxy at exact declared CSS bounds',
  limits: ['No browser CSS cascade/layout acceptance', 'No native OS events, window/GPU or user computer test'], cases: [] };
for (const skin of ['pink', 'usagi']) for (const category of ['music', 'ai'])
  for (const dpr of [1, 2]) for (const facing of [1, -1]) for (const dressed of [false, true]) {
    if (arg('smoke') && !(skin === 'usagi' && category === 'ai' && dpr === 2 && facing === 1 && dressed)) continue;
    let now = 0, serial = 0, expression = null;
    const timers = new Map(), badge = element(), bubble = element(), stage = element(), label = element();
    const speech = createPetSpeech({ bubble, setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout: id => timers.delete(id) });
    const activityUi = createContextEmphasis({ stage, label, badge, speech });
    const controller = createSessionActivityController({ ...activityControllerContent(source.sessions), clock: { now: () => now } });
    const outfit = !dressed ? [] : skin === 'usagi' ? USAGI_OUTFIT_SETS.find(value => value.id === 'moon-post').itemIds
      : ['milestone.scarf', 'milestone.sunhat', 'milestone.boots', 'milestone.satchel', 'milestone.cape'];
    const options = { skin, dpr, outfit, facing, blink: false, activityUi, sessionActivityController: controller,
      expressionFor: () => expression || controller.current(now)?.expression || 'life.idle' };
    const h = createRenderHarness(source, options); h.select('expression', 'life.idle'); h.updateState({ devPreview: null });
    const name = `${skin}-${category}-${dpr}x-${facing}-${dressed ? 'outfit' : 'bare'}`;
    const record = { name, skin, category, dpr, facing, outfit, frames: [] };
    const draw = (at, patch = {}) => {
      now = at; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      if ('commandMenuOpen' in patch) stage.classList.toggle('menu-open', patch.commandMenuOpen);
      h.updateState(patch); return h.draw(now);
    };
    const save = (kind, frame) => {
      const canvas = backend.createCanvas(220 * dpr, 220 * dpr), ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr); ctx.fillStyle = facing === 1 ? '#eceee9' : '#20232e'; ctx.fillRect(0, 0, 220, 220);
      ctx.drawImage(h.body, .5, 2.5, 219, 219);
      const { text, box, width, boxes, actionLabel } = paintFooterProxy(ctx, { label, badge, bubble, speech, stage });
      for (const bounds of boxes) assert.ok(bounds.left >= 0 && bounds.top >= 0
        && bounds.left + bounds.width <= 220 && bounds.top + bounds.height <= 220);
      const foregroundOverlap = foregroundIntersections(h.body, boxes, dpr);
      const file = `${name}-${kind}.png`; fs.writeFileSync(path.join(out, file), canvas.toBuffer('image/png'));
      record.frames.push({ kind, file, at: now, text, measuredTextWidth: width, box: text ? box : null,
        footerBoxes: boxes, actionLabel, foregroundOverlap, speech: speech.snapshot(), context: activityUi.snapshot(), mirror: frame.mirrorPlayback });
    };
    try {
      draw(0); now = 100; controller.setMode(activityModeFor('idle', category), now); activityUi.observeCategory(category);
      draw(100); save('phrase', draw(900)); save('badge', draw(4000));
      speech.say('先听你说', 3500); const external = draw(4200); assert.equal(external.mirrorPlayback, null); assert.equal(badge.classList.contains('show'), false); save('external-suppressed', external);
      const resumed = draw(8200); assert.equal(speech.visible(), false); save('resume', resumed);
      expression = 'life.sleep'; const sleeping = draw(8400, { state: 'sleeping' }); assert.equal(sleeping.mirrorPlayback, null); save('sleep-suppressed', sleeping);
      expression = null; options.calm = true; save('calm', draw(8800, { state: 'idle', stimulationMode: 'low', motionMode: 'reduced' }));
      assert.equal(speech.visible(), false); assert.equal(badge.classList.contains('show'), true);
      controller.setMode('idle', now); activityUi.observeCategory(null); save('off', draw(9000));
      assert.equal(badge.classList.contains('show'), false); assert.equal(speech.visible(), false);
      evidence.cases.push(record);
    } finally { h.dispose(); }
  }
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ cases: evidence.cases.length, frames: evidence.cases.reduce((n, value) => n + value.frames.length, 0), out }));
