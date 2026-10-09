import { loadSource, createRenderHarness, canvas } from './runtime-harness.mjs';
import { renderStrip as captureStrip } from './capture-core.mjs';
import { galleryVariants, availableEntry, outfitForVariant } from './selection.mjs';
import { USAGI_OUTFIT_SETS } from '/current/src/content/companion/usagi-wardrobe.mjs';
const renderStrip = (kind, id, settings) => captureStrip(variants, kind, id, { ...settings,
  variants: variants.filter(variant => availableEntry(variant, kind, id)).map(variant => variant.id),
  variantOptions: Object.fromEntries(variants.map(variant => [variant.id, { outfit: options(variant).outfit }])) });
const $ = id => document.getElementById(id);
const config = await (await fetch('/config.json')).json();
const current = await loadSource('/current');
const baseline = config.baselineAvailable ? await loadSource('/baseline') : current;
let variants = galleryVariants(current, baseline, 'usagi', config.baselineAvailable);
const catalog = {
  action: Object.values(current.behaviors.PET_ACTIONS), session: Object.values(current.sessions.SESSION_ACTIVITIES),
  expression: current.expressions.EXPRESSIONS, scene: Object.values(current.scenes.SCENES), appearance: []
};
const name = item => item.name || item.label || item.id;
const options = (variant = { skin: $('form').value === 'usagi' ? 'usagi' : 'pink' }) => ({
  scene: $('scene').value, view: $('view').value,
  outfit: outfitForVariant(variant, $('outfit').checked, $('outfitLook').value, USAGI_OUTFIT_SETS),
  calm: $('calm').checked, sceneMode: $('sceneOverride').checked ? 'selected' : 'session', dpr: 2 });
for (const item of catalog.scene) { const option = new Option(name(item), item.id); $('scene').append(option); }
for (const look of USAGI_OUTFIT_SETS) $('outfitLook').append(new Option(look.label, look.id));
$('scene').value = 'cozy-room';
let players = [], playing = !new URLSearchParams(location.search).has('capture'), elapsed = 0, duration = 8000, last = null;
function populate() {
  catalog.appearance = current.wardrobe.PET_APPEARANCE_ITEMS.filter(item => (item.formId || 'dango') === $('form').value);
  $('entry').replaceChildren(...catalog[$('kind').value].map(item => new Option(`${name(item)} · ${item.id}`, item.id)));
}
function replacePlayers() {
  for (const player of players) player.harness?.dispose();
  $('players').replaceChildren();
  players = variants.map(variant => {
    const article = document.createElement('article'); article.className = 'player';
    const title = document.createElement('h3'); title.textContent = variant.label;
    if (!availableEntry(variant, $('kind').value, $('entry').value)) {
      const note = document.createElement('p'); note.textContent = '此版本未收录该条目';
      article.append(title, note); $('players').append(article); return { ...variant, unavailable: true };
    }
    const image = canvas(440), sample = document.createElement('div'); sample.className = 'sample';
    article.append(title, image, sample); $('players').append(article);
    const harness = createRenderHarness(variant.source, { ...options(variant), skin: variant.skin });
    const selected = harness.select($('kind').value, $('entry').value, options().scene); duration = selected.duration;
    return { ...variant, harness, image, sample };
  });
  elapsed = 0; last = null;
  $('duration').textContent = `${(duration / 1000).toFixed(1)}s`;
  const item = catalog[$('kind').value].find(item => item.id === $('entry').value);
  $('clipTitle').textContent = name(item);
  $('clipDetail').textContent = `${item.id} · ${item.motion || item.face?.eyes || item.feature || item.exclusiveGroup || '静态穿戴'} · ${item.prop || item.face?.mouth || ''}`;
  drawPlayers();
}
function drawPlayers() {
  for (const player of players) {
    if (player.unavailable) continue;
    const result = player.harness.draw(elapsed); player.harness.composite(player.image);
    player.sample.textContent = `${result.state.currentRenderedEyeMask} · ${(result.state.currentActionProgress * 100).toFixed(1)}%`;
  }
  $('time').textContent = `${(elapsed / 1000).toFixed(1)}s`;
  $('seek').value = String(elapsed / duration * 1000);
}
function tick(now) {
  if (playing && last !== null) { elapsed += Math.min(100, now - last) * Number($('speed').value);
    if (elapsed >= duration) { replacePlayers(); elapsed = 0; } drawPlayers(); }
  last = now; requestAnimationFrame(tick);
}

