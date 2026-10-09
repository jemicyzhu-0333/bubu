'use strict';

const { createSittingClock } = require('../domain/sitting-clock');

const DEFAULT_MESSAGES = Object.freeze([
  '💧 喝口水，你已经坐了一会儿了',
  '🧍 起来走两步，伸个懒腰',
  '👀 看看窗外 20 秒'
]);

function createSittingReminder({
  sittingClock = createSittingClock(),
  now,
  idleSeconds,
  isSessionRunning,
  isWorkTime,
  getSettings,
  random = () => 0,
  remind,
  messages = DEFAULT_MESSAGES
} = {}) {
  if (!sittingClock || typeof sittingClock.sample !== 'function'
      || typeof sittingClock.restart !== 'function' || typeof sittingClock.noteRested !== 'function') {
    throw new TypeError('sitting reminder requires a sitting clock');
  }
  for (const [name, value] of Object.entries({ now, idleSeconds, isSessionRunning, isWorkTime, getSettings, remind })) {
    if (typeof value !== 'function') throw new TypeError(`sitting reminder requires ${name}`);
  }
  if (typeof random !== 'function' || !Array.isArray(messages) || messages.length === 0) {
    throw new TypeError('sitting reminder requires a random source and messages');
  }

  function sample() {
    const at = now();
    let idle;
    try {
      idle = idleSeconds();
    } catch (error) {
      sittingClock.noteRested();
      throw error;
    }
    const sitting = sittingClock.sample({ now: at, idleSeconds: idle });
    if (sitting.rested || isSessionRunning() || !isWorkTime() || !sitting.atKeyboard) {
      return { triggered: false, ...sitting };
    }
    const settings = getSettings();
    const thresholdMs = Math.max(1, Number(settings && settings.hydrationEvery) || 0) * 60 * 1000;
    if (sitting.sittingMs < thresholdMs) return { triggered: false, ...sitting };

    sittingClock.restart(at);
    const roll = Number(random());
    const safeRoll = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999, roll)) : 0;
    const index = Math.max(0, Math.min(messages.length - 1, Math.floor(safeRoll * messages.length)));
    const message = messages[index];
    remind({
      type: 'rest',
      message,
      maxLevel: settings.dnd ? 1 : 2,
      character: settings.nudgeCharacter,
      whitelist: settings.nudgeWhitelist,
      themePrimary: settings.themePrimary,
      motionMode: settings.motionMode,
      stimulationMode: settings.stimulationMode,
      soundEnabled: settings.soundEnabled
    });
    return { triggered: true, message, ...sitting };
  }

  return Object.freeze({
    sample,
    noteRested: () => sittingClock.noteRested(),
    sittingClock
  });
}

module.exports = { DEFAULT_MESSAGES, createSittingReminder };
