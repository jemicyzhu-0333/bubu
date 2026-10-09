const CHAPTER_ICONS = { 'first-table': 'cup', 'first-light': 'sun', 'pocket-map': 'flag', 'rain-window': 'window', garden: 'leaf', 'night-train': 'moon', 'little-home': 'heart', 'long-road': 'sparkles' };
function stamp(chapter) { return `<span class="journey-stamp" aria-hidden="true"><i data-icon="${CHAPTER_ICONS[chapter.id] || 'notebook'}" data-icon-only></i><small>${chapter.symbol}</small></span>`; }
function renderCompanionCollection({ $, escapeHTML: esc, journey, tastes = [] }) {
  const album = $('#journeyAlbum');
  if (album && journey) {
    const openIds = new Set([...album.querySelectorAll('details[open]')].map(item => item.dataset.chapter));
    const next = journey.next;
    album.innerHTML = `<div class="journey-summary"><strong>${journey.earned}<small> / ${journey.chapters.length} 枚纪念</small></strong><span>专注 ${journey.facts.focus} 次 · 完成 ${journey.facts.tasks} 件</span></div>
      ${next ? `<div class="journey-next"><span>下一枚 · ${esc(next.title)}</span><progress max="100" value="${next.percent}" aria-label="${esc(next.title)}解锁进度"></progress><div class="journey-requirements">${next.requirements.map(r => `<span class="${r.current >= r.target ? 'earned' : ''}">${esc(r.label)} <b>${Math.min(r.current, r.target)}/${r.target}</b></span>`).join('')}</div></div>` : '<p class="journey-next">纪念册已集齐，每一次陪伴仍会记在这里。</p>'}
      <div class="journey-grid">${journey.chapters.map(c => c.unlocked
        ? `<details class="journey-card" data-chapter="${esc(c.id)}" data-color="${c.color}" ${openIds.has(c.id) ? 'open' : ''}><summary>${stamp(c)}<strong>${esc(c.title)}</strong><span>打开小信</span></summary><p>${esc(c.letter)}</p></details>`
        : `<div class="journey-card is-locked" data-color="${c.color}" title="${c.requirements.map(r => `${esc(r.label)} ${Math.min(r.current, r.target)}/${r.target}`).join(' · ')}">${stamp(c)}<strong>${esc(c.title)}</strong><span>未解锁 · ${c.percent}%</span></div>`).join('')}</div>`;
  }
  const tasteList = $('#tasteCollection');
  if (tasteList) tasteList.innerHTML = tastes.map(t => `<div class="taste-tile ${t.count ? 'is-tasted' : ''}"><span aria-hidden="true">${esc(t.emoji)}</span><strong>${esc(t.name)}</strong><small>${esc(t.label)}</small><span class="taste-count">${t.target ? `${t.count} / ${t.target}` : `一起吃过 ${t.count} 次`}</span></div>`).join('');
}
export { renderCompanionCollection };
