// One calculation for both the disabled boundary and the submitted preference.
function settingsStepperPatch(key, delta, settings, sessionDuration) {
  const start = settings.workStartHour ?? 10, end = settings.workEndHour ?? 21;
  const fields = {
    break: ['breakMinutes', 1, 30], softReminder: ['softReminderEvery', 5, 60],
    hydration: ['hydrationEvery', 15, 180], focusMaxLevel: ['focusMaxLevel', 1, 4, 2],
    restMaxLevel: ['restMaxLevel', 1, 4, 4], workStart: ['workStartHour', 0, end - 1, 10],
    workEnd: ['workEndHour', start + 1, 24, 21]
  };
  if (key === 'pomodoro') return { pomodoroMinutes: sessionDuration.clampFocusMinutes(settings.pomodoroMinutes + delta) };
  const field = fields[key];
  if (!field) return {};
  const [name, min, max, fallback] = field;
  return { [name]: Math.max(min, Math.min(max, (settings[name] ?? fallback) + delta)) };
}
export { settingsStepperPatch };
