'use strict';

// 新任务表单里「什么时候」这一组字段：放在哪天看（plannedFor）、什么时候可开始
// (scheduledFor)、外部截止（deadline）、自动失效（expiresAt），以及重复规则。
//
// 它们住在一个模块里不是因为都长得像日期，而是因为“没选就是没选”这条规则必须
// 由同一层守住：从其中一个字段顺手推出另一个，就是替用户做了一个他没说出口的
// 决定。之前这八个选择是面板顶上的模块级 let，三行重复 chip 又散在
// wireTaskControls 里，于是“清空草稿”和“读取草稿”各自维护一份字段清单——
// 漏一个的表现不是报错，而是上一件事的计划静默跟到下一件事上。
//
// 这一层不认识 state，也不认识 IPC：自动失效的默认区间由外面给，校验只回一句
// 给人看的话，发不发得出去由表单自己决定。
function createPopoverTaskWhenFields({
  $, $$, syncPressedButtons,
  localDateInputValue, localDateTimeInputValue, endOfDayISO,
  scheduledFromDateTimeInput, endOfLocalDateISO, formatExpiry,
  recurrenceIntervalError, autoExpiryPreview, showStatus
} = {}) {
  if (typeof $ !== 'function' || typeof $$ !== 'function' || typeof syncPressedButtons !== 'function') {
    throw new TypeError('popover task when fields require $, $$ and syncPressedButtons');
  }
  for (const [name, fn] of [
    ['localDateInputValue', localDateInputValue],
    ['localDateTimeInputValue', localDateTimeInputValue],
    ['endOfDayISO', endOfDayISO],
    ['scheduledFromDateTimeInput', scheduledFromDateTimeInput],
    ['endOfLocalDateISO', endOfLocalDateISO],
    ['formatExpiry', formatExpiry]
  ]) {
    if (typeof fn !== 'function') throw new TypeError(`popover task when fields require ${name}`);
  }
  if (typeof recurrenceIntervalError !== 'function') {
    throw new TypeError('popover task when fields require recurrenceIntervalError');
  }
  if (typeof autoExpiryPreview !== 'function' || typeof showStatus !== 'function') {
    throw new TypeError('popover task when fields require autoExpiryPreview and showStatus');
  }

  let selectedWhen = 'none';           // 什么时候做:today / tomorrow / none(写 plannedFor)
  let selectedRepeat = 'none';         // none / daily / weekly / monthly
  let selectedWeekdays = [];           // 每周重复选中的 ISO 星期(1 一 … 7 日)
  let selectedRepeatStrategy = 'fixed';
  let selectedPlannedFor = null;       // “放在哪天看”,YYYY-MM-DD
  let selectedScheduledFor = null;     // “什么时候可开始”,ISO instant
  let selectedDeadline = null;         // 外部截止
  let selectedExpiryMode = 'none';     // 自动失效:默认不开
  let mounted = false;

  const teardown = [];
  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  // 重复规则只在用户真的选了才存在。“不重复”是 null 而不是一个 frequency：
  // 任务不应该因为被捕捉就默认拥有一个周期。
  function recurrence() {
    if (selectedRepeat === 'none') return null;
    const weekdays = selectedRepeat === 'weekly' && selectedWeekdays.length
      ? [...selectedWeekdays].sort((left, right) => left - right)
      : null;
    const intervalInput = $('#repeatIntervalInput');
    const interval = intervalInput && intervalInput.value !== '' ? Number(intervalInput.value) : 1;
    return {
      frequency: selectedRepeat,
      interval,
      weekdays,
      strategy: selectedRepeatStrategy
    };
  }

  // 自动失效不再是某类任务的默认行为，而是一个用户显式打开的开关。'none'
  // 返回 null，于是任务永远不会因为“没做完”而自己变成一条待处理的过期提醒。
  function expiresAt() {
    const now = Date.now();
    switch (selectedExpiryMode) {
      case 'default': return autoExpiryPreview() || null;
      case 'midnight': return endOfDayISO(0);
      case 'tomorrow': return endOfDayISO(1);
      case '2h': return new Date(now + 2 * 3600000).toISOString();
      case '4h': return new Date(now + 4 * 3600000).toISOString();
      default: return null;
    }
  }

  // 四个日期字段与重复规则互不代替：每一项都只报告自己被选成了什么。
  function values() {
    return {
      plannedFor: selectedPlannedFor,
      scheduledFor: selectedScheduledFor,
      deadline: selectedDeadline,
      expiresAt: expiresAt(),
      recurrence: recurrence()
    };
  }

  // 重复规则的两条硬边界要在发出去之前问出来，而且都承诺输入不会丢：一条被拒
  // 的规则不该顺手把已经填好的其他字段一起带走。
  function validate() {
    const rule = recurrence();
    const intervalError = rule && recurrenceIntervalError(rule.interval, { keepsInput: true });
    if (intervalError) return intervalError;
    if (selectedRepeat === 'weekly' && selectedWeekdays.length === 0) {
      return '每周重复需要至少选一个星期；当前输入不会丢。';
    }
    return '';
  }

  function setScheduledFor(scheduledFor) {
    selectedScheduledFor = scheduledFor || null;
    const input = $('#scheduledForInput');
    if (input) {
      input.value = selectedScheduledFor ? localDateTimeInputValue(selectedScheduledFor) : '';
      input.setAttribute('aria-invalid', 'false');
    }
  }

  function setDeadline(deadline) {
    selectedDeadline = deadline || null;
    const input = $('#deadlineInput');
    if (input) {
      input.value = selectedDeadline ? localDateInputValue(selectedDeadline) : '';
      input.setAttribute('aria-invalid', 'false');
    }
  }

  // 新建任务时实时显示“如果开了自动失效，会算到哪里”
  function renderExpiryPreview() {
    const el = $('#expiryPreview');
    if (!el) return;
    const iso = expiresAt();
    el.textContent = iso ? `→ ${formatExpiry(iso)} 失效` : '→ 不会自动失效';
  }

  // “什么时候做”只写 plannedFor 这一个字段。它不顺手设截止、不顺手设预约：
  // 四个日期字段互不代替，替用户猜一个就是替他做了没说出口的决定。
  function applyWhen(when) {
    selectedWhen = when;
    const offsetDays = when === 'today' ? 0 : when === 'tomorrow' ? 1 : null;
    selectedPlannedFor = offsetDays === null
      ? null
      : localDateInputValue(new Date().setDate(new Date().getDate() + offsetDays));
    const input = $('#plannedForInput');
    if (input) input.value = selectedPlannedFor || '';
    syncPressedButtons('.when-chip', button => button.dataset.when === selectedWhen);
  }

  // plannedFor 也能在折叠区里直接改。改了就让上面的 chip 说真话，而不是留着一个
  // 已经不成立的高亮。
  function syncWhenFromPlannedFor() {
    const today = localDateInputValue();
    const tomorrow = localDateInputValue(new Date().setDate(new Date().getDate() + 1));
    selectedWhen = selectedPlannedFor === today ? 'today'
      : selectedPlannedFor === tomorrow ? 'tomorrow'
        : selectedPlannedFor ? 'custom' : 'none';
    syncPressedButtons('.when-chip', button => button.dataset.when === selectedWhen);
  }

  function reset() {
    selectedWhen = 'none';
    selectedRepeat = 'none';
    selectedWeekdays = [];
    selectedRepeatStrategy = 'fixed';
    selectedPlannedFor = null;
    selectedExpiryMode = 'none';
    for (const [selector, value] of [['#plannedForInput', ''], ['#repeatIntervalInput', '1']]) {
      const input = $(selector);
      if (input) input.value = value;
    }
    setScheduledFor(null);
    setDeadline(null);
    syncPressedButtons('.when-chip', button => button.dataset.when === selectedWhen);
    syncPressedButtons('.repeat-chip', button => button.dataset.repeat === selectedRepeat);
    syncPressedButtons('.weekday-chip', () => false);
    syncPressedButtons('.repeat-strategy-chip', button => button.dataset.strategy === selectedRepeatStrategy);
    syncPressedButtons('.ttl-chip', button => button.dataset.ttl === selectedExpiryMode);
    for (const selector of ['#weekdayRow', '#repeatStrategyRow', '#repeatIntervalRow']) {
      const row = $(selector);
      if (row) row.classList.add('hidden');
    }
    renderExpiryPreview();
  }

  // 选了“每周”才露星期，选了重复才露推进方式与间隔：没选重复的人不应该看到
  // 三行与自己无关的选项。
  function onRepeatChip(chip) {
    selectedRepeat = chip.dataset.repeat;
    syncPressedButtons('.repeat-chip', button => button === chip);
    const rows = [
      ['#weekdayRow', selectedRepeat !== 'weekly'],
      ['#repeatStrategyRow', selectedRepeat === 'none'],
      ['#repeatIntervalRow', selectedRepeat === 'none']
    ];
    for (const [selector, hidden] of rows) {
      const row = $(selector);
      if (row) row.classList.toggle('hidden', hidden);
    }
    if (selectedRepeat !== 'weekly') {
      selectedWeekdays = [];
      syncPressedButtons('.weekday-chip', () => false);
    }
    showStatus('');
  }

  // 星期是多选：“每周一三五”是一条规则，不是三条。
  function onWeekdayChip(chip) {
    const day = Number(chip.dataset.weekday);
    selectedWeekdays = selectedWeekdays.includes(day)
      ? selectedWeekdays.filter(item => item !== day)
      : [...selectedWeekdays, day];
    syncPressedButtons('.weekday-chip', button => selectedWeekdays.includes(Number(button.dataset.weekday)));
    showStatus('');
  }

  function onScheduledChange(input) {
    const scheduledFor = scheduledFromDateTimeInput(input.value);
    if (input.value && !scheduledFor) {
      selectedScheduledFor = null;
      input.setAttribute('aria-invalid', 'true');
      showStatus('可开始时间无效，当前输入不会保存。');
      return;
    }
    setScheduledFor(scheduledFor);
    showStatus('');
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    for (const chip of $$('.when-chip')) {
      listen(chip, 'click', () => {
        applyWhen(chip.dataset.when);
        showStatus('');
      });
    }
    for (const chip of $$('.repeat-chip')) listen(chip, 'click', () => onRepeatChip(chip));
    for (const chip of $$('.weekday-chip')) listen(chip, 'click', () => onWeekdayChip(chip));
    for (const chip of $$('.repeat-strategy-chip')) {
      listen(chip, 'click', () => {
        selectedRepeatStrategy = chip.dataset.strategy;
        syncPressedButtons('.repeat-strategy-chip', button => button === chip);
      });
    }
    // 自动失效的快捷选项只对这一件事生效，不改设置里的默认区间。
    for (const chip of $$('.ttl-chip')) {
      listen(chip, 'click', () => {
        selectedExpiryMode = chip.dataset.ttl;
        syncPressedButtons('.ttl-chip', button => button === chip);
        renderExpiryPreview();
      });
    }

    const plannedInput = $('#plannedForInput');
    listen(plannedInput, 'change', () => {
      selectedPlannedFor = plannedInput.value || null;
      syncWhenFromPlannedFor();
      showStatus('');
    });
    listen($('#clearPlannedFor'), 'click', () => {
      selectedPlannedFor = null;
      if (plannedInput) plannedInput.value = '';
      syncWhenFromPlannedFor();
    });

    const scheduledInput = $('#scheduledForInput');
    listen(scheduledInput, 'change', () => onScheduledChange(scheduledInput));
    listen($('#clearScheduledFor'), 'click', () => setScheduledFor(null));

    const deadlineInput = $('#deadlineInput');
    // 已经过去的截止不是提醒，是一条开局就红着的行：让日历自己拒绝这种选择。
    if (deadlineInput) deadlineInput.min = localDateInputValue();
    listen(deadlineInput, 'change', () => {
      setDeadline(endOfLocalDateISO(deadlineInput.value));
      showStatus('');
    });
    listen($('#clearDeadline'), 'click', () => setDeadline(null));
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    while (teardown.length) teardown.pop()();
  }

  return Object.freeze({
    mount,
    dispose,
    reset,
    values,
    validate,
    applyWhen,
    renderExpiryPreview
  });
}


export { createPopoverTaskWhenFields };
