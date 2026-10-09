'use strict';

// 面板弹层的那张顺序表。
//
// 登记处(modal-registry)只提供机制:谁开着、Tab 困在哪、Escape 先给谁。这张表
// 是策略:每个弹层的困焦容器、两条顺序里的位次,以及 Escape 到底做什么。
// 之所以把它单独放在 surface 层而不是留在面板控制器里——控制器只应该说“这些
// 弹层各自怎么开怎么关”,不该同时是那本决定先后的册子。
//
// feature 提供开关行为,这里统一拥有跨弹层的优先级与焦点策略。
const POPOVER_MODAL_LAYER = Object.freeze([
  // 溢出菜单不是 aria-modal:它开着的时候,焦点归还与落点提示都该照常进行。
  // 但它比任何弹层都靠上面,Escape 先收它,而不是关掉背后的面板。
  { name: 'taskOverflowMenu', modal: false, dismissRank: 0, escape: 'close' },
  { name: 'settings', trap: '#settingsDrawer', focusRank: 1, dismissRank: 1, escape: 'close' },
  // 落点提示不能被 Escape 关掉——它要的就是一次表态。Escape 只把焦点送到那个
  // “可以什么都不选”的动作上,让人有出口而不是被困住。
  { name: 'quickStart', trap: '#quickStartMask', focusRank: 2, dismissRank: 2, escape: 'focusEscapeHatch' },
  { name: 'taskEdit', trap: '#taskEditMask', focusRank: 3, dismissRank: 3, escape: 'close' },
  { name: 'completeConfirm', trap: '#completeConfirmMask', focusRank: 4, dismissRank: 4, escape: 'close' },
  // review 与 breakdown 在两条顺序里的先后并不一致,这是从旧的 if-else 链继承
  // 下来的,原样保留;写成数据之后,这种分歧至少是看得见的。
  { name: 'review', trap: '#reviewMask', focusRank: 9, dismissRank: 5, escape: 'close' },
  // 只有这一层不吃掉 Escape 的默认行为,同样与旧链一致。
  { name: 'breakdown', trap: '#breakdownMask', focusRank: 5, dismissRank: 6, escape: 'closeKeepingDefault' },
  { name: 'taskCreate', trap: '#taskCreateMask', focusRank: 6, dismissRank: 7, escape: 'close' },
  { name: 'stuck', trap: '#stuckMask', focusRank: 8, dismissRank: 9, escape: 'close' },
  // 伙伴页那两个抽屉排在最上面:它们是从设置以外的入口开的偶发动作,Escape 该先
  // 收它们。两条顺序在这里一致,没有从旧链继承下来的分歧要保留。
  { name: 'skinPicker', trap: '#skinDrawer', focusRank: 10, dismissRank: 10, escape: 'close' },
  { name: 'wardrobe', trap: '#wardrobeDrawer', focusRank: 11, dismissRank: 11, escape: 'close' },
  // 共享协作会暂时隐藏来源表单。Escape 暂停协作并恢复表单；不会同时关闭草稿。
  { name: 'draftChat', trap: '#draftChatMask', focusRank: 12, dismissRank: 12, escape: 'close' }
]);

// 会占住 aria-modal 层的弹层:落点提示要等它们让开再露面。
// 这份清单不等于“有弹层开着”——➕ 与收集箱不在其中,落点提示会直接叠在它们
// 上面。这是旧行为,原样保留;写成有名字的清单之后,它至少是一个能被讨论的决定。
const POPOVER_LANDING_BLOCKING_MODALS = Object.freeze([
  'taskEdit', 'completeConfirm', 'breakdown', 'settings', 'review', 'stuck', 'draftChat'
]);

function registerPopoverModals({ registry, $, modals } = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new TypeError('popover modal layer requires a registry');
  }
  if (typeof $ !== 'function') throw new TypeError('popover modal layer requires $');
  if (!modals) throw new TypeError('popover modal layer requires the modal handles');

  // Escape 之下只有三种做法。把它们写成有名字的策略,而不是每行一个闭包:
  // 新增一个弹层时要回答的是“它属于哪一种”,而不是“再抄一遍 preventDefault”。
  const strategies = {
    close: (handle) => (event) => {
      event.preventDefault();
      handle.close();
    },
    closeKeepingDefault: (handle) => () => handle.close(),
    focusEscapeHatch: (handle) => (event) => {
      event.preventDefault();
      const mask = $(handle.trap);
      const target = mask.dataset.landingMode === 'focus'
        ? mask.querySelector('[data-focus-landing="skip"]')
        : mask.querySelector('[data-quick-resolution]');
      if (target) target.focus();
    }
  };

  for (const definition of POPOVER_MODAL_LAYER) {
    const handle = modals[definition.name];
    if (!handle || typeof handle.isOpen !== 'function') {
      throw new TypeError(`popover modal layer requires an isOpen() handle for "${definition.name}"`);
    }
    const makeEscape = strategies[definition.escape];
    if (!makeEscape) throw new TypeError(`unknown escape strategy "${definition.escape}"`);
    if (definition.escape !== 'focusEscapeHatch' && typeof handle.close !== 'function') {
      throw new TypeError(`popover modal layer requires a close() handle for "${definition.name}"`);
    }
    registry.register({
      name: definition.name,
      isOpen: handle.isOpen,
      trap: definition.trap || null,
      focusRank: definition.focusRank,
      dismissRank: definition.dismissRank,
      modal: definition.modal !== false,
      onEscape: makeEscape({ close: handle.close, trap: definition.trap })
    });
  }

  return registry;
}

export { registerPopoverModals, POPOVER_MODAL_LAYER, POPOVER_LANDING_BLOCKING_MODALS };
