import { t, getLocale } from '../../shared/interface/i18n.mjs';
'use strict';
import { renderCompanionOverview } from './companion-overview.mjs';
import { createSurfaceMotion } from '../../shared/motion.mjs';
import { createPopoverFoodShop } from './food-shop.mjs';
import { renderFoodCollection } from './food-collection.mjs';
import { renderCompanionCollection } from './companion-collection.mjs';

// 伙伴页的默认视图。换形态与换装的浏览界面各自在 skin-picker.mjs / wardrobe.mjs
// 的抽屉里,这一层只负责「我的伙伴现在怎么样」:身份、两个入口的副标题、养成三段。
// 「戴着 N 件」故意不在这里数 —— 配饰只有一个所有者(wardrobe.mjs),两处各数一遍
// 迟早会对不上。
function createPopoverCompanionFeature({ getState, $, escapeHTML, skinAccent, surfaceClient } = {}) {
  if (typeof getState !== 'function' || typeof $ !== 'function'
      || typeof escapeHTML !== 'function'
      || typeof skinAccent !== 'function' || !surfaceClient
      || typeof surfaceClient.buyFood !== 'function') {
    throw new TypeError('companion feature requires its scoped renderer dependencies');
  }

  let lastCompanionKey = '', lastCompanionData = '';
  let repaintCompanion = () => {}, repaintSkin = () => {};
  let lastSkinsKey = '';
  let mounted = false;
  let unsubscribe = null;
  let disclosureMotion = null;
  const disclosures = [];
  const foodShop = createPopoverFoodShop({ $, surfaceClient, getState,
    render: () => { lastCompanionKey = ''; renderCompanion(); },
    onSuccess: (foodId, status) => {
      const card = $('#foodShopList')?.querySelector(`[data-food-card="${foodId}"]`);
      if (status?.animate && !disclosureMotion?.reduced()) status.animate([{ transform: 'translateY(5px)', opacity: .3 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 380, easing: 'ease-out' });
      if (card?.animate && !disclosureMotion?.reduced()) card.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.035)', offset: .4 }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
    }
  });

  function renderCompanion(state = getState()) {
    if (!state) return;
    const projection = state.companionProjection || {};
    const bond = projection.bond || { points: 0, label: '刚认识', nextLabel: null, toNext: 0, percent: 0 };
    const affinity = projection.foodAffinity || [];
    const milestones = projection.milestones || [];
    const shop = state.foodShop || { foodTickets: state.foodTickets || 0, items: [] };
    const dataKey = JSON.stringify([
      projection.satiation, projection.totalFeeds, projection.daysTogether, projection.role,
      bond, affinity, milestones, shop, projection.journey, projection.tastes, projection.bondRoadmap,
      (shop.items || []).map(item => [item.id, foodShop.busy(item.id), foodShop.pending(item.id)])
    ]);
    const key = `${getLocale()}|${dataKey}`;
    if (key === lastCompanionKey) return;
    lastCompanionKey = key;
    if (dataKey === lastCompanionData) { repaintCompanion(); return; }
    lastCompanionData = dataKey;

    const bondLabel = label => ['刚认识', '慢慢熟了', '熟悉了', '很信任', '和它慢慢熟了', '成了熟悉的伙伴', '它很信任你了'].includes(label) ? t(label) : label;
    const paintFacts = () => {
      renderCompanionOverview($, projection);

      const stagePill = $('#bondStage');
      if (stagePill) stagePill.textContent = bondLabel(bond.label);
      const bondMeta = $('#bondMeta');
      if (bondMeta) {
        bondMeta.textContent = bond.nextLabel
          ? t('默契 {points} 点 · 再 {remaining} 点到「{next}」', { points: bond.points, remaining: bond.toNext, next: bondLabel(bond.nextLabel) })
          : t('默契 {points} 点 · 已经是最信任的阶段', { points: bond.points });
      }
      const bondProgress = $('#bondProgress');
      if (bondProgress) {
        bondProgress.setAttribute('aria-valuetext', bond.nextLabel
          ? t('{label}，默契 {points} 点，再 {remaining} 点到{next}', { label: bondLabel(bond.label), points: bond.points, remaining: bond.toNext, next: bondLabel(bond.nextLabel) })
          : t('{label}，默契 {points} 点', { label: bondLabel(bond.label), points: bond.points }));
      }

    };
    const bondBar = $('#bondBar');
    if (bondBar) bondBar.style.width = `${bond.percent}%`;
    $('#bondProgress')?.setAttribute('aria-valuenow', String(bond.percent));
    paintFacts();
    const milestoneList = $('#milestoneList');
    if (milestoneList) {
      const roadmap = projection.bondRoadmap || milestones;
      milestoneList.innerHTML = roadmap.map(item => `<li class="bond-milestone ${item.unlocked ? 'is-earned' : ''}"><span data-icon="${item.unlocked ? 'check-circle' : 'lock'}" data-icon-only></span><strong>${escapeHTML(bondLabel(item.label))}</strong><span>${item.unlocked ? t('已达成') : t('还差 {points} 点', { points: item.remaining })}</span></li>`).join('');
    }
    const journeyMeta = $('#journeyEntryMeta');
    const paintJourney = () => { if (journeyMeta) journeyMeta.textContent = t('{count} / {total} 枚纪念', { count: projection.journey?.earned || 0, total: projection.journey?.chapters?.length || 8 }); };
    paintJourney();

    const paintCollection = renderCompanionCollection({ $, escapeHTML, journey: projection.journey, tastes: projection.tastes });

    const balance = $('#foodShopBalance');
    const paintBalance = () => { if (balance) balance.textContent = t('食物券 {count} 张', { count: shop.foodTickets || 0 }); };
    paintBalance();
    const paintFood = renderFoodCollection({ $, escapeHTML, shop, level: state.level || 1, busy: foodShop.busy, pending: foodShop.pending });
    repaintCompanion = () => {
      lastCompanionKey = `${getLocale()}|${dataKey}`;
      paintFacts(); paintJourney(); paintBalance(); paintCollection?.(); paintFood?.();
      const roadmap = projection.bondRoadmap || milestones;
      milestoneList?.querySelectorAll?.('.bond-milestone').forEach((node, index) => {
        const item = roadmap[index]; if (!item) return;
        const name = node.querySelector('strong'), status = node.querySelector('span:last-child');
        if (name) name.textContent = bondLabel(item.label);
        if (status) status.textContent = item.unlocked ? t('已达成') : t('还差 {points} 点', { points: item.remaining });
      });
    };
  }

  // 名字、hero 底座的颜色、换形态入口的副标题 —— 三样都只随皮肤与解锁进度变。
  // 底座取 skinAccent() 写成两个行内变量,而不是去改 documentElement 上的主题色:
  // 主题色的所有者是 applyTheme,这里只是把同一份颜色用在一块氛围上。
  function renderCompanionSkin(state = getState()) {
    if (!state) return;
    const skins = Array.isArray(state.skins) ? state.skins : [];
    const dataKey = `${state.currentSkin}|${skins.map(skin => `${skin.id}:${skin.unlocked ? 1 : 0}:${skin.progress ? skin.progress.current : '-'}`).join(',')}`;
    const key = `${getLocale()}|${dataKey}`;
    if (key === lastSkinsKey) return;
    lastSkinsKey = key;

    const currentId = state.currentSkin || 'pink';
    const current = skins.find(skin => skin.id === currentId);
    const name = $('#companionName');
    if (name) name.textContent = current ? current.name : t('像素兽');

    const hero = $('#companionHero');
    if (hero) {
      const accent = skinAccent(currentId);
      hero.style.setProperty('--hero-primary', accent.primary);
      hero.style.setProperty('--hero-accent', accent.accent);
    }

    const meta = $('#skinEntryMeta');
    repaintSkin = () => {
      lastSkinsKey = `${getLocale()}|${dataKey}`;
      if (name && !current) name.textContent = t('像素兽');
      if (meta) {
        const unlocked = skins.filter(skin => skin.unlocked).length;
        meta.textContent = skins.length
          ? t('{total} 种 · 已解锁 {count}', { total: skins.length, count: unlocked })
          : t('暂无可选形态');
      }
    }; repaintSkin();
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('companion feature requires a projection store');
    }
    if (mounted) return;
    mounted = true;
    unsubscribe = projectionStore.subscribe(change => {
      if (change.localeOnly) { repaintCompanion(); repaintSkin(); return; }
      const dirty = change.dirty || {};
      if (dirty.all || dirty.skin || dirty.stats || dirty.tasks) renderCompanionSkin(change.state);
      if (dirty.all || dirty.skin || dirty.pet || dirty.settings || dirty.stats || dirty.tasks) {
        renderCompanion(change.state);
      }
    });
    const shopList = $('#foodShopList');
    const document = shopList?.ownerDocument;
    if (document) {
      disclosureMotion = createSurfaceMotion(document);
      for (const id of ['#foodShopPanel', '#journeyPanel']) {
        const panel = $(id);
        if (!panel) continue;
        const handler = () => { if (panel.open) void disclosureMotion.enter(panel.querySelector('.disclosure-body')); };
        panel.addEventListener('toggle', handler); disclosures.push([panel, handler]);
      }
    }
    foodShop.mount(projectionStore);
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    if (typeof unsubscribe === 'function') unsubscribe();
    foodShop.dispose();
    unsubscribe = null;
    repaintCompanion = repaintSkin = () => {};
    for (const [panel, handler] of disclosures.splice(0)) panel.removeEventListener('toggle', handler);
    disclosureMotion?.dispose(); disclosureMotion = null;
  }

  return Object.freeze({ mount, dispose, renderCompanion, renderCompanionSkin });
}


export { createPopoverCompanionFeature };
