import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';

const PHASES = Object.freeze({
  attempt: '请求尝试', output: '服务商返回原文', repaired: '格式修复候选',
  validated: '已通过结构校验', rejected: '校验未通过', transport: '连接结果',
  gate: '应用前检查', application: '最终应用结果', energy: '能量记录与实际贡献'
});

const TASKS = Object.freeze({
  'capture-triage': '随手记分拣', 'impulse-energy': '能量判断', breakdown: '任务拆解',
  enrich: '任务补全', unstick: '卡点建议'
});

// Ephemeral presentation only. The main-process test gate and recorder own
// capture, bounds, expiry and metadata-only export (ARCHITECTURE「AI 与 LLM」).
function createAiDiagnostics({ document, $, surfaceClient, isVisible = () => true,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  let mounted = false, lifetime = 0, generation = 0, refreshId = 0, detailId = 0;
  let timer = null, expiryTimer = null, expiryDeadline = null;
  let state = null, busy = false, selected = '', record = null;
  let records = [], feedback = '', listKey = '', detailKey = '';
  const releases = [];
  const node = suffix => $(`#aiDiagnostics${suffix}`);
  const visible = () => mounted && isVisible() && node('Group')?.open === true
    && $('#settingGroupAi')?.open === true && document.hidden !== true;
  const listen = (target, event, fn) => {
    if (!target) return;
    target.addEventListener(event, fn);
    releases.push(() => target.removeEventListener(event, fn));
  };
  const element = (tag, className, text = '') => {
    const item = document.createElement(tag);
    item.className = className;
    item.textContent = text;
    return item;
  };
  function clearContent() {
    detailId++;
    selected = ''; record = null; records = []; listKey = ''; detailKey = '';
    node('Runs').replaceChildren(); node('Runs').value = '';
    node('Detail').replaceChildren();
    node('ExportText').value = '';
    node('ExportPanel').hidden = true;
  }
  function invalidate() {
    generation++; refreshId++;
    clearTimer(timer); timer = null;
    clearContent();
  }
  function cancelExpiry() {
    clearTimer(expiryTimer); expiryTimer = null; expiryDeadline = null;
  }
  function expireLocally() {
    cancelExpiry(); invalidate();
    if (state) state = { ...state, active: false, count: 0, expiresAt: null };
    renderStatus();
  }
  function scheduleExpiry() {
    if (!state?.active) { cancelExpiry(); return true; }
    let remaining;
    try { remaining = state.expiresAt - now(); } catch (_) { remaining = NaN; }
    if (!Number.isFinite(state.expiresAt) || !Number.isFinite(remaining) || remaining <= 0) {
      expireLocally(); return false;
    }
    if (expiryTimer !== null && expiryDeadline === state.expiresAt) return true;
    cancelExpiry(); expiryDeadline = state.expiresAt;
    const deadline = expiryDeadline;
    // Separate from polling: a hung IPC cannot retain displayed private text.
    expiryTimer = setTimer(() => {
      if (mounted && state?.active && state.expiresAt === deadline) expireLocally();
    }, remaining);
    return true;
  }
  function controls() {
    const available = state?.available === true;
    node('Start').hidden = state?.active === true;
    node('Stop').hidden = state?.active !== true;
    node('Risk').hidden = state?.active === true;
    node('Start').disabled = busy || !available || state.active;
    node('Stop').disabled = busy || !available || !state.active;
    node('Clear').disabled = busy || !available || !state.count;
    node('Export').disabled = busy || !available || !state.count;
    node('Refresh').disabled = busy;
    node('Runs').disabled = busy || !records.length;
    node('Feedback').textContent = t(feedback);
  }
  function renderStatus() {
    const active = state?.active === true;
    node('Indicator').textContent = active ? t('记录中') : '';
    node('Status').hidden = !active;
    node('Status').textContent = active
      ? t('记录中 · {count} 次 · {time} 到期并清除', {
        count: state.count,
        time: new Date(state.expiresAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
      })
      : t('未开启记录');
    node('Empty').textContent = active ? t('尚无记录。开启后发生的上述请求会显示在这里。') : t('开始记录后，上述范围内的新请求才会出现在这里。');
    node('Empty').hidden = records.length > 0;
    controls();
  }
  function accept(response) {
    if (response?.reason === 'diagnostics-unavailable') {
      invalidate(); cancelExpiry(); state = null; node('Group').hidden = true; return false;
    }
    if (response?.ok !== true || typeof response.available !== 'boolean') return false;
    if (!response.available) {
      invalidate(); cancelExpiry(); state = response; node('Group').hidden = true;
      return false;
    }
    if (!Number.isSafeInteger(response.epoch) || response.epoch < (state?.epoch ?? -1)) return false;
    if (state && response.epoch !== state.epoch) clearContent();
    state = response;
    node('Group').hidden = false;
    if (!scheduleExpiry()) return false;
    renderStatus();
    return true;
  }
  function renderList() {
    const key = `${getLocale()}|${JSON.stringify(records)}`;
    if (key !== listKey) {
      listKey = key;
      const options = [element('option', '', t('选择一次请求'))];
      options[0].value = '';
      for (const item of records) {
        const label = t('{time} · {task}', {
          task: t(TASKS[item.task] || '请求'),
          time: new Date(item.startedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
        });
        const option = element('option', '', label);
        option.value = item.id;
        options.push(option);
      }
      node('Runs').replaceChildren(...options);
    }
    if (!records.some(item => item.id === selected)) {
      selected = ''; record = null; detailKey = ''; detailId++;
      node('Detail').replaceChildren();
    }
    node('Runs').value = selected;
    renderStatus();
  }
  function disclosureSummary() {
    const summary = element('summary', '');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ class: 'disclosure-icon', viewBox: '0 0 16 16',
      'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' })) svg.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 4 4 4-4 4'); path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(path); summary.append(svg, element('span', '', t('校验与应用详情')));
    return summary;
  }
  function renderDetail() {
    const container = node('Detail');
    const key = record ? `${getLocale()}|${JSON.stringify(record)}` : '';
    if (key && key === detailKey) return;
    const expanded = container.querySelector?.('details')?.open === true;
    detailKey = key; container.replaceChildren();
    if (!record) return;
    if (record.contentRemoved) container.append(element('p', 'ai-diagnostics-note', t('来源已变化，原文记录已清除')));
    if (record.redacted) container.append(element('p', 'ai-diagnostics-meta', t('已遮罩可识别凭据')));
    const inspection = element('details', 'disclosure ai-diagnostics-inspection');
    inspection.open = expanded; inspection.append(disclosureSummary());
    inspection.append(element('pre', 'ai-diagnostics-data', JSON.stringify({
      id: record.id, task: record.task, startedAt: record.startedAt,
      endedAt: record.endedAt, state: record.state, outcome: record.outcome
    }, null, 2)));
    for (const event of record.events || []) {
      const block = element('section', 'ai-diagnostics-event');
      block.append(element('h4', '', t(PHASES[event.phase] || '记录阶段')));
      if (event.phase !== 'output') block.append(element('p', 'ai-diagnostics-meta', `${event.phase} · ${event.at}`));
      const content = event.phase === 'output' && typeof event.data?.text === 'string'
        ? event.data.text : JSON.stringify(event.data, null, 2);
      block.append(element('pre', 'ai-diagnostics-data', content ?? ''));
      if (event.data?.code === 'proposal-command-succeeded') block.append(element('p', 'ai-diagnostics-note', t('提案命令已完成，实际变化未记录')));
      if (event.data?.code === 'energy-signal-recorded') block.append(element('p', 'ai-diagnostics-note', t('当时已记录能量信号')));
      if (event.phase === 'energy' && event.data?.effectiveContribution == null) {
        block.append(element('p', 'ai-diagnostics-note', t('未记录实际贡献')));
      }
      (event.phase === 'output' ? container : inspection).append(block);
    }
    if (record.truncated) container.append(element('p', 'ai-diagnostics-note', t('记录已截断，部分内容未保留。')));
    container.append(inspection);
  }
  async function readDetail() {
    if (!visible() || !selected || busy) return;
    const ticket = { id: ++detailId, generation, epoch: state?.epoch, selected };
    try {
      const response = await surfaceClient.diagnosticsDetail({ id: selected });
      if (!visible() || ticket.id !== detailId || ticket.generation !== generation || ticket.selected !== selected) return;
      if (response?.ok !== true || response.record?.id !== ticket.selected) {
        record = null; detailKey = ''; node('Detail').replaceChildren();
        if (response?.reason === 'diagnostics-unavailable') accept(response);
        else { feedback = '这次请求的记录已不可用。'; controls(); }
        return;
      }
      if (response.epoch !== ticket.epoch || response.epoch !== state?.epoch) {
        record = null; detailKey = ''; node('Detail').replaceChildren();
        if (response.epoch > (state?.epoch ?? -1)) accept(response);
        return;
      }
      const latest = await surfaceClient.diagnosticsStatus();
      if (!visible() || ticket.id !== detailId || ticket.generation !== generation || ticket.selected !== selected) return;
      if (!accept(latest) || latest.active !== true || latest.epoch !== ticket.epoch) {
        record = null; detailKey = ''; node('Detail').replaceChildren(); return;
      }
      record = response.record;
      renderDetail();
    } catch (_) {
      if (ticket.id === detailId && ticket.generation === generation && visible()) {
        record = null; detailKey = ''; node('Detail').replaceChildren();
        feedback = '暂时无法读取诊断记录。'; controls();
      }
    }
  }
  async function refresh() {
    if (!mounted || busy) return;
    const ticket = { id: ++refreshId, generation, lifetime };
    const owns = () => mounted && ticket.id === refreshId && ticket.generation === generation && ticket.lifetime === lifetime;
    clearTimer(timer); timer = null;
    try {
      const response = await surfaceClient.diagnosticsStatus();
      if (!owns() || !accept(response) || !visible()) return;
      const listed = await surfaceClient.diagnosticsList();
      if (!owns() || !visible() || !accept(listed)) return;
      records = Array.isArray(listed.records) ? listed.records : [];
      renderList();
      await readDetail();
    } catch (_) {
      if (owns() && visible()) { feedback = '暂时无法读取诊断记录。'; controls(); }
    } finally {
      if (owns() && visible() && state?.available) timer = setTimer(refresh, 1000);
    }
  }
  async function command(action) {
    if (!mounted || busy || !state?.available || !visible()) return;
    if (action === 'Start' && state.active || action === 'Stop' && !state.active) return;
    if (['Clear', 'Export'].includes(action) && !state.count) return;
    const ticket = { lifetime, generation: generation + 1, epoch: state.epoch };
    invalidate(); busy = true; feedback = ''; controls();
    const owns = () => mounted && lifetime === ticket.lifetime && generation === ticket.generation;
    try {
      const response = await surfaceClient[`diagnostics${action}`]();
      if (!owns() || !visible()) return;
      if (action === 'Export') {
        const latest = await surfaceClient.diagnosticsStatus();
        if (!owns() || !visible() || !accept(latest) || latest.epoch !== ticket.epoch) return;
        if (response?.ok !== true || typeof response.text !== 'string') throw new Error('diagnostic-export-unavailable');
        node('ExportText').value = response.text;
        node('ExportPanel').hidden = false;
        node('ExportText').focus(); node('ExportText').select();
      } else if (!accept(response)) {
        if (response?.reason !== 'diagnostics-unavailable') feedback = '操作结果暂未确认，可刷新核对。';
      } else feedback = action === 'Stop' ? '记录已停止并清除。' : action === 'Clear' ? '记录已清除，当前记录时段继续。' : '';
    } catch (_) {
      if (owns() && visible()) feedback = '操作结果暂未确认，可刷新核对。';
    } finally {
      if (mounted && lifetime === ticket.lifetime) {
        busy = false; controls();
        if (visible()) void refresh();
      }
    }
  }
  function dismiss() {
    if (!mounted) return;
    invalidate(); cancelExpiry(); feedback = ''; node('Group').open = false;
    controls();
  }
  function mount() {
    if (mounted || !node('Group') || typeof surfaceClient.diagnosticsStatus !== 'function') return;
    mounted = true; lifetime++; node('Group').hidden = true;
    clearContent(); controls();
    listen(node('Group'), 'toggle', () => { if (node('Group').open) void refresh(); else dismiss(); });
    listen($('#settingGroupAi'), 'toggle', () => { if (!$('#settingGroupAi').open) dismiss(); });
    listen(document, 'visibilitychange', () => { if (document.hidden) dismiss(); });
    listen(node('Runs'), 'change', () => {
      selected = node('Runs').value; record = null; detailKey = ''; detailId++; feedback = '';
      node('Detail').replaceChildren(); controls(); void readDetail();
    });
    listen(node('Refresh'), 'click', () => { feedback = ''; void refresh(); });
    for (const action of ['Start', 'Stop', 'Clear', 'Export']) listen(node(action), 'click', () => { void command(action); });
    const hidden = surfaceClient.onPopoverHidden?.(dismiss);
    if (typeof hidden === 'function') releases.push(hidden);
    releases.push(onLocaleChanged(() => { renderStatus(); renderList(); renderDetail(); }));
    void refresh();
  }
  function dispose() {
    if (!mounted) return;
    dismiss(); mounted = false; lifetime++; busy = false; state = null;
    while (releases.length) releases.pop()();
  }
  return Object.freeze({ mount, dispose, refresh, dismiss });
}
export { createAiDiagnostics };
