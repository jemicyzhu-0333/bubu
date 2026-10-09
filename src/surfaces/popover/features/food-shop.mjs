import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
import { createFoodRequestLifecycle, foodRequestMessage } from '../../companion/food-request-lifecycle.mjs';

function createPopoverFoodShop({ $, surfaceClient, getState, render, now, nonce, onSuccess } = {}) {
  let mounted = false, visit = 0, store = null;
  const cleanup = [];
  let statusCopy = () => '';
  const paintStatus = () => { const status = $('#foodShopStatus'); if (status) status.textContent = statusCopy(); };
  const say = copy => { statusCopy = copy; paintStatus(); };
  const requests = createFoodRequestLifecycle({
    send: request => surfaceClient.buyFood(request),
    refresh: () => store?.refresh ? store.refresh() : surfaceClient.getState(),
    validateRefresh: snapshot => Boolean(snapshot && Number.isSafeInteger(snapshot.revision)
      && Array.isArray(snapshot.foodShop?.items) && Number.isSafeInteger(snapshot.foodShop.foodTickets)),
    now, nonce
  });
  const panel = () => $('#foodShopPanel');
  function owns(owner) { return mounted && visit === owner && (!panel() || panel().open === true); }
  function listen(target, type, handler) {
    target?.addEventListener(type, handler);
    cleanup.push(() => target?.removeEventListener(type, handler));
  }
  async function click(event) {
    const button = event.target?.closest?.('[data-food-id]');
    if (!mounted || !button || button.disabled) return;
    const foodId = button.dataset.foodId, owner = visit;
    if (requests.busy(foodId)) return;
    const status = $('#foodShopStatus');
    say(() => t('兑换中…'));
    const pending = requests.run(foodId);
    render();
    const outcome = await pending;
    if (outcome.ignored) return;
    if (mounted) render();
    if (!owns(owner)) return;
    const tickets = outcome.result?.foodTickets ?? getState()?.foodShop?.foodTickets ?? 0;
    say(() => outcome.result?.ok
      ? t('已放入食物袋 · 食物券 {count} 张', { count: tickets })
      : foodRequestMessage(outcome, '兑换'));
    if (outcome.result?.ok) {
      try { onSuccess?.(foodId, status); } catch (_) { /* committed receipt stays successful */ }
    }
  }
  function mount(projectionStore) {
    if (mounted) return;
    mounted = true; visit += 1; store = projectionStore;
    cleanup.push(onLocaleChanged(paintStatus));
    listen($('#foodShopList'), 'click', click);
    const leave = () => { visit += 1; };
    listen(panel(), 'close', leave);
    listen(panel(), 'toggle', () => { leave(); render(); });
    if (typeof surfaceClient.onPopoverHidden === 'function') {
      const unsubscribe = surfaceClient.onPopoverHidden(leave);
      if (typeof unsubscribe === 'function') cleanup.push(unsubscribe);
    }
  }
  function dispose() {
    mounted = false; visit += 1; store = null;
    while (cleanup.length) cleanup.pop()();
  }
  return Object.freeze({ mount, dispose, busy: requests.busy, pending: requests.pending });
}
export { createPopoverFoodShop };
