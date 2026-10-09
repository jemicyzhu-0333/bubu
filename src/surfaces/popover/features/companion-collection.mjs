import { t } from '../../shared/interface/i18n.mjs';
import { foodName } from '../../companion/food-labels.mjs';
const CHAPTER_ICONS = { 'first-table': 'cup', 'first-light': 'sun', 'pocket-map': 'flag', 'rain-window': 'window', garden: 'leaf', 'night-train': 'moon', 'little-home': 'heart', 'long-road': 'sparkles' };
function stamp(chapter) { return `<span class="journey-stamp" aria-hidden="true"><i data-icon="${CHAPTER_ICONS[chapter.id] || 'notebook'}" data-icon-only></i><small>${chapter.symbol}</small></span>`; }
function renderCompanionCollection({ $, escapeHTML: esc, journey, tastes = [] }) {
  const copies = [];
  const copy = (source, params = {}) => {
    const index = copies.length, paint = () => t(source, typeof params === 'function' ? params() : params);
    copies.push(paint); return `<span data-collection-copy="${index}">${esc(paint())}</span>`;
  };
  const valueCopy = paint => { const index = copies.length; copies.push(paint); return `<span data-collection-copy="${index}">${esc(paint())}</span>`; };
  const requirement = r => ['专注', '完成任务', '尝过的口味'].includes(r.label) ? t(r.label) : r.label;
  const album = $('#journeyAlbum');
  if (album && journey) {
    const openIds = new Set([...album.querySelectorAll('details[open]')].map(item => item.dataset.chapter));
    const next = journey.next;
    album.innerHTML = `<div class="journey-summary"><strong>${journey.earned}<small> / ${copy('{count} 枚纪念', { count: journey.chapters.length })}</small></strong><span>${copy('专注 {focus} 次 · 完成 {tasks} 件', { focus: journey.facts.focus, tasks: journey.facts.tasks })}</span></div>
      ${next ? `<div class="journey-next"><span>${copy('下一枚 · {title}', { title: next.title })}</span><progress max="100" value="${next.percent}" aria-label="${esc(t('{title}解锁进度', { title: next.title }))}"></progress><div class="journey-requirements">${next.requirements.map(r => `<span class="${r.current >= r.target ? 'earned' : ''}">${valueCopy(() => requirement(r))} <b>${Math.min(r.current, r.target)}/${r.target}</b></span>`).join('')}</div></div>` : `<p class="journey-next">${copy('纪念册已集齐，每一次陪伴仍会记在这里。')}</p>`}
      <div class="journey-grid">${journey.chapters.map(c => c.unlocked
        ? `<details class="journey-card" data-chapter="${esc(c.id)}" data-color="${c.color}" ${openIds.has(c.id) ? 'open' : ''}><summary>${stamp(c)}<strong>${esc(c.title)}</strong><span>${copy('打开小信')}</span></summary><p>${esc(c.letter)}</p></details>`
        : `<div class="journey-card is-locked" data-color="${c.color}" title="${c.requirements.map(r => `${esc(requirement(r))} ${Math.min(r.current, r.target)}/${r.target}`).join(' · ')}">${stamp(c)}<strong>${esc(c.title)}</strong><span>${copy('未解锁 · {percent}%', { percent: c.percent })}</span></div>`).join('')}</div>`;
  }
  const tasteList = $('#tasteCollection');
  if (tasteList) tasteList.innerHTML = tastes.map(item => `<div class="taste-tile ${item.count ? 'is-tasted' : ''}"><span aria-hidden="true">${esc(item.emoji)}</span><strong>${valueCopy(() => foodName(item.id, item.name))}</strong><small>${valueCopy(() => ['常备点心', '熟悉的味道', '初次尝到', '未尝过'].includes(item.label) ? t(item.label) : item.label)}</small><span class="taste-count">${item.target ? `${item.count} / ${item.target}` : copy('一起吃过 {count} 次', { count: item.count })}</span></div>`).join('');
  return function repaintCopy() {
    for (const host of [album, tasteList]) host?.querySelectorAll?.('[data-collection-copy]').forEach(node => {
      const paint = copies[Number(node.dataset.collectionCopy)]; if (paint) node.textContent = paint();
    });
    if (journey?.next) album?.querySelector('progress')?.setAttribute('aria-label', t('{title}解锁进度', { title: journey.next.title }));
    album?.querySelectorAll?.('.journey-card.is-locked').forEach((node, index) => {
      const chapter = journey?.chapters.filter(chapter => !chapter.unlocked)[index];
      if (chapter) node.setAttribute('title', chapter.requirements.map(r => `${requirement(r)} ${Math.min(r.current, r.target)}/${r.target}`).join(' · '));
    });
  };
}
export { renderCompanionCollection };
