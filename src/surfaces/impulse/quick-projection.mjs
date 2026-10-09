// Complete replacement validation is deliberately surface-local. Never accept
// broad popover/canonical objects or infer missing command identities here.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const text = value => typeof value === 'string' && value.length <= 240;
const nullableText = value => value === null || text(value);
const number = value => Number.isFinite(value) && value >= 0;
function resumeAction(value) {
  return value === null || exact(value, ['sessionId', 'intent', 'enabled', 'reason'])
    && text(value.sessionId) && ['resume', 'confirm-completion'].includes(value.intent)
    && typeof value.enabled === 'boolean' && nullableText(value.reason);
}
function startAction(value) {
  return exact(value, ['taskId', 'intent', 'enabled', 'reason', 'taskVersion'])
    && text(value.taskId) && ['start', 'clarify-and-start'].includes(value.intent)
    && typeof value.enabled === 'boolean' && nullableText(value.reason)
    && (value.taskVersion === null || /^[a-f0-9]{64}$/.test(value.taskVersion));
}
function task(value) {
  return value === null || exact(value, ['id', 'title', 'seriesId'])
    && text(value.id) && text(value.title) && nullableText(value.seriesId);
}
function valid(value) {
  if (!object(value)) return false;
  if (value.mode === 'fallback') return exact(value, ['mode']);
  if (!Number.isInteger(value.chosenMinutes) || value.chosenMinutes < 1 || value.chosenMinutes > 120) return false;
  if (value.mode === 'idle') return exact(value, ['mode', 'candidates', 'chosenMinutes'])
    && Array.isArray(value.candidates) && value.candidates.length <= 3
    && value.candidates.every(item => exact(item, ['id', 'title', 'role', 'reason', 'quickStartAction', 'minutes'])
      && ['id', 'title', 'role', 'reason'].every(key => text(item[key]))
      && startAction(item.quickStartAction) && item.quickStartAction.taskId === item.id
      && (item.minutes === null || Number.isInteger(item.minutes)));
  if (value.mode !== 'active' || !exact(value, ['mode', 'session', 'task', 'taskActionable', 'steps', 'chosenMinutes'])) return false;
  const session = value.session;
  return exact(session, ['sessionId', 'taskId', 'kind', 'awaitingOfflineConfirmation', 'recoveryReason',
    'resumeAction', 'running', 'paused', 'elapsedMs', 'remainingMs'])
    && nullableText(session.sessionId) && nullableText(session.taskId)
    && ['focus', 'quick-start', 'break'].includes(session.kind)
    && ['awaitingOfflineConfirmation', 'running', 'paused'].every(key => typeof session[key] === 'boolean')
    && nullableText(session.recoveryReason) && resumeAction(session.resumeAction)
    && number(session.elapsedMs) && number(session.remainingMs) && task(value.task)
    && typeof value.taskActionable === 'boolean' && Array.isArray(value.steps) && value.steps.length <= 100
    && value.steps.every(step => exact(step, ['id', 'title']) && text(step.id) && text(step.title));
}
function freezeCopy(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Array.isArray(value) ? value.map(freezeCopy)
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeCopy(entry)])));
}
function completeQuickProjection(message) {
  if (!Number.isSafeInteger(message?.revision) || message.revision < 0
      || !exact(message.delta, ['quickPanel']) || !valid(message.delta.quickPanel)) return null;
  return freezeCopy(message.delta.quickPanel);
}
export { completeQuickProjection };
