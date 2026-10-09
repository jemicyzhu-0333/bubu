import { t } from '../../shared/interface/i18n.mjs';
'use strict';

// 闪念快捷键这一层:一个开关、一个录制键、一行「现在真正生效的是哪个组合」。
//
// 这一层存在的理由是界面以前会说谎。绑定是一道阶梯:配置的组合被别的程序占着时,
// 主进程会自动退到内置候选,于是「你设的」和「真正按得动的」可以是两个不同的组合。
// 界面上原先三处把 ⌥⇧Space 写死成字面量(头上那颗 💭、收件箱空态、托盘菜单),
// 退级之后它们仍然照原样念,用户按着一个不通的组合怀疑自己手指。所以「这个组合写
// 在哪」由这一层独占:它拿 describeQuickPanelShortcut 的结果,把生效值写到每一处提
// 到它的地方去。少一处没写的表现不是报错,是那一处继续说谎。
//
// 配置值绝不被生效值覆盖(ARCHITECTURE「快捷行动面板」):退级只是此刻的让步,占用的程序关掉以后,
// 用户本来想要的组合应当自己回来。所以录制键上画的是 configuredLabel,下面那行才
// 说现在生效的是哪一个 —— 两者不一致时把原因也说出来,而不是悄悄把配置改掉。
//
// 这一层拥有的全部状态:上一次查回来的那份描述、录制键是否正在等待按键。
function createPopoverShortcutSetting({ document, $, getState, surfaceClient } = {}) {
  if (!document || typeof $ !== 'function') {
    throw new TypeError('popover shortcut setting requires document and $');
  }
  if (typeof getState !== 'function') throw new TypeError('popover shortcut setting requires getState');
  if (!surfaceClient || typeof surfaceClient.describeQuickPanelShortcut !== 'function'
    || typeof surfaceClient.updateSettings !== 'function') {
    throw new TypeError('popover shortcut setting requires surfaceClient');
  }

  // event.code → accelerator 里的键名。只收 settings.js 的 SHORTCUT_KEY_PATTERN
  // 认得的那些:标点(`.` `/` `\`)虽然是内置候选里的合法退级目标,校验器却不收,
  // 所以录制时必须当场拒绝,而不是发一个注定被 updateSettings 打回的值。
  const KEY_TOKENS = Object.freeze({
    Space: 'Space', Tab: 'Tab', Enter: 'Return', NumpadEnter: 'Return',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
  });

  function keyToken(code) {
    if (typeof code !== 'string' || !code) return null;
    if (KEY_TOKENS[code]) return KEY_TOKENS[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
    return null;
  }

  // 修饰键名按 SHORTCUT_MODIFIERS 里的写法给,顺序固定,免得同一个组合因为拼写
  // 顺序不同被当成两个值。
  function modifiersOf(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Command');
    return parts;
  }

  let describe = null;
  let recording = false;
  let mounted = false;
  const teardown = [];

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function enabledNow() {
    const state = getState();
    if (describe && typeof describe.enabled === 'boolean') return describe.enabled;
    return Boolean(state && state.settings && state.settings.quickPanelEnabled);
  }

  // 生效值:开着且抢到了才有:关掉或一级都没抢到时,任何一处都不该再写出组合来。
  function effectiveLabel() {
    if (!describe || !describe.enabled || !describe.registered) return '';
    return describe.label || '';
  }

  // 四种状态各说一句实话。措辞里不含「错误」「失败」:退级和抢不到都不是用户的
  // 过失,面板也照样从菜单栏打得开。
  function effectiveNote() {
    if (!describe) return t('正在读取生效的组合…');
    if (!describe.enabled) return t('已关闭。仍可用伙伴右键菜单里的快速记录');
    if (!describe.registered) return t('这台机器上的组合键都被占用了。仍可用伙伴右键菜单里的快速记录，或从菜单栏打开');
    if (describe.usedFallback) {
      return t('现在生效：{shortcut} · 你设的 {configured} 被别的程序占着,先用这个', { shortcut: describe.label, configured: describe.configuredLabel })
        + t('（配置没被改掉,那个程序关掉后会自己回来）');
    }
    return t('现在生效：{shortcut}', { shortcut: describe.label });
  }

  function paintToggle() {
    const toggle = document.querySelector('[data-toggle="quickPanelEnabled"]');
    if (!toggle) return;
    const on = enabledNow();
    toggle.textContent = on ? t('开') : t('关');
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-pressed', String(on));
  }

  // 除了设置抽屉,凡是把组合写给用户看的地方都在这里一次写完。关掉或没抢到时
  // 退回「点头上那颗 💭」的说法 —— 写一个按不动的组合比不写更糟。
  function paintMentions() {
    const label = effectiveLabel();
    const capture = $('#btnQuickCapture');
    if (capture) {
      capture.title = label ? t('快捷行动 {shortcut}', { shortcut: label }) : t('打开快捷行动面板');
      capture.setAttribute('aria-label', label
        ? t('打开快捷行动面板，快捷键 {shortcut}', { shortcut: label })
        : t('打开快捷行动面板'));
    }
    const hint = $('#inboxEmptyHint');
    if (hint) hint.textContent = label ? t('按 {shortcut} 随时记下闪念', { shortcut: label }) : t('用伙伴右键菜单里的快速记录随时记下闪念');
  }

  function render() {
    paintToggle();
    const recorder = $('#quickPanelRecorder');
    if (recorder) {
      if (recording) {
        recorder.textContent = t('按下想用的组合…');
      } else {
        const state = getState();
        const configured = (describe && (describe.configuredLabel || describe.configured))
          || (state && state.settings && state.settings.quickPanelShortcut) || '';
        recorder.textContent = configured || t('未设置');
      }
      recorder.classList.toggle('recording', recording);
      recorder.setAttribute('aria-pressed', String(recording));
    }
    const note = $('#quickPanelEffective');
    if (note) note.textContent = recording ? t('Esc 取消 · 至少要带一个修饰键（⌘ ⌃ ⌥ ⇧）') : effectiveNote();
    paintMentions();
  }

  // 每次改动之后都重新问一遍主进程,因为改配置的结果不一定是「按你说的办」:
  // 新组合抢不到时会退级,甚至回滚到上一个能用的组合。界面只该复述结果。
  async function refresh() {
    try {
      describe = await surfaceClient.describeQuickPanelShortcut();
    } catch (_) {
      describe = null;
    }
    if (!mounted) return;
    render();
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    render();
  }

  async function commit(accelerator) {
    recording = false;
    const note = $('#quickPanelEffective');
    if (note) note.textContent = t('正在绑定 {shortcut}…', { shortcut: accelerator });
    try {
      await surfaceClient.updateSettings({ quickPanelShortcut: accelerator });
    } catch (_) {
      // 校验被打回时不改任何东西,refresh 会把界面画回真实状态。
    }
    await refresh();
  }

  function onRecorderKeydown(event) {
    if (!recording) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      stopRecording();
      return;
    }
    // 只按着修饰键还没落到主键上:让用户继续按,不要把 ⌥ 当成一个组合。
    if (['Alt', 'Control', 'Shift', 'Meta', 'AltGraph', 'CapsLock'].includes(event.key)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const modifiers = modifiersOf(event);
    const key = keyToken(event.code);
    const note = $('#quickPanelEffective');
    if (!key) {
      if (note) note.textContent = t('这个键不能用于全局快捷键 · 请用字母、数字、F1–F24 或空格等按键');
      return;
    }
    if (!modifiers.length) {
      if (note) note.textContent = t('至少要带一个修饰键（⌘ ⌃ ⌥ ⇧）· Esc 取消');
      return;
    }
    void commit([...modifiers, key].join('+'));
  }

  function mount() {
    if (mounted) return;
    mounted = true;

    listen($('#quickPanelRecorder'), 'click', () => {
      recording = !recording;
      render();
    });
    listen($('#quickPanelRecorder'), 'keydown', onRecorderKeydown);
    // 焦点离开就退出录制:一个停在「按下想用的组合…」上、其实已经不收键的按钮,
    // 比没有录制态更让人困惑。
    listen($('#quickPanelRecorder'), 'blur', stopRecording);

    listen(document.querySelector('[data-toggle="quickPanelEnabled"]'), 'click', async () => {
      const state = getState();
      const next = !(state && state.settings && state.settings.quickPanelEnabled);
      await surfaceClient.updateSettings({ quickPanelEnabled: next });
      await refresh();
    });

    void refresh();
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    while (teardown.length) teardown.pop()();
    describe = null;
    recording = false;
  }

  return Object.freeze({ mount, dispose, render, refresh });
}

export { createPopoverShortcutSetting };
