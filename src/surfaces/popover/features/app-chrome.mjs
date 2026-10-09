import { t, getLocale } from '../../shared/interface/i18n.mjs';
'use strict';

import { levelCost } from '../../../content/growth-policy.mjs';
import { THEME_VARIABLES } from '../ui/theme-appearance.mjs';
import { panelPalette } from '../ui/panel-palette.mjs';
import { createPanelNavigation } from '../ui/panel-navigation.mjs';
import { createChromeMotion } from '../ui/chrome-motion.mjs';
import { createHelpTooltips } from '../ui/help-tooltips.mjs';
import { createPanelDialogs } from '../ui/panel-dialogs.mjs';

// 外壳这一层:头上那一条（等级、经验、连击、状态徽章、免打扰、快速捕捉）、下面那
// 排标签页、顶上那条迁移告知，还有主题色注入。它们的
// 共同点是常驻——不属于任何一个弹层，也不随任务或计时进出页面。
//
// 它拥有三处防闪烁的上一次键值:头部、主题皮肤、告知。以前这几个是面板顶上各自被
// 一个渲染函数读写的模块级 let。能量那一小块连同它的键值已经搬去 energy-strip。
//
// 它不认识伙伴与进展那两个页签里有什么:切到某一页要补渲染什么，由 onTabShown 注
// 进来。免打扰在抽屉里还有一个开关，那一个归抽屉；这里只管头上这枚徽标。
function createPopoverAppChrome({
  document, $, $$, getState, getSession, surfaceClient, escapeHTML,
  nextRovingIndex, onTabShown
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover app chrome requires document, $ and $$');
  }
  for (const [name, fn] of Object.entries({
    getState, getSession, escapeHTML, nextRovingIndex, onTabShown
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover app chrome requires ${name}`);
  }
  if (!surfaceClient) throw new TypeError('popover app chrome requires surfaceClient');

  let lastHeaderKey = '';
  let lastThemeKey = null;
  let lastNoticeKey = '';
  let mounted = false;
  const teardown = [];
  const chromeMotion = createChromeMotion(document);
  const help = createHelpTooltips(document);
  const dialogs = createPanelDialogs(document);
  const navigation = createPanelNavigation({ document, $, $$, nextRovingIndex, onTabShown });

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  // -- Header (XP, level, streak, status pill)
  function renderHeader() {
    const state = getState();
    if (!state) return;
    const needed = state.levelCost || levelCost(state.level);
    const session = getSession();
    const running = session.running;
    const key = `${getLocale()}|${state.level}|${state.xp}|${needed}|${session.status}`;
    if (key === lastHeaderKey) return;
    lastHeaderKey = key;

    $('#lvBadge').textContent = `LV.${state.level}`;
    $('#xpBar').style.width = `${Math.min(100, (state.xp / needed) * 100)}%`;
    $('#xpText').textContent = `${state.xp} / ${needed} XP`;
    const xpProgress = $('#xpProgress');
    xpProgress.setAttribute('aria-valuemax', String(needed));
    xpProgress.setAttribute('aria-valuenow', String(Math.max(0, Math.min(needed, state.xp))));
    xpProgress.setAttribute('aria-valuetext', `${state.xp} / ${needed} XP`);

    const pill = $('#statusPill');
    if (running) {
      if (session.mode === 'break') {
        pill.textContent = t('休息中');
        pill.className = 'status-pill break';
      } else {
        pill.textContent = t('专注中');
        pill.className = 'status-pill focus';
      }
    } else if (session.paused) {
      pill.textContent = t('已暂停');
      pill.className = 'status-pill';
    } else {
      pill.textContent = t('待机');
      pill.className = 'status-pill';
    }
  }

  // Tabs
  function activateTab(btn, moveFocus = false) {
    navigation.activate(btn, moveFocus);
  }

  // 面板外观跟随系统；伙伴皮肤不改变工具界面的阅读对比度与操作颜色。
  function systemQuery() {
    const view = document.defaultView;
    return view && typeof view.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: light)') : null;
  }
  function currentAppearance() {
    const query = systemQuery();
    return query && query.matches ? 'light' : 'dark';
  }
  function markAppearance() {
    const root = document.documentElement;
    if (root && root.dataset) root.dataset.appearance = currentAppearance();
  }
  function applyTheme() {
    markAppearance();
    const appearance = currentAppearance();
    const key = appearance;
    if (key === lastThemeKey) return;
    const resolved = panelPalette(appearance);
    if (!resolved) return;
    lastThemeKey = key;
    const root = document.documentElement.style;
    for (const [name, variable] of Object.entries(THEME_VARIABLES)) root.setProperty(variable, resolved[name]);
  }

  // 能量那一小块（读数、曲线、归因、三个打卡键）归 features/energy-strip.mjs:同一条
  // 曲线 ARCHITECTURE「日常与能量」 还要画在当日时间轴上方一次，画法留在外壳里就得被时间轴 import，或者被
  // 抄第二遍。这里连能量的上一次键值都不留 —— 留着就会有人顺手在这里补一个读数。

  // -- DND badge。抽屉里那个同名开关、两级上限与角色 chip 归抽屉自己渲染:那几件都
  // 在抽屉的 DOM 里，也都跟着 settings 这一片脏标记走。
  function renderDND() {
    const state = getState();
    if (!state) return;
    const pill = document.getElementById('dndPill');
    pill.setAttribute('aria-pressed', String(Boolean(state.settings.dnd)));
    pill.setAttribute('aria-label', state.settings.dnd ? t('关闭免打扰') : t('开启免打扰'));
  }

  // 迁移告知只说一次，关了就不再回来（dismiss 写入持久层）。
  function renderMigrationNotices() {
    const state = getState();
    const host = $('#migrationNotices');
    if (!host || !state) return;
    const notices = Array.isArray(state.migrationNotices) ? state.migrationNotices : [];
    const key = `${getLocale()}|${notices.map(notice => notice.id).join('|')}`;
    if (key === lastNoticeKey) return;
    lastNoticeKey = key;
    host.classList.toggle('hidden', notices.length === 0);
    host.innerHTML = '';
    for (const notice of notices) {
      const row = document.createElement('div');
      row.className = 'notice-item';
      row.innerHTML = `
      <span class="notice-text">${escapeHTML(notice.message || '')}</span>
      <button type="button" class="modal-close notice-dismiss" aria-label="${escapeHTML(t('知道了，不再提醒：{message}', { message: notice.message || '' }))}">✕</button>`;
      row.querySelector('.notice-dismiss').addEventListener('click', () => {
        void surfaceClient.dismissNotice(notice.id);
      });
      host.appendChild(row);
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    chromeMotion.mount();
    help.mount(); dialogs.mount();
    navigation.mount();
    // 页面一挂上就标出外观，不等第一份状态；系统在深浅之间切换时重新推一遍。
    applyTheme();
    const query = systemQuery();
    if (query && typeof query.addEventListener === 'function') {
      const onChange = () => { lastThemeKey = null; applyTheme(); };
      query.addEventListener('change', onChange);
      teardown.push(() => query.removeEventListener('change', onChange));
    }
    listen($('#btnQuickCapture'), 'click', () => surfaceClient.openImpulse());
    listen($('#dndPill'), 'click', () => {
      const state = getState();
      void surfaceClient.updateSettings({ dnd: !(state && state.settings.dnd) });
    });
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    chromeMotion.dispose();
    help.dispose(); dialogs.dispose();
    navigation.dispose();
    while (teardown.length) teardown.pop()();
    lastHeaderKey = '';
    lastThemeKey = null;
    lastNoticeKey = '';
  }

  return Object.freeze({
    mount,
    dispose,
    activateTab,
    renderHeader,
    applyTheme,
    renderDND,
    renderMigrationNotices
  });
}


export { createPopoverAppChrome };
