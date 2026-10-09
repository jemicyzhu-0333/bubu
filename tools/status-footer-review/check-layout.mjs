// Execute in an authorized real browser against the complete production page.
// This measures DOM/CSS and hit targets; it does not certify a native OS window.
const ids = ['activityBar', 'activityLabel', 'activityNext', 'contextBadge', 'bubble', 'feedQuick'];
function visible(element) {
  if (!element || !element.getClientRects().length) return false;
  for (let node = element; node instanceof Element; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  return true;
}
function bounds(element) {
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
}
function intersects(a, b) {
  return Math.min(a.right, b.right) > Math.max(a.x, b.x) + .1
    && Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + .1;
}
async function checkFooterLayout({ scenario = 'normal' } = {}) {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const records = Object.fromEntries(ids.map(id => {
    const element = document.getElementById(id);
    return [id, { visible: visible(element), ...bounds(element), text: element.textContent,
      accessibleName: element.getAttribute('aria-label'), font: getComputedStyle(element).font }];
  }));
  const failures = [];
  const textIds = ['activityLabel', 'activityNext', 'contextBadge', 'bubble', 'feedQuick'];
  for (let i = 0; i < textIds.length; i++) for (let j = i + 1; j < textIds.length; j++) {
    const a = records[textIds[i]], b = records[textIds[j]];
    if (a.visible && b.visible && intersects(a, b)) failures.push(`${textIds[i]} overlaps ${textIds[j]}`);
  }
  for (const id of ['activityBar', 'contextBadge', 'feedQuick']) {
    const box = records[id];
    if (box.visible && (box.x < -.1 || box.y < -.1 || box.right > innerWidth + .1 || box.bottom > innerHeight + .1)) {
      failures.push(`${id} escapes viewport`);
    }
  }
  const targets = [];
  for (const id of ['activityNext', 'feedQuick', 'contextBadge']) {
    const element = document.getElementById(id), box = records[id];
    if (!box.visible) continue;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    element.focus({ preventScroll: true });
    const focusable = document.activeElement === element;
    const clickable = hit === element || element.contains(hit);
    targets.push({ id, clickable, focusable });
    if (!clickable || !focusable) failures.push(`${id} is not clickable/focusable`);
    if (id === 'contextBadge') {
      const label = element.querySelector('.context-label');
      if (visible(label) && label.scrollWidth > label.clientWidth + 1) failures.push('expanded context label is clipped');
      element.click();
      if (element.getAttribute('aria-expanded') !== 'true') failures.push('context click does not expand');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (element.getAttribute('aria-expanded') !== 'false') failures.push('Escape does not collapse context');
    }
    element.blur();
  }
  if (innerHeight < 218 && records.contextBadge.visible) failures.push('short viewport must collapse supplemental context');
  if (['menu', 'dock', 'peek', 'drag', 'external-speech'].includes(scenario) && records.contextBadge.visible) {
    failures.push(`${scenario} did not suppress supplemental context`);
  }
  return { origin: 'Complete production HTML/CSS in browser, production renderer, simulated signals',
    viewport: { width: innerWidth, height: innerHeight, actualDevicePixelRatio: devicePixelRatio },
    records, targets, failures, passed: failures.length === 0 };
}
export { checkFooterLayout };