function showStrips() {
  $('sheets').replaceChildren();
  const result = renderStrip($('kind').value, $('entry').value, { ...options(), frames: 6 });
  for (const item of result.strips) {
    const wrapper = document.createElement('article'); wrapper.className = 'sheet';
    const heading = document.createElement('h3'); heading.textContent = item.label;
    const image = new Image(); image.src = item.dataUrl; image.alt = `${$('entry').value} ${item.label} 连贯帧`;
    wrapper.append(heading, image); $('sheets').append(wrapper);
  }
  // Contact-sheet sampling uses the same rig singleton; recreate the live stages
  // before continuing so its previous pose never leaks back into playback.
  replacePlayers(); return result.metadata;
}
async function overview(kind = $('kind').value) {
  playing = false; $('play').textContent = '播放'; $('overview').replaceChildren(); $('overview').className = 'overview-grid';
  for (const entry of catalog[kind]) {
    const card = document.createElement('article'); card.className = 'catalog-card';
    const heading = document.createElement('h3'); heading.textContent = name(entry);
    const detail = document.createElement('p'); detail.textContent = entry.id;
    const strip = canvas(660, 238), context = strip.getContext('2d');
    context.fillStyle = '#eaf0f0'; context.fillRect(0, 0, 660, 238);
    for (const [i, variant] of variants.entries()) {
      if (!availableEntry(variant, kind, entry.id)) continue;
      const h = createRenderHarness(variant.source, { ...options(variant), skin: variant.skin });
      const chosen = h.select(kind, entry.id, options().scene); h.draw(chosen.duration * .55);
      const composite = h.composite(); context.drawImage(composite, i * 220, 0, 220, 220);
      composite.width = 1; composite.height = 1; h.dispose();
      context.fillStyle = '#647885'; context.font = '11px system-ui'; context.fillText(variant.label, i * 220 + 12, 234);
    }
    const image = new Image(); image.src = strip.toDataURL(); image.alt = name(entry); strip.width = 1; strip.height = 1;
    card.append(heading, detail, image); card.addEventListener('click', () => {
      $('kind').value = kind; populate(); $('entry').value = entry.id; showStrips(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }); $('overview').append(card);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  replacePlayers(); return catalog[kind].length;
}
for (const id of ['entry', 'scene', 'view', 'outfit', 'outfitLook', 'calm', 'sceneOverride']) $(id).addEventListener('change', showStrips);
$('form').addEventListener('change', () => {
  variants = galleryVariants(current, baseline, $('form').value, config.baselineAvailable);
  populate(); showStrips();
});
$('kind').addEventListener('change', () => { populate(); showStrips(); });
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? '暂停' : '播放'; });
$('restart').addEventListener('click', replacePlayers); $('refresh').addEventListener('click', showStrips);
$('overviewButton').addEventListener('click', () => overview());
$('seek').addEventListener('input', () => { playing = false; $('play').textContent = '播放'; const target = Number($('seek').value) / 1000 * duration; replacePlayers(); elapsed = target; drawPlayers(); });
populate(); $('entry').value = 'type-keyboard'; showStrips(); requestAnimationFrame(tick);
$('status').textContent = `已加载 ${catalog.expression.length} 表情 · ${catalog.action.length} 行为 · ${catalog.session.length} 会话 · ${catalog.scene.length} 场景 · 真实 Canvas/Path2D`;
window.usagiGallery = Object.freeze({ renderStrip, overview,
  catalog: Object.fromEntries(Object.entries(catalog).map(([key, items]) => [key, items.map(item => ({ id: item.id, label: name(item) }))])),
  setSelection(kind, id, sceneId) { $('kind').value = kind; populate(); $('entry').value = id; if (sceneId) $('scene').value = sceneId; return showStrips(); },
  pause() { playing = false; }, ready: true });
document.documentElement.dataset.galleryReady = 'true';
