import { t } from '../../shared/interface/i18n.mjs';

// Native pickers retain keyboard editing and the existing local-time field semantics.
// Opening or dismissing a picker never writes a value or dispatches a change.
function bindTaskDatePicker(input, button) {
  if (!input || !button) return () => {};
  const open = () => {
    if (input.disabled || input.readOnly) return;
    input.focus();
    try { input.showPicker?.(); } catch (_) { /* Keyboard editing remains available. */ }
  };
  button.addEventListener('click', open);
  return () => button.removeEventListener('click', open);
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
