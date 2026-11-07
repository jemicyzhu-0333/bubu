import { t } from '../../shared/interface/i18n.mjs';
import { foodName } from '../../companion/food-labels.mjs';
function renderFoodCollection({ $, escapeHTML: esc, shop, level, busy = () => false, pending = () => false }) {
  const host = $('#foodShopList');
  if (!host) return () => {};
  const items = (shop.items || []).filter(item => item.id !== 'basic');
  function copy(item) {
    const unlocked = item.unlocked !== false;
    const known = unlocked || item.inventory > 0 || item.tasted > 0 || item.level <= level + 2;
    const name = known ? foodName(item.id, item.name) : '？？？';
    // 一张卡只留一行说明：最爱 > 库存 > 尝过；未解锁的卡只剩名字和解锁等级。
    return { unlocked, known, name,
      preference: !unlocked ? '' : known && item.favorite ? t('最爱') : item.inventory ? t('库存 {count}', { count: item.inventory })
        : item.tasted ? t('尝过 {count} 次', { count: item.tasted }) : '',
      stock: '',
      aria: unlocked ? t('兑换{name}，{count} 张食物券', { name, count: item.price }) : t('LV.{level}解锁食物', { level: item.level }),
      action: pending(item.id) ? t('核对上次兑换') : unlocked ? t('兑换 · {count} 张', { count: item.price }) : t('Lv.{level} 解锁', { level: item.level }) };
  }
  host.innerHTML = items.map(item => {
    const label = copy(item), { unlocked, known } = label;
    return `<div class="food-collection-card ${unlocked ? '' : 'is-locked'}" data-food-card="${esc(item.id)}">
      <span class="food-shop-emoji" aria-hidden="true">${known ? esc(item.emoji) : '?'}</span>
      <strong>${esc(label.name)}</strong><span class="food-preference${item.favorite && unlocked ? ' is-favorite' : ''}">${esc(label.preference)}</span>
      <button type="button" class="chip food-exchange" data-food-id="${esc(item.id)}" ${((unlocked && item.affordable) || pending(item.id)) && !busy(item.id) ? '' : 'disabled'} aria-label="${esc(label.aria)}">${esc(label.action)}</button>
    </div>`;
  }).join('');
  const paintMeta = () => { const meta = $('#foodCollectionMeta');
    if (meta) meta.textContent = t('已解锁 {count} / {total}', { count: items.filter(item => item.unlocked !== false).length, total: items.length }); };
  paintMeta();
  return function repaintCopy() {
    paintMeta();
    host.querySelectorAll?.('[data-food-card]').forEach(card => {
      const item = items.find(item => item.id === card.dataset.foodCard); if (!item) return;
      const label = copy(item);
      for (const [selector, text] of [['strong', label.name], ['.food-preference', label.preference], ['button', label.action]]) {
        const target = card.querySelector(selector); if (target) target.textContent = text;
      }
      card.querySelector('button')?.setAttribute('aria-label', label.aria);
    });
  };
}
export { renderFoodCollection };
