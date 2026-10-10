import { t } from '../../shared/interface/i18n.mjs';

// Native pickers retain keyboard editing and the existing local-time field semantics.
// Opening or dismissing a picker never writes a value or dispatches a change.
function bindTaskDatePicker(input, button) {
  if (!input || !button) return () => {};
  const setCustomPicker = enabled => {
    input.dataset.customPicker = String(enabled);
    button.dataset.ready = String(enabled);
    button.hidden = !enabled;
  };
  setCustomPicker(typeof input.showPicker === 'function');
  const open = () => {
    if (input.disabled || input.readOnly) return;
    input.focus();
    try {
      if (typeof input.showPicker !== 'function') setCustomPicker(false);
      else input.showPicker();
    } catch (_) {
      // Restore the native affordance if the enhanced entry cannot open it.
      setCustomPicker(false);
    }
  };
  button.addEventListener('click', open);
  return () => {
    button.removeEventListener('click', open);
    setCustomPicker(false);
  };
}

function taskDateInputError(input, parse, format) {
  if (!input) return '';
  const value = input.value;
  const parsed = value ? parse(value) : null;
  const invalid = Boolean(input.validity?.badInput || (value && (!parsed || (format && format(parsed) !== value))));
  input.setAttribute('aria-invalid', String(invalid));
  return invalid ? t('日期或时间无效，当前输入不会保存。') : '';
}

export { bindTaskDatePicker, taskDateInputError };
