function renderFoodCollection({ $, escapeHTML: esc, shop, level, busy = () => false, pending = () => false }) {
  const host = $('#foodShopList');
  if (!host) return;
  const items = (shop.items || []).filter(item => item.id !== 'basic');
  host.innerHTML = items.map(item => {
    const unlocked = item.unlocked !== false;
    const known = unlocked || item.inventory > 0 || item.tasted > 0 || item.level <= level + 2;
    const name = known ? item.name : '？？？';
    return `<div class="food-collection-card ${unlocked ? '' : 'is-locked'}" data-food-card="${esc(item.id)}">
      <span class="food-shop-emoji" aria-hidden="true">${known ? esc(item.emoji) : '?'}</span>
      <strong>${esc(name)}</strong><span class="food-preference">${known && item.favorite ? '当前形态最爱' : item.tasted ? `尝过 ${item.tasted} 次` : '等待初尝'}</span>
      <span class="food-shop-stock">${item.inventory ? `库存 ${item.inventory}` : unlocked ? '已解锁' : `LV.${item.level} 解锁`}</span>
      <button type="button" class="chip food-exchange" data-food-id="${esc(item.id)}" ${((unlocked && item.affordable) || pending(item.id)) && !busy(item.id) ? '' : 'disabled'} aria-label="${unlocked ? `兑换${esc(name)}，${item.price} 张食物券` : `LV.${item.level}解锁食物`}">${pending(item.id) ? '核对上次兑换' : unlocked ? `${item.price} 张食物券 · 兑换` : `LV.${item.level}`}</button>
    </div>`;
  }).join('');
  const meta = $('#foodCollectionMeta');
  if (meta) meta.textContent = `已解锁 ${items.filter(item => item.unlocked !== false).length} / ${items.length}`;
}
export { renderFoodCollection };
