import { source, previewSource, prepare } from './source.mjs';
import { createRenderHarness, canvas } from '../usagi-gallery/runtime-harness.mjs';
import { USAGI_OUTFIT_SETS } from '../../src/content/companion/usagi-wardrobe.mjs';
import { inspectFrame, selectGarment } from './model.mjs';
const $ = id => document.getElementById(id);
const label = item => item.label || item.name || item.id;
const catalogs = { action: Object.values(source.behaviors.PET_ACTIONS), session: Object.values(source.sessions.SESSION_ACTIVITIES), expression: source.expressions.EXPRESSIONS, mirror: Object.values(source.sessions.MIRROR_ACTIVITIES) };
const garments = source.wardrobe.PET_APPEARANCE_ITEMS;
let outfit = [], players = [], elapsed = 0, duration = 10500, playing = true, last = null, generation = 0;
const stepMs = 1000 / 30;
const settings = () => ({ skin: $('skin').value, view: $('view').value, facing: Number($('facing').value), outfit: [...outfit], calm: $('calm').checked, blink: false, dpr: 2, level: 99, scene: $('scene').value });
function fillSkins(preferred) {
  const values = Object.entries(source.skins.SKINS).filter(([, value]) => (value.formId || 'dango') === $('form').value);
  $('skin').replaceChildren(...values.map(([id, value]) => new Option(value.name, id)));
  if (values.some(([id]) => id === preferred)) $('skin').value = preferred;
}
function fillEntries(preferred) {
  $('entry').replaceChildren(...catalogs[$('kind').value].map(item => new Option(`${label(item)} · ${item.id}`, item.id)));
  if (catalogs[$('kind').value].some(item => item.id === preferred)) $('entry').value = preferred;
}
function fillWardrobe() {
  const items = garments.filter(item => (item.formId || 'dango') === $('form').value);
  $('wardrobe-count').textContent = `${items.length} 件`;
  $('wardrobe').replaceChildren();
  for (const slot of [...new Set(items.map(item => item.slot))]) {
    const title = document.createElement('h3'); title.className = 'group-title'; title.textContent = ({ head:'头饰 / 耳饰', face:'面部', neck:'颈部', body:'衣服', back:'背部', hand:'手持', front:'前景' })[slot] || slot;
    $('wardrobe').append(title);
    for (const item of items.filter(value => value.slot === slot)) {
      const row = document.createElement('label'); row.className = 'garment inline';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id; input.checked = outfit.includes(item.id); input.dataset.garment = item.id;
      const text = document.createElement('span'); text.textContent = label(item);
      const detail = document.createElement('small'); detail.textContent = `${item.id}${item.skin ? ' · ' + source.skins.SKINS[item.skin]?.name : ''}`; text.append(detail);
      input.addEventListener('change', () => {
        outfit = selectGarment(outfit, item, input.checked, garments);
        if (input.checked && item.skin) $('skin').value = item.skin;
        $('outfit').value = 'custom'; fillWardrobe(); rebuild();
      }); row.append(input, text); $('wardrobe').append(row);
    }
  }
  $('outfit').replaceChildren(new Option('自由搭配', 'custom'), new Option('不穿配饰', 'naked'), ...($('form').value === 'usagi' ? USAGI_OUTFIT_SETS.map(item => new Option(item.label, item.id)) : []));
}
function disposePlayers() { players.forEach(player => player.harness.dispose()); players = []; }
function makePlayers() {
  disposePlayers(); $('players').replaceChildren();
  const entries = $('compare').checked ? ['paper-plane', 'paper-return'].map(id => ({ kind: 'action', id })) : [{ kind: $('kind').value === 'mirror' ? 'session' : $('kind').value, id: $('entry').value }];
  for (const entry of entries) {
    const options = settings(), harness = createRenderHarness(previewSource, options);
    const channel = `workbench:${players.length}`;
    harness.select(entry.kind, entry.id); harness.updateState({ renderChannel: channel });
    // Reuse at most two rig channels. Clock rollback clears the prior pose without
    // adding a production reset API; reselect then resets face/particle input time.
    harness.draw(-1);
    const selected = harness.select(entry.kind, entry.id); harness.updateState({ renderChannel: channel });
    const article = document.createElement('article'); article.className = 'player';
    const heading = document.createElement('h3'); heading.textContent = `${label(selected.item)} · ${(selected.duration / 1000).toFixed(1)} 秒`;
    const viewport = document.createElement('div'); viewport.className = 'viewport';
    const image = canvas(440); viewport.append(image);
    const metadata = document.createElement('div'); metadata.className = 'metadata';
    article.append(heading, viewport, metadata); $('players').append(article);
    players.push({ harness, image, viewport, metadata, selected, options, kind: entry.kind, lastAt: -1 });
  }
  duration = Math.max(...players.map(player => player.selected.duration));
  $('clip-title').textContent = $('compare').checked ? '旧放飞与新回信 · 同时间对照' : label(players[0].selected.item);
  updateDisplay();
}
function updateDisplay() {
  for (const player of players) {
    player.viewport.className = 'viewport ' + $('background').value;
    player.image.style.width = `${220 * Number($('zoom').value)}px`;
    player.image.style.height = `${220 * Number($('zoom').value)}px`;
  }
}
function draw() {
  for (const player of players) {
    const at = Math.min(elapsed, player.selected.duration - .001);
    // Replay at a fixed bounded step. Paused redraw does not advance springs.
    if (at > player.lastAt || player.lastAt < 0) {
      if (player.lastAt < 0) { player.harness.draw(0); player.lastAt = 0; }
      while (player.lastAt + stepMs < at - .001) { player.lastAt += stepMs; player.harness.draw(player.lastAt); }
      if (at > player.lastAt) { player.harness.draw(at); player.lastAt = at; }
    }
    const context = player.image.getContext('2d');
    if ($('show-scene').checked) player.harness.composite(player.image);
    else { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, 440, 440); const stage = player.harness.stage; context.drawImage(player.harness.body, (220 - stage.cssWidth), (220 - stage.cssHeight) + 4, stage.cssWidth * 2, stage.cssHeight * 2); }
    const info = inspectFrame(source, { form: player.harness.form, skin: player.options.skin, kind: player.kind, item: player.selected.item, elapsed: at, duration: player.selected.duration, view: player.options.view, outfit: player.options.outfit, calm: player.options.calm });
    const phase = document.createElement('div'); phase.className = 'phase'; phase.textContent = `${info.phase}${elapsed >= player.selected.duration ? ' · 已结束，末帧保持' : ''}`;
    const detail = document.createElement('div'); detail.textContent = `${(at / 1000).toFixed(2)}s · ${(info.progress * 100).toFixed(1)}% · 请求 ${player.options.view} → 解析 ${info.resolvedView}${player.options.calm ? ' · 减少动态' : ''}`;
    const resolved = document.createElement('div'); resolved.textContent = `解析穿搭 ${info.visibleIds.length}：${info.visibleIds.map(id => label(garments.find(item => item.id === id))).join('、') || '无'}`;
    const hidden = outfit.filter(id => !info.visibleIds.includes(id));
    const note = document.createElement('div'); note.className = 'warn'; note.textContent = hidden.length ? `所选但当前视角/皮肤不适用：${hidden.join('、')}` : '';
    player.metadata.replaceChildren(phase, detail, resolved, note);
  }
  $('clock').textContent = `${(elapsed / 1000).toFixed(2)} / ${(duration / 1000).toFixed(2)}s`;
  $('seek').value = String(Math.round(elapsed / duration * 1000));
}
function rebuild() { generation += 1; elapsed = 0; last = null; makePlayers(); draw(); }
async function seek(target) {
  playing = false; $('play').textContent = '播放'; last = null;
  const token = ++generation; makePlayers(); elapsed = 0;
  // Long session seeks yield to keep mobile controls responsive. Latest seek wins.
  while (elapsed + 1000 < target) {
    if (token !== generation) return;
    elapsed += 1000; draw(); await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (token !== generation) return;
  elapsed = Math.max(0, Math.min(duration, target)); draw();
}
function tick(now) {
  if (playing && last !== null) {
    elapsed += Math.min(100, now - last) * Number($('speed').value);
    if (elapsed >= duration) {
      if ($('loop').checked) { elapsed = 0; makePlayers(); }
      else { elapsed = duration; playing = false; $('play').textContent = '播放'; }
    }
    draw();
  }
  last = now; requestAnimationFrame(tick);
}
for (const scene of Object.values(source.scenes.SCENES)) $('scene').append(new Option(label(scene), scene.id));
$('scene').value = 'cozy-room'; fillSkins('pink'); fillEntries('paper-return'); fillWardrobe();
$('counts').textContent = `2 个角色 · ${catalogs.action.length} 个动作 · ${catalogs.session.length} 个专注/休息活动 · ${catalogs.mirror.length} 个桌面活动 · ${garments.length} 件配饰 · ${USAGI_OUTFIT_SETS.length} 套现有小奇穿搭`;
$('form').addEventListener('change', () => { outfit = []; fillSkins(); fillWardrobe(); rebuild(); });
$('skin').addEventListener('change', rebuild);
$('kind').addEventListener('change', () => { $('compare').checked = false; fillEntries(); rebuild(); });
$('entry').addEventListener('change', () => { $('compare').checked = false; rebuild(); });
for (const id of ['compare', 'view', 'facing', 'calm', 'scene']) $(id).addEventListener('change', rebuild);
for (const id of ['background', 'zoom', 'show-scene']) $(id).addEventListener('change', () => { updateDisplay(); draw(); });
$('outfit').addEventListener('change', () => {
  const selected = $('outfit').value;
  if (selected !== 'custom') outfit = selected === 'naked' ? [] : [...USAGI_OUTFIT_SETS.find(item => item.id === selected).itemIds];
  fillWardrobe(); $('outfit').value = selected; rebuild();
});
$('clear').addEventListener('click', () => { outfit = []; fillWardrobe(); $('outfit').value = 'naked'; rebuild(); });
$('play').addEventListener('click', () => { generation += 1; if (elapsed >= duration) rebuild(); playing = !playing; last = null; $('play').textContent = playing ? '暂停' : '播放'; });
$('restart').addEventListener('click', rebuild);
$('prev').addEventListener('click', () => seek(Math.max(0, elapsed - stepMs)));
$('next').addEventListener('click', () => seek(Math.min(duration, elapsed + stepMs)));
$('seek').addEventListener('input', () => seek(Number($('seek').value) / 1000 * duration));
window.addEventListener('pagehide', () => { generation += 1; playing = false; disposePlayers(); });
await prepare(); rebuild(); document.body.dataset.ready = 'true'; requestAnimationFrame(tick);
