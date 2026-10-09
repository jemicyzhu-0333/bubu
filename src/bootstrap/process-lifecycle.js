'use strict';

function registerProcessLifecycle({
  lifecycle,
  mealRuntime,
  appHost,
  powerHost,
  isSessionRunning,
  pauseActiveSessionForInterruption,
  setScreenLocked,
  resumeAfterInterruption,
  activatePrimaryWindow,
  closeStorage = () => {}
}) {
  lifecycle.register('electron:app-lifecycle', appHost.subscribeLifecycle({
    keepAliveWithoutWindows: true,
    onSecondInstance: activatePrimaryWindow,
    onBeforeQuit: () => {
      if (isSessionRunning()) pauseActiveSessionForInterruption({ publish: false });
    },
    onWillQuit: () => { try { lifecycle.dispose(); } finally { closeStorage(); } }
  }));

  function startPowerMonitoring() {
    lifecycle.register('electron:power-monitor', powerHost.subscribe({
      onSuspend: () => {
        mealRuntime?.suspend();
        if (isSessionRunning()) pauseActiveSessionForInterruption();
      },
      onLock: () => { mealRuntime?.interrupt(); setScreenLocked(true); },
      onUnlock: () => { mealRuntime?.interrupt(); setScreenLocked(false); },
      onResume: () => { mealRuntime?.resume(); resumeAfterInterruption(); }
    }));
  }

  return Object.freeze({ startPowerMonitoring });
}

module.exports = { registerProcessLifecycle };
