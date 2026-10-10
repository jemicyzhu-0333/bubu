import { t, onLocaleChanged } from '../shared/interface/i18n.mjs';

function createReminderActions({ document, dismiss }) {
  let pending = false, generation = 0, disposed = false, message = '';
  function paint() {
    const status = document.getElementById('nudgeStatus');
    if (status) { status.textContent = message ? t(message) : ''; status.hidden = !message; }
    for (const button of document.querySelectorAll('.nudge-action, #actions button, #closeBtn')) button.disabled = pending;
    document.body.setAttribute('aria-busy', String(pending));
  }
  const stopLocale = onLocaleChanged(paint);
  async function run(action) {
    if (disposed || pending) return;
    const owner = generation;
    pending = true; message = ''; paint();
    try {
      const result = await dismiss(action);
      if (disposed || owner !== generation) return;
      message = result?.handled === true ? '' : result?.handled === false
        ? '提醒操作未完成，可稍后重试。' : '提醒操作结果暂未确认。';
    } catch (_) {
      if (!disposed && owner === generation) message = '提醒操作结果暂未确认。';
    } finally {
      if (!disposed && owner === generation) { pending = false; paint(); }
    }
  }
  return Object.freeze({ run, reset() { generation++; pending = false; message = ''; paint(); },
    dispose() { disposed = true; generation++; stopLocale(); } });
}
export { createReminderActions };
