'use strict';

// Renderer-only layout for ARCHITECTURE「快捷行动面板」. Measure the natural
// content, never a viewport-sized node, so shrink and screen caps cannot loop.
function createQuickPanelLayout({ window, document, client }) {
  const input = document.getElementById('impInput');
  const content = document.getElementById('quickContent');
  const shell = document.getElementById('quickShell');
  let timer = null;
  let disposed = false;
  let composing = false;
  let lastHeight = null;
  const teardown = [];
  const listen = (node, type, callback) => {
    node.addEventListener(type, callback);
    teardown.push(() => node.removeEventListener(type, callback));
  };

  function measure() {
    timer = null;
    if (disposed) return;
    const scrollTop = input.scrollTop;
    input.style.height = '0px';
    input.style.height = `${Math.max(42, Math.min(130, input.scrollHeight))}px`;
    input.scrollTop = scrollTop;
    const style = window.getComputedStyle(shell);
    const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((total, key) => total + (parseFloat(style[key]) || 0), 0);
    const height = Math.max(1, Math.min(4096, Math.ceil(content.getBoundingClientRect().height + inset)));
    if (height === lastHeight) return;
    lastHeight = height;
    Promise.resolve(client.resizeImpulse(height)).catch(() => { lastHeight = null; });
  }

  function schedule() {
    if (!disposed && timer === null) timer = window.setTimeout(measure, 0);
  }

  function onKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    document.getElementById('impulseForm').requestSubmit();
  }

  function mount() {
    listen(input, 'input', schedule);
    listen(input, 'keydown', onKeydown);
    listen(input, 'compositionstart', () => { composing = true; });
    listen(input, 'compositionend', () => { composing = false; schedule(); });
    listen(window, 'resize', schedule);
    listen(window, 'focus', () => { lastHeight = null; schedule(); });
    // Class/text changes include projection refresh, receipt, local clarification,
    // translation and programmatic clear. Ignore our own textarea style writes.
    const mutations = new window.MutationObserver(schedule);
    mutations.observe(content, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'hidden'] });
    const sizes = new window.ResizeObserver(schedule);
    sizes.observe(content);
    teardown.push(() => mutations.disconnect(), () => sizes.disconnect());
    schedule();
  }

  function dispose() {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    while (teardown.length) teardown.pop()();
  }
  return Object.freeze({ mount, dispose });
}

export { createQuickPanelLayout };
