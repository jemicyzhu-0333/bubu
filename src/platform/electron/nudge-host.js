'use strict';
const { nativeCopy } = require('./interface-copy');

const { exec: execCommand, execFile: execFileCommand } = require('child_process');
const { probeForegroundApp } = require('./nudge-foreground');
const { createNudgeDeferrals } = require('./nudge-deferrals');
const { createNudgeReceipt } = require('./nudge-receipt');
const { nudgePolicy } = require('../../capabilities/attention');
const { CHARACTERS, reminderLines } = require('../../content/nudge-characters');
const { createNotificationHost } = require('./notifications');
const { resolveFocusDisplay } = require('./focus-display');
const {
  cornerLayout,
  convergencePositions,
  createNudgeCornerWindow,
  createNudgeFullscreenWindow
} = require('./windows/nudge-window');

// A chord rather than a click, because the corner reminder never takes focus on
// its own. It is advertised in the reminder itself so the way in is discoverable.
const CORNER_KEYBOARD_ACCELERATOR = 'Alt+Shift+N';
const CORNER_KEYBOARD_LABEL = '⌥⇧N';
// Long enough that the characters are noticed where they arrived before they move.
const CONVERGENCE_DELAY_MS = 3000;
// A system notification carries at most two buttons, so a third action would be
// silently dropped by the OS rather than by us.
const MAX_L1_ACTIONS = 2;

/**
 * Does the user's OS ask for less animation?
 *
 * Two probes because the signal moved: older Electron answers on nativeTheme,
 * Electron 44 answers through systemPreferences. Either one saying yes is
 * enough, and an OS that cannot answer is read as "no preference" rather than
 * being allowed to throw into a reminder.
 */
function systemPrefersReducedMotion({
  theme = require('electron').nativeTheme,
  preferences = require('electron').systemPreferences
} = {}) {
  try {
    if (theme && theme.shouldUseReducedMotion === true) return true;
  } catch (_) {}
  try {
    if (preferences && typeof preferences.getAnimationSettings === 'function') {
      return preferences.getAnimationSettings().prefersReducedMotion === true;
    }
  } catch (_) {}
  return false;
}

/**
 * Owns every visible reminder surface: the system notification, the corner
 * characters, the covering card, their escalation timers and the deferrals they
 * schedule. The rules about what a reminder may say and when it may escalate
 * live in the attention capability; this host only carries them out against the
 * OS, so the reminder can be reasoned about — and tested — without Electron.
 */
