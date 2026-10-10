import { t } from '../../shared/interface/i18n.mjs';

// Mutation and uncertainty survive drawer visits. Only a fresh canonical read
// can resolve a lost receipt; reopening never silently retries the write.
function createAppearanceCommand({ $, changed, statusSelector = '#wardrobeStatus',
  controls = () => [...($('#wardrobeOptions')?.querySelectorAll?.('.wardrobe-option') || []), $('#wardrobeReset')].filter(Boolean),
  blocked = button => button.classList.contains('locked'), reconcile,
  copy = ['正在保存搭配…', '搭配未能保存，请稍后重试。', '搭配结果暂未确认，重新打开后可核对。'] }) {
  let pending = false, uncertain = false, reconciling = false, reconcileAgain = false, visit = 0, disposed = false, message = '';
  const busy = () => pending || uncertain || reconciling;
  function paint() {
    const status = $(statusSelector);
    if (status) {
      status.textContent = message ? t(message) : '';
      status.classList.toggle('hidden', !message);
      status.dataset.tone = message === copy[1] ? 'error' : 'quiet';
    }
    for (const button of controls()) {
      button.disabled = busy() || blocked(button);
      button.setAttribute?.('aria-busy', String(pending || reconciling));
    }
  }
  async function resolveUnknown() {
    if (!uncertain || pending || reconciling || disposed || typeof reconcile !== 'function') return;
    const owner = visit;
    reconciling = true; paint();
    try {
      const confirmed = await reconcile();
      if (confirmed === true && owner === visit && !disposed) { uncertain = false; message = ''; }
    } catch (_) { /* Keep the unresolved result and mutation lock. */ }
    finally {
      reconciling = false;
      if (!disposed) { paint(); changed(); }
      if (reconcileAgain) { reconcileAgain = false; await resolveUnknown(); }
    }
  }
  async function run(operation) {
    if (busy() || disposed) return;
    const owner = visit;
    pending = true; message = copy[0]; paint();
    try {
      const result = await operation();
      uncertain = result?.ok !== true && result?.ok !== false;
      if (!disposed && owner === visit) message = uncertain ? copy[2] : result.ok ? '' : copy[1];
    } catch (_) {
      uncertain = true;
      if (!disposed && owner === visit) message = copy[2];
    } finally {
      pending = false;
      if (owner !== visit) message = uncertain ? copy[2] : '';
      if (!disposed) { paint(); changed(); await resolveUnknown(); }
    }
  }
  function nextVisit() {
    visit++; message = pending ? copy[0] : uncertain ? copy[2] : ''; paint();
    if (reconciling && uncertain) reconcileAgain = true;
    else void resolveUnknown();
  }
  return Object.freeze({ run, paint, nextVisit, mount() { disposed = false; nextVisit(); }, busy,
    dispose() { disposed = true; visit++; } });
}
export { createAppearanceCommand };
