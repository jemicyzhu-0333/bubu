import * as T from 'three';
import { FoundationPool, readJSON } from './browser-assets.mjs';
import { createTeaPreview } from './tea-preview.mjs';
import { createBookPreview } from './book-preview.mjs';
import { AUTHORED_CASES } from '../configuration/fixtures/authored.mjs';
import { createCompleteOutfit } from '../configuration/fixtures/complete-outfit.mjs';
const $ = id => document.getElementById(id), canvas = document.querySelector('canvas');
const manual = new URLSearchParams(location.search).has('capture');
const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0);
const scene = new T.Scene(), camera = new T.OrthographicCamera(-2.5, 2.5, 4, -1, .01, 100);
camera.position.set(0, 0, 8); camera.lookAt(0, 0, 0);
scene.add(new T.HemisphereLight(0xfff9e6, 0x718778, 2.1));
const key = new T.DirectionalLight(0xfff9ed, 2.4); key.position.set(3, 5, 8); scene.add(key);
const fill = new T.DirectionalLight(0xffffff, .8); fill.position.set(-3, 2, 4); scene.add(fill);
const clock = { time: 0 }, pool = new FoundationPool({ maxActors: 1 });
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(type, () => {
 if (manual || paused || busy) return;
 const now = performance.now(), dt = Math.min(.1, Math.max(0, (now - last) / 1000));
 clock.time += dt; chapterTime += dt; last = now;
}, { capture:true });
let actor, tea, bookPreview, busy = false, closed = false, paused = false, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let chapterTime = 0, selected = 'bare', greetingUntil = 0, tour = false, tourIndex = 0;
let last = performance.now(), raf = 0;
let needsRender = true, renderedFrames = 0;
const errors = [], cleanupWarnings = [], contactEvents = [];
renderer.debug.onShaderError = (gl, program) => errors.push(gl.getProgramInfoLog(program) || 'Shader compilation failed');
const profile = await readJSON(new URL('../../runtime-facepath05/fixtures/face-d2/profile.json', import.meta.url));
const faces = profile.paths.map(p => ({ candidate: p.id, amount: 1, enterSec: .16, exitSec: .2 }));
const authoredFaces = [...faces, ...AUTHORED_CASES[0].authoredFaces];
for (const p of profile.paths) $('face').add(new Option(`${p.id} · ${p.meaning}`, p.id));
const wardrobe = createCompleteOutfit();
const outfits = [
 ['bare','原貌','自然待机','轻轻摸摸它，或按住身体拖动。'],
 ['ear','花与叶','花与叶','耳侧配件跟随最终姿态，花瓣与叶片轻轻飘落。',0],
 ['satchel','挎包','挎包随动','拖动身体，观察挎包的摆动与回落。',1],
 ['cape','披风','披风与尾巴','展示既有披风摆动；完整布料接触仍在研究。',2],
 ['book','书本','手持书本','配件回应可触发书本释放；采用简化刚体碰撞。',3],
 ['halo','光环','光环与微光','光环跟随头顶，微光在身边散开。',4],
 ['wardrobe','完整穿搭','完整穿搭组合','花、叶、挎包、披风与光环同场展示；接触未验收。'],
];
for (const [id,label] of outfits) {
 const button = document.createElement('button'); button.textContent = label; button.dataset.outfit = id;
 button.onclick = () => run(() => select(id)); $('outfits').append(button);
}
function resize() {
 const { width,height } = canvas.getBoundingClientRect(); renderer.setSize(width,height,false);
 const halfWidth = 2.5 * width / height; camera.left = -halfWidth; camera.right = halfWidth; camera.updateProjectionMatrix();
 needsRender = true;
}
function draw() { renderer.render(scene,camera); renderedFrames++; needsRender = false; }
function controls() {
 const unavailable = Boolean(tea) || paused || reduced;
 $('face').disabled = unavailable; $('greet').disabled = unavailable;
}
const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
export function caption(title,detail) { $('chapter').textContent = title; $('description').textContent = detail; }
export function view(degrees) {
 if (!Number.isFinite(degrees) || Math.abs(degrees) > 180) throw Error('Invalid camera angle');
 const angle = degrees * Math.PI / 180;
 camera.position.set(8 * Math.sin(angle), 0, 8 * Math.cos(angle)); camera.lookAt(0, 0, 0);
 camera.updateMatrixWorld(); $('view').value = String(degrees);
 needsRender = true;
}
async function ensureActor() {
 if (actor) return; clock.time = 0;
 actor = await pool.create({ target: canvas,camera,clock,authoredFaces }); scene.add(actor.scene);
}
export async function select(id) {
 if (busy || closed) return false;
 if (id !== 'tea' && !outfits.some(row => row[0] === id)) throw Error('Unknown demo scene');
 busy = true; $('phase').textContent = '正在准备…';
 try {
  bookPreview?.dispose(); bookPreview = null; contactEvents.length = 0;
  if (id === 'tea') {
   if (actor) { actor.dispose(); actor.scene.removeFromParent(); actor = null; }
   if (!tea) { clock.time = 0; tea = await createTeaPreview({ target:canvas,camera,clock }); scene.add(tea.scene); }
   tea.restart(); caption('慢慢喝一杯茶','独立研究回放：持杯、举杯、啜饮与放下。');
  } else {
   if (tea) { tea.dispose(); tea = null; } await ensureActor();
   const item = outfits.find(row => row[0] === id);
   if (id === 'bare') actor.remove();
   else {
    const authored = id === 'wardrobe' ? { configuration:wardrobe } : AUTHORED_CASES[item[4]];
    const result = await actor.equip(authored.configuration, {
     clipLibrary:authored.clipLibrary, contactPort:event => contactEvents.push(event),
    });
    if (result.stale) throw Error('Scene change was cancelled');
    if (result.cleanupError) cleanupWarnings.push(result.cleanupError.message);
   }
   contactEvents.length = 0;
   // The scene selector returns the UI to automatic expression mode. Release
   // the corresponding authored request as well, through its existing owner.
   actor.f.h.facePort.release({ time:clock.time + .0001 });
   if (paused || reduced) actor.f.h.suspend();
   if (id === 'book') bookPreview = await createBookPreview(actor);
   caption(item[2],item[3]);
  }
  selected = id; chapterTime = 0; greetingUntil = 0; $('face').value = '';
  for (const button of document.querySelectorAll('[data-outfit]')) button.setAttribute('aria-pressed',String(button.dataset.outfit === id));
  $('tea').setAttribute('aria-pressed',String(id === 'tea')); controls();
  renderer.renderLists.dispose(); await renderer.compileAsync(scene,camera); draw();
  return true;
 } finally { busy = false; last = performance.now(); }
}
export function face(id) {
 if (!actor || busy || paused || reduced) return;
 const time = clock.time + .0001;
 if (id) actor.f.h.facePort.request({ ...faces.find(f => f.candidate === id),time });
 else actor.f.h.facePort.release({ time }); $('face').value = id;
}
export function inputTime() { clock.time += .001; }
export function point(x = 0,y = 1.4) {
 const p = new T.Vector3(x,y,0).project(camera),r = canvas.getBoundingClientRect();
 return { x:r.left + (p.x+1)*r.width/2,y:r.top + (1-p.y)*r.height/2 };
}
export function advance(dt = 1/30) {
 if (closed || busy) return snapshot();
 if (!Number.isFinite(dt) || dt < 0 || dt > .25) throw Error('Bounded demo step required');
 if (!paused && !document.hidden) {
  clock.time += dt; chapterTime += dt;
  if (actor) {
   actor.step(clock.time,{ reducedMotion:reduced,facts:clock.time < greetingUntil ? ['acknowledge'] : [] });
   bookPreview?.step(clock.time, contactEvents, reduced);
   $('phase').textContent = ({ idle:'自然待机',pending:'触摸中',petting:'抚摸',drag:'提起与拖动',landing:'落地恢复' })[actor.f.h.state.mode] ?? actor.f.h.state.mode;
  }
  if (tea) { tea.step(clock.time,dt,reduced); $('phase').textContent = `喝茶 · ${tea.snapshot().phase}`; }
  needsRender = true;
 }
 if (needsRender && !document.hidden) draw();
 return snapshot();
}
export function snapshot() {
 return { ready:!!(actor || tea),selected,busy,paused,reducedMotion:reduced,chapterTime,time:clock.time,renderedFrames,
  state:actor?.f.h.state ?? tea?.snapshot(),mounts:actor ? [...actor.mounts.keys()] : [],resources:{ ...renderer.info.memory },
  pool:pool.diagnostics(),book:bookPreview?.snapshot(),errors:[...errors],cleanupWarnings:[...cleanupWarnings],contactAccepted:false,nativePerformanceAccepted:false };
}
export function pause(value = !paused) {
 paused = Boolean(value); $('pause').textContent = paused ? '继续' : '暂停';
 if (paused) { actor?.f.h.suspend(); $('face').value = ''; }
 needsRender = true; controls(); last = performance.now();
}
export function reduce(value) {
 reduced = Boolean(value); $('reduced').checked = reduced;
 if (reduced) { actor?.f.h.suspend(); $('face').value = ''; }
 controls(); needsRender = true;
}
export function greet() { if (actor && !paused && !reduced) greetingUntil = clock.time + 1.6; }
export function cancel() {
 if (tea) tea.cancel(); else { actor?.reset(); bookPreview?.reset(clock.time); $('face').value = ''; }
 if (paused || reduced) actor?.f.h.suspend();
 needsRender = true;
}
async function run(operation) {
 try { await operation(); } catch (error) { errors.push(error.message); $('notice').textContent = `演示错误：${error.message}`; console.error(error); }
}
$('idle').onclick = () => run(() => select('bare')); $('tea').onclick = () => run(() => select('tea'));
$('face').onchange = () => run(() => face($('face').value)); $('greet').onclick = greet; $('cancel').onclick = cancel; $('pause').onclick = () => pause();
$('reduced').checked = reduced; $('reduced').onchange = () => reduce($('reduced').checked);
$('view').onchange = () => view(Number($('view').value));
$('theme').onclick = () => { const dark = document.body.classList.toggle('dark'); $('theme').textContent = dark ? '浅色背景' : '深色背景'; };
const sequence = ['bare','ear','satchel','cape','book','halo','wardrobe','tea'];
$('tour').onclick = () => { tour = !tour; tourIndex = 0; chapterTime = 0; $('tour').textContent = tour ? '停止演示' : '连续演示'; };
function loop(now) {
 if (closed) return;
 const dt = Math.min(.1,Math.max(0,(now-last)/1000)); last = now;
 if (!busy) run(() => advance(dt));
 if (tour && !busy && !paused && chapterTime > (selected === 'tea' ? 9 : 5)) { tourIndex = (tourIndex+1)%sequence.length; run(() => select(sequence[tourIndex])); }
 raf = requestAnimationFrame(loop);
}
export function contextLoss() { renderer.forceContextLoss(); }
export function contextRestore() { renderer.forceContextRestore(); }
export function graphics() { const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info'); return { renderer:ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', error:gl.getError() }; }
export function dispose() {
 if (closed) return; closed = true; cancelAnimationFrame(raf); observer.disconnect(); bookPreview?.dispose(); tea?.dispose(); pool.dispose(); renderer.dispose();
}
window.addEventListener('pagehide',dispose,{ once:true });
canvas.addEventListener('webglcontextlost',event => { event.preventDefault(); pause(true); $('notice').textContent = '绘图上下文已中断；恢复后可继续。'; });
canvas.addEventListener('webglcontextrestored',() => { renderer.compile(scene,camera); needsRender = true; $('notice').textContent = '绘图上下文已恢复。'; });
await run(() => select('bare'));
$('mode').textContent = manual ? '逐帧采样演示 · 不代表实时帧率' : '实时交互';
document.documentElement.dataset.ready = snapshot().ready ? 'true' : 'false';
if (!manual) raf = requestAnimationFrame(loop);