function createNudgeHost({
  BrowserWindow = require('electron').BrowserWindow,
  Notification = require('electron').Notification,
  // Left undefined rather than null so the probe below can fall back to the
  // real Electron accessors; a test passes both in and never touches Electron.
  nativeTheme,
  systemPreferences,
  screenHost,
  shortcutHost,
  preloadPath,
  cornerPagePath,
  fullscreenPagePath,
  presentCompanion = null,
  exec = execCommand,
  execFile = execFileCommand,
  appPath, resourcesPath, isPackaged, exists,
  platform = process.platform,
  resolveRoutineRequest = () => null,
  random = Math.random,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onDeliveryError = () => {}
} = {}) {
  if (!screenHost || typeof screenHost.primaryDisplay !== 'function') {
    throw new TypeError('nudge host requires a screen host');
  }
  if (!shortcutHost || typeof shortcutHost.claim !== 'function') {
    throw new TypeError('nudge host requires a shortcut host that can claim a chord');
  }
  for (const [name, value] of [
    ['preloadPath', preloadPath],
    ['cornerPagePath', cornerPagePath],
    ['fullscreenPagePath', fullscreenPagePath]
  ]) {
    if (typeof value !== 'string' || !value) throw new TypeError(`nudge host requires ${name}`);
  }
  if (typeof onDeliveryError !== 'function') throw new TypeError('onDeliveryError must be a function');
  if (presentCompanion !== null && typeof presentCompanion !== 'function') throw new TypeError('presentCompanion must be a function');

  let corners = [];
  let fullscreen = null;
  let currentLevel = 0;
  let state = null;
  let dnd = false;
  let sequenceGeneration = 0;
  let nextInstanceId = 1;
  let disposed = false;
  const lifetime = new AbortController();
  let actionHandler = null;
  let releaseCornerChord = null;

  // A reminder keeps its own notification tracker: closing every reminder must
  // never close an unrelated notification the app raised for something else.
  const notifications = createNotificationHost({
    Notification,
    isSuppressed: () => dnd && state?.type !== 'routine',
    // Each reminder decides its own sound from the user's setting and passes it
    // explicitly, so this host must not veto it a second time.
    isSoundEnabled: () => true,
    onError: error => report(error, { channel: 'nudge:notification' })
  });

  function probeReducedMotion() {
    return systemPrefersReducedMotion({ theme: nativeTheme, preferences: systemPreferences });
  }

  function reducesMotion(motionMode) {
    return nudgePolicy.shouldReduceNudgeMotion(motionMode, probeReducedMotion());
  }

  function report(error, context) {
    try { onDeliveryError(error, context); } catch (_) {}
  }

  function canonicalRoutine(identity) {
    if (!identity || typeof identity.routineId !== 'string' || !identity.routineId
        || typeof identity.occurrenceId !== 'string' || !identity.occurrenceId) return null;
    try {
      const resolved = resolveRoutineRequest({ routineId: identity.routineId, occurrenceId: identity.occurrenceId });
      if (!resolved || resolved.type !== 'routine' || resolved.context?.routineId !== identity.routineId
          || resolved.context?.occurrenceId !== identity.occurrenceId) return null;
      return quietRequest(nudgePolicy.normalizeReminderRequest(resolved));
    } catch (error) { report(error, { channel: 'nudge:routine-resolve' }); return null; }
  }

  function quietRequest(request) {
    return dnd && request.type === 'routine'
      ? { ...request, maxLevel: 1, soundEnabled: false, whitelist: [] }
      : request;
  }

  function signature(request) {
    return JSON.stringify(nudgePolicy.normalizeReminderRequest(request));
  }

  const deferrals = createNudgeDeferrals({
    setTimer, clearTimer, resolveRoutineRequest: canonicalRoutine,
    start: startNudgeSequence, report
  });

  function isFresh(live = state) {
    if (!live || live !== state || disposed) return false;
    if (live.deferralOwner && !deferrals.owns(live.deferralOwner)) return false;
    if (live.type !== 'routine' || live.preview) return !dnd;
    const fresh = canonicalRoutine(live.context);
    return Boolean(fresh && signature(fresh) === live.signature);
  }

  function requireFresh(live = state) {
    if (isFresh(live)) return true;
    if (live && state === live) resetVisibleNudge({ reason: 'routine-stale' });
    return false;
  }

  function newReceipt(live) {
    const receipt = createNudgeReceipt({
      setTimer, clearTimer,
      accept: value => {
        const fresh = isFresh(live);
        if (state !== live || live.receipt !== receipt) return { shown: false, reason: 'superseded' };
        return fresh ? { ...value, generation: live.generation } : { shown: false, reason: 'routine-stale' };
      },
      onFailure: reason => {
        if (state === live && live.receipt === receipt) resetVisibleNudge({ reason });
      }
    });
    return receipt;
  }

  function replaceReceipt(live) {
    const previous = live.receipt;
    const receipt = newReceipt(live);
    // Retire the old witness only after transferring ownership. Its cancellation
    // must release the timeout without tearing down the same instance's retry.
    live.receipt = receipt;
    previous?.settle({ shown: false, reason: 'delivery-replaced' });
    return receipt;
  }

  function foregroundLookup(whitelist, signal) {
    return probeForegroundApp({ platform, exec, execFile, appPath, resourcesPath, isPackaged, exists,
      whitelist, signal, setTimer, clearTimer });
  }

  /**
   * The display the user is actually looking at.
   *
   * Resolved by the shared focus-display helper (ARCHITECTURE「快捷行动面板」) so nudge and the quick
   * panel never drift on "which screen". Reminder windows are deliberately
   * excluded via ownsSender, so a reminder left on a second screen cannot pin
   * the next one there.
   */
  function targetDisplay() {
    return resolveFocusDisplay({ screenHost, ownsSender, BrowserWindow });
  }

  // Strictly "is this one of our reminder windows": an absent sender is not.
  function ownsSender(sender) {
    if (!sender) return false;
    if (fullscreen && fullscreen.ownsSender(sender)) return true;
    return corners.some(corner => corner.ownsSender(sender));
  }

  function focusCornerForKeyboard() {
    const target = corners.find(corner => corner.isAlive());
    if (!target) return false;
    return target.focusForKeyboard();
  }

  function claimCornerChord() {
    if (releaseCornerChord) return true;
    releaseCornerChord = shortcutHost.claim(CORNER_KEYBOARD_ACCELERATOR, focusCornerForKeyboard);
    return releaseCornerChord !== null;
  }

  function releaseCornerChordIfOwned() {
    if (!releaseCornerChord) return;
    const release = releaseCornerChord;
    releaseCornerChord = null;
    release();
  }

  async function revealReadyWindow(api, payload, generation, attempt, level, receipt) {
    const live = state;
    const current = () => state === live && live?.generation === generation && live.attempt === attempt
      && currentLevel === level && api.isAlive() && requireFresh(live);
    if (!current()) return false;
    if (!live.preview) {
      // A slow renderer must not reveal using the timer's older foreground answer.
      // All corners in this level share one fresh, bounded ready-boundary lookup.
      if (!live.readyCheck) {
        const check = approveEscalation(live, level, attempt);
        live.readyCheck = check;
        void check.then(() => { if (live.readyCheck === check) live.readyCheck = null; });
      }
      if (!await live.readyCheck || !current()) return false;
    }
    if (!api.send('nudge:init', payload)) {
      if (current()) receipt?.settle({ shown: false, reason: 'window-init-failed' });
      return false;
    }
    if (!current()) return false;
    let visible = false;
    try {
      if (level === 4) api.showAndFocus();
      else api.showInactive();
      visible = api.isVisible();
    } catch (error) { report(error, { channel: 'nudge:window-reveal' }); }
    if (!current()) { api.close(); return false; }
    receipt?.settle({ shown: visible, level, reason: visible ? undefined : 'window-not-visible' });
    return visible;
  }

  function createCornerWindows(character, message, level, sensory, generation, receipt = null) {
    destroyCornerWindows();
    // A live reminder outranks the snapshot the escalation was scheduled with,
    // so a setting changed during the wait is honoured by the surface it opens.
    const live = state && state.generation === generation ? state : sensory;
    const attempt = live.attempt;
    const lowStimulation = live.stimulationMode === 'low';
    const reducedMotion = reducesMotion(live.motionMode);
    const display = targetDisplay();
    const layout = cornerLayout({ workArea: display.workArea, level, lowStimulation });
    let chordAvailable = false;
    const created = [];

    for (const position of layout.positions) {
      let revealed = false;
      const corner = createNudgeCornerWindow({
        BrowserWindow,
        preloadPath,
        pagePath: cornerPagePath,
        corner: position.corner,
        bounds: { x: position.x, y: position.y, width: layout.width, height: layout.height },
        onDeliveryError: report,
        onReady: api => {
          if (revealed || !state || state.generation !== generation || state.attempt !== attempt || !api.isAlive() || !requireFresh()) return;
          revealed = true;
          void revealReadyWindow(api, {
            character,
            message,
            corner: position.corner,
            level,
            size: layout.width,
            actions: state.actions,
            keyboardShortcut: chordAvailable ? CORNER_KEYBOARD_LABEL : null,
            motionMode: state.motionMode,
            stimulationMode: state.stimulationMode
          }, generation, attempt, level, receipt);
        }
      });
      corners.push(corner);
      created.push(corner);
    }
    // Claimed once the windows exist, so the chord can never reach for a
    // reminder that is not on screen yet. The reveal reads the result later.
    chordAvailable = claimCornerChord();

    if (level === 3 && !lowStimulation && !reducedMotion) {
      const timer = setTimer(() => {
        // Both the OS preference and the user's profile can change during the
        // lead-in, so they are checked again where the movement would begin.
        if (!state || state.generation !== generation || !requireFresh()
            || state.stimulationMode === 'low'
            || reducesMotion(state.motionMode)) return;
        const gathered = convergencePositions({
          workArea: display.workArea,
          width: layout.width,
          height: layout.height,
          count: created.length
        });
        created.forEach((corner, index) => {
          const target = gathered[index];
          if (target) corner.moveTo(target.x, target.y, true);
        });
      }, CONVERGENCE_DELAY_MS);
      if (state && state.generation === generation) state.timers.push(timer);
    }
  }

  function destroyCornerWindows() {
    releaseCornerChordIfOwned();
    corners.forEach(corner => corner.close());
    corners = [];
  }

  function createFullscreenNudge(character, message, actions, generation, receipt = null) {
    closeFullscreenNudge();
    const display = targetDisplay();
    let created = null;
    let revealed = false;
    const attempt = state?.attempt;
    created = createNudgeFullscreenWindow({
      BrowserWindow,
      preloadPath,
      pagePath: fullscreenPagePath,
      workArea: display.workArea,
      onDeliveryError: report,
      onReady: api => {
        if (revealed || !state || state.generation !== generation || fullscreen !== created || !api.isAlive() || !requireFresh()) return;
        revealed = true;
        void revealReadyWindow(api, {
          character,
          message,
          actions,
          actionLabels: actions.map(action => action.label),
          motionMode: state.motionMode,
          stimulationMode: state.stimulationMode
        }, generation, attempt, 4, receipt);
      }
    });
    fullscreen = created;
  }

  function closeFullscreenNudge() {
    if (fullscreen) fullscreen.close();
    fullscreen = null;
  }

  /**
   * The first level: an ordinary system notification.
   *
   * Closing or clicking it is an answer, so it clears the matching sequence too.
   * Without that, an L1-only reminder — one raised while a whitelisted app was
   * in front — would leave a stale priority guard behind and suppress every
   * later routine reminder.
   */
  function showNotification(title, body, generation, silent, actions, receipt, attempt) {
    const offered = (Array.isArray(actions) ? actions : []).slice(0, MAX_L1_ACTIONS);
    const notification = notifications.show({
      title: nativeCopy(title),
      body,
      silent,
      actions: offered.map(action => ({ type: 'button', text: nativeCopy(action.label) })),
      closeButtonText: nativeCopy('关闭')
    }, value => {
      if (!state || state.generation !== generation || state.attempt !== attempt) return;
      receipt.settle({ ...value, level: 1 });
    });
    if (!notification) return null;
    const isCurrent = () => Boolean(state && state.generation === generation && state.attempt === attempt);
    let retryAfterClose = false;
    notification.on('close', () => {
      if (!isCurrent()) return;
      if (retryAfterClose) {
        retryAfterClose = false;
        reofferFailedNativeAction(state);
      } else dismissCurrentNudge('dismiss');
    });
    notification.on('click', () => {
      if (isCurrent()) dismissCurrentNudge('acknowledge');
    });
    notification.on('action', (_event, index) => {
      const action = offered[index];
      if (action && isCurrent()) {
        const result = dismissCurrentNudge(action.id);
        retryAfterClose = !result.handled && isCurrent();
      }
    });
    return notification;
  }

  // Some OSes close a notification after its action even when the command
  // refuses. One explicit failed action earns one fresh retry surface, never an
  // automatic command retry or an unbounded chain of failed notifications.
  function reofferFailedNativeAction(live) {
    if (!requireFresh(live)) return;
    live.attempt += 1;
    live.probe?.abort();
    live.timers.forEach(timer => clearTimer(timer));
    live.timers = [];
    destroyCornerWindows();
    closeFullscreenNudge();
    currentLevel = 1;
    notifications.closeAll();
    replaceReceipt(live);
    showNotification(nudgePolicy.reminderTitle(live.type, { optional: live.limited === 'foreground-whitelist' }), live.message, live.generation,
      !live.soundEnabled, live.actions, live.receipt, live.attempt);
  }

  function resetVisibleNudge({ deferredPolicy = 'none', reason = 'superseded' } = {}) {
    sequenceGeneration += 1;
    const previous = state;
    state = null;
    if (previous) {
      previous.attempt += 1;
      previous.probe?.abort();
      previous.timers.forEach(timer => clearTimer(timer));
      previous.receipt?.settle({ shown: false, reason });
    }
    currentLevel = 0;
    destroyCornerWindows();
    closeFullscreenNudge();
    notifications.closeAll();
    if (deferredPolicy !== 'none') deferrals.cancel(deferredPolicy);
    return sequenceGeneration;
  }

  async function approveEscalation(live, level, attempt) {
    if (!requireFresh(live) || live.attempt !== attempt || live.limited || dnd || currentLevel > level) return false;
    live.probe?.abort();
    const probe = new AbortController();
    live.probe = probe;
    const foreground = await foregroundLookup(live.whitelist, probe.signal);
    if (live.probe !== probe || probe.signal.aborted || !requireFresh(live)
        || live.attempt !== attempt || live.limited || dnd || currentLevel > level) return false;
    if (foreground && !foreground.inWhitelist) return true;
    live.limited = foreground ? 'foreground-whitelist' : 'foreground-unknown';
    live.timers.forEach(timer => clearTimer(timer));
    live.timers = [];
    // Latch this sequence at native L1. Switching back to a safe app does not
    // resurrect old escalation timers; only an explicit new/deferred request can.
    if (currentLevel > 1) reofferFailedNativeAction(live);
    return false;
  }

  function scheduleEscalation(live) {
    if (!requireFresh(live) || live.limited || dnd) return;
    const attempt = live.attempt;
    for (const step of nudgePolicy.escalationStepsFor(live.maxLevel)) {
      live.timers.push(setTimer(async () => {
        if (!requireFresh(live) || live.attempt !== attempt || live.limited || dnd || currentLevel >= step.level) return;
        if (!await approveEscalation(live, step.level, attempt) || !requireFresh(live)
            || live.attempt !== attempt || live.limited || dnd || currentLevel >= step.level) return;
        currentLevel = step.level;
        live.readyCheck = null;
        const receipt = replaceReceipt(live);
        try {
          if (step.level === 4) {
            destroyCornerWindows();
            createFullscreenNudge(live.character, live.message, live.actions, live.generation, receipt);
          } else {
            createCornerWindows(live.character, live.message, step.level, live, live.generation, receipt);
          }
        } catch (error) {
          report(error, { channel: 'nudge:window' });
          receipt.settle({ shown: false, reason: 'window-failed' });
        }
      }, step.delayMs));
    }
  }

  function deliverFirstLevel(live) {
    if (!requireFresh(live)) return;
    currentLevel = 1;
    const receipt = live.receipt;
    const attempt = live.attempt;
    let companionDelivered = false;
    if (!dnd && !live.limited && nudgePolicy.prefersCompanionReminder(live) && presentCompanion) {
      try { companionDelivered = presentCompanion(live.message) === true; }
      catch (error) { report(error, { channel: 'nudge:companion' }); }
    }
    if (!requireFresh(live) || live.attempt !== attempt) return;
    if (companionDelivered) {
      receipt.settle({ shown: true, level: 1, delivery: 'companion' });
    } else {
      showNotification(nudgePolicy.reminderTitle(live.type, { optional: live.limited === 'foreground-whitelist' }),
        live.message, live.generation, !live.soundEnabled, live.actions, receipt, attempt);
    }
    void receipt.promise.then(result => {
      if (result.shown && state === live && live.attempt === attempt) scheduleEscalation(live);
    });
  }

  async function startNudgeSequence(opts, internal = {}) {
    if (disposed) return { shown: false, reason: 'disposed' };
    const normalized = nudgePolicy.normalizeReminderRequest(opts);
    const request = normalized.type === 'routine' ? canonicalRoutine(normalized.context) : normalized;
    if (!request) return { shown: false, reason: 'routine-stale' };
    if (dnd && request.type !== 'routine') return { shown: false, reason: 'dnd' };
    if (internal.deferralOwner && !deferrals.owns(internal.deferralOwner)) return { shown: false, reason: 'deferral-canceled' };
    if (state && state.priority > request.priority) return { shown: false, reason: 'higher-priority-active' };

    const generation = resetVisibleNudge();
    const instanceId = Number.isSafeInteger(internal.instanceId) ? internal.instanceId : nextInstanceId++;
    const message = request.message || nativeCopy(nudgePolicy.chooseLine(reminderLines(request.character, request.type), random()));
    const live = { ...request, message, instanceId, generation, timers: [], attempt: 0,
      signature: signature(request), deferralOwner: internal.deferralOwner || null, probe: new AbortController() };
    state = live;
    // Foreground has its own bounded cancellable lookup; delivery's three seconds
    // start when the OS notification/window is actually requested.
    const attempt = live.attempt;
    if (!dnd) {
      const foreground = await foregroundLookup(request.whitelist, live.probe.signal);
      if (state !== live) return { shown: false, reason: 'superseded' };
      if (live.attempt !== attempt) return finishDelivery(live);
      if (!requireFresh(live)) return { shown: false, reason: 'routine-stale' };
      if (!foreground || foreground.inWhitelist) live.limited = foreground ? 'foreground-whitelist' : 'foreground-unknown';
    } else live.limited = 'dnd';
    replaceReceipt(live);
    deliverFirstLevel(live);
    return finishDelivery(live);
  }

  async function finishDelivery(live) {
    const result = await live.receipt.promise;
    if (result.shown && state === live) live.deferralOwner = null;
    return live.limited && result.shown ? { ...result, limitedToLevel: 1, reason: live.limited } : result;
  }

  // Awaited by callers that clear a reminder before writing state, so the two
  // can never interleave; the policy decides what a missing name means.
  async function clearNudge(options = {}) {
    resetVisibleNudge({
      deferredPolicy: nudgePolicy.resolveDeferredPolicy(options && options.deferredPolicy)
    });
  }

  // The legacy contract this preserves: an absent sender is trusted, because the
  // notification and the main process both dismiss without one.
  function isCurrentNudgeSender(sender) {
    return !sender || ownsSender(sender);
  }

  /**
   * Answer the reminder on screen.
   *
   * The handler runs before anything is torn down and may refuse, so a rejected
   * action leaves the reminder standing rather than dismissing it into a state
   * change that never happened.
   */
  function dismissCurrentNudge(actionId = 'dismiss', sender = null) {
    if (!state) return { handled: false };
    if (!isCurrentNudgeSender(sender)) return { handled: false, reason: 'stale-or-unauthorized-sender' };

    const live = state;
    if (!requireFresh(live)) return { handled: false, reason: 'routine-stale' };
    const plan = nudgePolicy.planDismissal(live, actionId);
    if (!plan.ok) return { handled: false, reason: plan.reason };
    const { snapshot, chosen } = plan;

    if (chosen && actionHandler) {
      let result;
      try {
        result = actionHandler({ ...snapshot, actionId: chosen.id, deferMinutes: chosen.deferMinutes });
      } catch (_) {
        return { handled: false, reason: 'action-failed' };
      }
      if (result && result.ok === false) {
        return { handled: false, reason: result.reason || 'action-rejected' };
      }
    }

    if (state === live) resetVisibleNudge();
    if (chosen && chosen.deferMinutes) {
      const request = snapshot.type === 'routine' ? canonicalRoutine(snapshot.context) : snapshot.options;
      if (request) deferrals.schedule(snapshot.instanceId, request, nudgePolicy.deferralDelayMs(chosen.deferMinutes));
    }
    return {
      handled: true,
      actionId: snapshot.actionId,
      type: snapshot.type,
      deferMinutes: chosen ? chosen.deferMinutes : undefined
    };
  }

  // The corner reminder ignores the pointer until the renderer says the cursor is
  // over something clickable, so a character never swallows a stray click.
  function setPointerInteractiveForSender(sender, interactive) {
    const target = corners.find(corner => corner.ownsSender(sender));
    if (!target) return false;
    return target.setPointerInteractive(interactive);
  }

  // Preview is deliberately separate; ordinary routine delivery always resolves
  // an existing canonical occurrence and cannot opt into preview with a payload.
  async function showLevel(opts) {
    if (disposed || dnd) return { shown: false, reason: disposed ? 'disposed' : 'dnd' };
    const level = nudgePolicy.clampLevelForType(opts && opts.type, opts && opts.level);
    const request = nudgePolicy.normalizeReminderRequest({ ...opts, maxLevel: level, whitelist: [] });
    const generation = resetVisibleNudge();
    const message = request.message || nativeCopy(nudgePolicy.chooseLine(reminderLines(request.character, request.type), random()));
    const live = { ...request, message, instanceId: nextInstanceId++, generation, timers: [], attempt: 0, preview: true };
    state = live;
    currentLevel = level;
    replaceReceipt(live);
    try {
      if (level === 1) showNotification(nudgePolicy.reminderTitle(request.type), message,
        generation, !request.soundEnabled, request.actions, live.receipt, live.attempt);
      else if (level === 4) createFullscreenNudge(request.character, message, request.actions, generation, live.receipt);
      else createCornerWindows(request.character, message, level, request, generation, live.receipt);
    } catch (error) {
      report(error, { channel: 'nudge:preview' });
      live.receipt.settle({ shown: false, reason: 'window-failed' });
    }
    return live.receipt.promise;
  }

  /**
   * Apply a sensory setting the user changed while a reminder is on screen.
   *
   * Turning stimulation down has to act on the surface, not just the next one:
   * the extra characters leave immediately and the survivors stop moving, so the
   * setting is felt where it was changed.
   */
  function updateSensoryProfile(profile = {}) {
    if (!state) return false;
    const sensory = nudgePolicy.mergeSensoryProfile(state, profile);
    state.motionMode = sensory.motionMode;
    state.stimulationMode = sensory.stimulationMode;
    const { calm } = nudgePolicy.resolveNudgeSensory({
      ...sensory,
      systemReducedMotion: probeReducedMotion()
    });

    let live = corners.filter(corner => corner.isAlive());
    if (sensory.stimulationMode === 'low' && live.length > 1) {
      live.slice(1).forEach(corner => corner.close());
      live = live.slice(0, 1);
      corners = live;
    }
    if (calm) live.forEach(corner => corner.haltMotion());
    live.forEach(corner => corner.send('nudge:sensory-profile', sensory));
    if (fullscreen) fullscreen.send('nudge:sensory-profile', sensory);
    return true;
  }

  function reconcileRoutineReminders() {
    deferrals.reconcile();
    if (state?.type === 'routine' && !state.preview) requireFresh(state);
  }

  function setDND(value) {
    const next = Boolean(value);
    if (dnd === next) return;
    dnd = next;
    if (!dnd) return;
    deferrals.cancel('all', { preserveRoutines: true });
    const live = state;
    if (!live || live.type !== 'routine' || live.preview) {
      resetVisibleNudge({ reason: 'dnd' });
      return;
    }
    const request = canonicalRoutine(live.context);
    if (!request) { resetVisibleNudge({ reason: 'routine-stale' }); return; }
    live.attempt += 1;
    live.probe?.abort();
    live.timers.forEach(timer => clearTimer(timer));
    live.timers = [];
    destroyCornerWindows();
    closeFullscreenNudge();
    notifications.closeAll();
    Object.assign(live, request, { signature: signature(request), limited: 'dnd' });
    if (!live.receipt || live.receipt.isSettled()) replaceReceipt(live);
    deliverFirstLevel(live);
  }

  function setActionHandler(handler) {
    actionHandler = typeof handler === 'function' ? handler : null;
  }

  // Asked before a reminder is raised elsewhere, so a meeting can suppress a
  // surface this host is not the one showing.
  async function isSensitiveForeground(whitelist) {
    if (disposed) return true;
    const result = await foregroundLookup(nudgePolicy.sanitizeWhitelist(whitelist), lifetime.signal);
    return disposed || !result || result.inWhitelist;
  }

  function dispose() {
    disposed = true;
    lifetime.abort();
    actionHandler = null;
    resetVisibleNudge({ deferredPolicy: 'all', reason: 'disposed' });
  }

  return Object.freeze({
    startNudgeSequence,
    clearNudge,
    dismissCurrentNudge,
    showLevel,
    setDND,
    setActionHandler,
    reconcileRoutineReminders,
    setPointerInteractiveForSender,
    updateSensoryProfile,
    dispose,
    isSensitiveForeground,
    CHARACTERS
  });
}

module.exports = { createNudgeHost, systemPrefersReducedMotion, CORNER_KEYBOARD_ACCELERATOR, CORNER_KEYBOARD_LABEL };
