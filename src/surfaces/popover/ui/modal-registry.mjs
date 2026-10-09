'use strict';

// 面板里的弹层登记处。
//
// 之前这件事由三段手写清单同步维护:一条 Tab 的 if-else 链决定焦点困在哪个容器,
// 一条 Escape 的 if-else 链决定先关谁,再加一个把九个谓词或起来的 isModalOpen()。
// 新加一个弹层要同时改三处,漏掉任何一处的表现都不是报错,而是“Escape 关错了
// 层”或“Tab 跑到弹层背后去了”——正是最难被测出来的那类回归。
//
// 现在顺序是数据:每个弹层登记自己的 isOpen / 困焦容器 / Escape 该做什么,以及
// 它在两条顺序里的位次。谁拥有这个弹层,谁登记它。
function createPopoverModalRegistry({ $, modalPrimitive, onNoneOpen } = {}) {
  if (typeof $ !== 'function') throw new TypeError('popover modal registry requires $');
  if (!modalPrimitive || typeof modalPrimitive.trapFocusWithin !== 'function') {
    throw new TypeError('popover modal registry requires modalPrimitive');
  }
  if (typeof onNoneOpen !== 'function') {
    throw new TypeError('popover modal registry requires onNoneOpen');
  }

  const entries = new Map();

  function register(definition = {}) {
    const { name, isOpen, trap = null, onEscape, focusRank, dismissRank, modal = true } = definition;
    if (typeof name !== 'string' || !name) throw new TypeError('modal registration requires a name');
    if (entries.has(name)) throw new Error(`modal "${name}" is already registered`);
    if (typeof isOpen !== 'function') throw new TypeError(`modal "${name}" requires isOpen()`);
    if (typeof onEscape !== 'function') throw new TypeError(`modal "${name}" requires onEscape()`);
    if (!Number.isFinite(dismissRank)) throw new TypeError(`modal "${name}" requires dismissRank`);
    // 困焦是可选的:溢出菜单要吃 Escape,但它不是 aria-modal,不困焦点。
    if (trap !== null && !Number.isFinite(focusRank)) {
      throw new TypeError(`modal "${name}" declares a trap container but no focusRank`);
    }
    entries.set(name, Object.freeze({ name, isOpen, trap, onEscape, focusRank, dismissRank, modal }));
    return name;
  }

  function ordered(rankKey) {
    return [...entries.values()]
      .filter(entry => Number.isFinite(entry[rankKey]))
      .sort((a, b) => a[rankKey] - b[rankKey]);
  }

  // 名字打错不能静默返回 false:那会让“有弹层开着”这件事悄悄变成“没有”,
  // 表现是落点提示叠在编辑器上面,而不是一条报错。
  function isOpen(name) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`modal "${name}" is not registered`);
    return Boolean(entry.isOpen());
  }

  // “有弹层开着吗”只问 aria-modal 的那些:溢出菜单开着时,焦点归还与落点提示
  // 都该照常进行。
  function isAnyOpen() {
    return $('dialog.panel-dialog[open]')?.open === true || [...entries.values()].some(entry => entry.modal && entry.isOpen());
  }

  function openNames() {
    return ordered('dismissRank').filter(entry => entry.modal && entry.isOpen()).map(entry => entry.name);
  }

  function handleTab(event) {
    const top = ordered('focusRank').find(entry => entry.trap && entry.isOpen());
    if (top) modalPrimitive.trapFocusWithin(event, $(top.trap));
  }

  // Escape 交给最靠上的那一层自己处理:要不要 preventDefault、关掉还是只把焦点
  // 挪回可用动作,都由弹层自己说,登记处只负责选中谁。
  function handleEscape(event) {
    const top = ordered('dismissRank').find(entry => entry.isOpen());
    if (top) {
      top.onEscape(event);
      return;
    }
    onNoneOpen(event);
  }

  function handleKeydown(event) {
    if (event.key === 'Tab') handleTab(event);
    else if (event.key === 'Escape') handleEscape(event);
  }

  return Object.freeze({ register, isOpen, isAnyOpen, openNames, handleKeydown });
}


export { createPopoverModalRegistry };
