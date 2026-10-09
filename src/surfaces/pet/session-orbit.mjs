import { t, onLocaleChanged } from '../shared/interface/i18n.mjs';
'use strict';
import { orbitPointAtProgress } from './session-orbit-geometry.mjs';

const PHASES = Object.freeze({
  focus: { label: '专注中', icon: 'M8 2v3M8 11v3M2 8h3M11 8h3M5 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0' },
  break: { label: '休息中', icon: 'M12.8 10A5.5 5.5 0 0 1 6 3.2 5.5 5.5 0 1 0 12.8 10Z' },
  paused: { label: '已暂停', icon: 'M5 3v10M11 3v10' },
  confirm: { label: '本轮待确认', icon: 'M8 2a6 6 0 1 0 0 12 6 6 0 1 0 0-12M5 8l2 2 4-4' },
  'task-completed': { label: '关联任务已完成', icon: 'M3 8l3 3 7-7M3 14h10' },
  attention: { label: '会话需要处理', icon: 'M8 2 1.5 13h13L8 2ZM8 6v3M8 11h.01' },
  complete: { label: '本轮已结束，落点待处理', icon: 'M3 8l3 3 7-7' }
});
const BOUNDS = Object.freeze({ left: 50, top: 151.5, width: 120, height: 26 });
const clamp = (value, max) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

// Only this surface's existing frame loop calls render. No RAF, interval, IPC
// command, state mutation or inferred completion belongs to a status display.
function createSessionOrbit({ document, now, isCalm, isHidden = () => document.hidden,
  openPanel } = {}) {
  const stage = document.getElementById('stage');
  const track = document.getElementById('sessionOrbit');
  const arc = document.getElementById('sessionOrbitArc');
  const star = document.getElementById('sessionOrbitStar');
  const button = document.getElementById('sessionStatus');
  const icon = document.getElementById('sessionStatusIcon');
  let displayedSeconds = null;
  let anchor = null, owned = false, disposed = false, visible = null, previousRender = '';
  const elapsed = at => anchor ? clamp(anchor.elapsedMs + (anchor.running ? Math.max(0, at - anchor.receivedAt) : 0), anchor.plannedMs) : 0;
  function hide() {
    if (visible === false) return;
    visible = false;
    track.classList.remove('show');
    button.classList.remove('show');
    button.setAttribute('aria-hidden', 'true');
    button.setAttribute('tabindex', '-1');
  }
  function labelFor(seconds) {
    const summary = t(PHASES[anchor.phase].label);
    return anchor.plannedMs > 0
      ? t('{summary}，剩余 {time}，打开面板', { summary, time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` })
      : t('{summary}，打开面板', { summary });
  }
  function repaintCopy() {
    if (disposed || !anchor || displayedSeconds === null) return;
    const label = labelFor(displayedSeconds);
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
  function render() {
    if (disposed) return;
    if (!anchor || isHidden()) { hide(); previousRender = ''; return; }
    const spent = elapsed(now());
    const progress = anchor.plannedMs > 0 ? spent / anchor.plannedMs : 1;
    const fraction = isCalm() && anchor.running && progress < 1
      ? Math.floor(spent / 30000) * 30000 / anchor.plannedMs : progress;
    // Subpixel quantization avoids rewriting SVG attributes on identical frames.
    const position = Math.round(fraction * 10000) / 10000;
    const remaining = Math.max(0, Math.ceil((anchor.plannedMs - spent) / 1000));
    const seconds = isCalm() && anchor.running ? Math.ceil(remaining / 30) * 30 : remaining;
    displayedSeconds = seconds;
    const label = labelFor(seconds);
    const key = `${anchor.phase}:${position}:${label}`;
    if (key === previousRender) return;
    previousRender = key;
    const point = orbitPointAtProgress(position);
    arc.setAttribute('stroke-dashoffset', String(100 * (1 - position)));
    star.setAttribute('transform', `translate(${point.x} ${point.y})`);
    visible = true;
    track.classList.add('show');
    button.classList.add('show');
    button.setAttribute('aria-hidden', 'false');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
  function sync(value) {
    if (disposed) return;
    owned = true;
    stage.dataset.sessionDisplay = 'canonical';
    if (!value || !Object.hasOwn(PHASES, value.phase)
      || !Number.isFinite(value.plannedMs) || value.plannedMs < 0
      || (value.phase !== 'complete' && value.plannedMs <= 0)) {
      anchor = null; displayedSeconds = null; previousRender = '';
      delete stage.dataset.sessionPhase;
      button.removeAttribute('aria-label'); button.removeAttribute('title');
      icon.removeAttribute('d'); arc.setAttribute('stroke-dashoffset', '100');
      star.removeAttribute('transform'); hide(); return;
    }
    const at = now();
    const running = value.running === true && ['focus', 'break'].includes(value.phase);
    const sameTiming = anchor && running && anchor.phase === value.phase
      && anchor.kind === value.kind && anchor.mode === value.mode && anchor.sessionId === value.sessionId
      && anchor.plannedMs === value.plannedMs && anchor.running === running
      && Math.abs(elapsed(at) - value.elapsedMs) < 2000;
    anchor = { ...value, running,
      elapsedMs: sameTiming ? anchor.elapsedMs : clamp(value.elapsedMs, value.plannedMs),
      receivedAt: sameTiming ? anchor.receivedAt : at };
    stage.dataset.sessionPhase = value.phase;
    icon.setAttribute('d', PHASES[value.phase].icon);
    previousRender = '';
    render();
  }
  function click(event) {
    event.stopPropagation();
    if (disposed || !anchor || isHidden()) return;
    try { Promise.resolve(openPanel()).catch(() => {}); } catch (_) { /* panel failure is display-only */ }
  }
  const stopLocale = onLocaleChanged(repaintCopy);
  button.addEventListener('click', click);
  hide();
  return Object.freeze({ sync, render, ownsDisplay: () => owned,
    dispose() {
      if (disposed) return;
      sync(null); disposed = true; stopLocale();
      button.removeEventListener('click', click);
    } });
}
export { createSessionOrbit, PHASES, BOUNDS as SESSION_ORBIT_BOUNDS };
