'use strict';
import { displaySatiation } from '../../companion/satiation-display.mjs';
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

  let lastCompanionKey = '';
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
    const key = JSON.stringify([
      projection.satiation, projection.totalFeeds, projection.daysTogether, projection.role,
      bond, affinity, milestones, shop, projection.journey, projection.tastes, projection.bondRoadmap
    ]);
    if (key === lastCompanionKey) return;
    lastCompanionKey = key;

    const summary = $('#companionSummaryText');
    if (summary) {
      const days = projection.daysTogether || 0;
      const met = days > 0 ? `相识 ${days} 天` : '今天刚认识';
      summary.textContent = `${met} · 饱食 ${displaySatiation(projection.satiation ?? 65)} · 一起吃过 ${projection.totalFeeds || 0} 次`;
    }

    const stagePill = $('#bondStage');
    if (stagePill) stagePill.textContent = bond.label;
    const bondBar = $('#bondBar');
    if (bondBar) bondBar.style.width = `${bond.percent}%`;
    const bondMeta = $('#bondMeta');
    if (bondMeta) {
      bondMeta.textContent = bond.nextLabel
        ? `默契 ${bond.points} 点 · 再 ${bond.toNext} 点到「${bond.nextLabel}」`
        : `默契 ${bond.points} 点 · 已经是最信任的阶段`;
    }
    const bondProgress = $('#bondProgress');
    if (bondProgress) {
      bondProgress.setAttribute('aria-valuenow', String(bond.percent));
      bondProgress.setAttribute('aria-valuetext', bond.nextLabel
        ? `${bond.label}，默契 ${bond.points} 点，再 ${bond.toNext} 点到${bond.nextLabel}`
        : `${bond.label}，默契 ${bond.points} 点`);
    }

    const milestoneList = $('#milestoneList');
    if (milestoneList) {
      const roadmap = projection.bondRoadmap || milestones;
      milestoneList.innerHTML = roadmap.map(item => `<li class="bond-milestone ${item.unlocked ? 'is-earned' : ''}"><span data-icon="${item.unlocked ? 'check-circle' : 'lock'}" data-icon-only></span><strong>${escapeHTML(item.label)}</strong><span>${item.unlocked ? '已达成' : `还差 ${item.remaining} 点`}</span></li>`).join('');
    }
    const journeyMeta = $('#journeyEntryMeta');
    if (journeyMeta) journeyMeta.textContent = `${projection.journey?.earned || 0} / ${projection.journey?.chapters?.length || 8} 枚纪念`;

    renderCompanionCollection({ $, escapeHTML, journey: projection.journey, tastes: projection.tastes });

    const balance = $('#foodShopBalance');
    if (balance) balance.textContent = `食物券 ${shop.foodTickets || 0} 张`;
    renderFoodCollection({ $, escapeHTML, shop, level: state.level || 1, busy: foodShop.busy, pending: foodShop.pending });
  }

  // 名字、hero 底座的颜色、换形态入口的副标题 —— 三样都只随皮肤与解锁进度变。
  // 底座取 skinAccent() 写成两个行内变量,而不是去改 documentElement 上的主题色:
  // 主题色的所有者是 applyTheme,这里只是把同一份颜色用在一块氛围上。
  function renderCompanionSkin(state = getState()) {
    if (!state) return;
    const skins = Array.isArray(state.skins) ? state.skins : [];
    const key = `${state.currentSkin}|${skins.map(skin => `${skin.id}:${skin.unlocked ? 1 : 0}:${skin.progress ? skin.progress.current : '-'}`).join(',')}`;
    if (key === lastSkinsKey) return;
    lastSkinsKey = key;

    const currentId = state.currentSkin || 'pink';
    const current = skins.find(skin => skin.id === currentId);
    const name = $('#companionName');
    if (name) name.textContent = current ? current.name : '像素兽';

    const hero = $('#companionHero');
    if (hero) {
      const accent = skinAccent(currentId);
      hero.style.setProperty('--hero-primary', accent.primary);
      hero.style.setProperty('--hero-accent', accent.accent);
    }

    const meta = $('#skinEntryMeta');
    if (meta) {
      const unlocked = skins.filter(skin => skin.unlocked).length;
      meta.textContent = skins.length
        ? `${skins.length} 种 · 已解锁 ${unlocked}`
        : '暂无可选形态';
    }
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('companion feature requires a projection store');
    }
    if (mounted) return;
    mounted = true;
    unsubscribe = projectionStore.subscribe(change => {
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
      for (const id of ['#foodShopPanel', '#journeyPanel', '#bondMilestones']) {
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
    for (const [panel, handler] of disclosures.splice(0)) panel.removeEventListener('toggle', handler);
    disclosureMotion?.dispose(); disclosureMotion = null;
  }

  return Object.freeze({ mount, dispose, renderCompanion, renderCompanionSkin });
}


export { createPopoverCompanionFeature };
