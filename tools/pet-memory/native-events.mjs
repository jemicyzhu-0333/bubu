// Native events remain authoritative when backgroundThrottling:false makes the
// document visibility state stay visible. Keep bounded phase counters, not history.
export const NATIVE_EVENT_KEYS = Object.freeze(['hide', 'minimize', 'suspend', 'lockScreen',
  'displayAdded', 'displayRemoved', 'displayMetricsChanged', 'childProcessGone']);
export const NATIVE_AUDIT_LIMIT = 64;
export const STARTUP_POLICY = Object.freeze({ quietMs: 1000, timeoutMs: 10_000, rendererReadyTimeoutMs: 15_000 });

export function observeNativeEvents({ window, app, powerMonitor, screen, now = () => performance.now() }) {
  const emptyCounts = () => Object.fromEntries(NATIVE_EVENT_KEYS.map(key => [key, 0]));
  const startup = emptyCounts(), measured = emptyCounts(), listeners = [], events = [];
  let totalEvents = 0;
  let active = true, armed = false, lastDisplayEventAt = now();
  function watch(target, event, key) {
    const listener = (...args) => {
      if (!active) return;
      const counts = armed ? measured : startup;
      counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + 1);
      const atMonotonicMs = now();
      if (key.startsWith('display')) lastDisplayEventAt = atMonotonicMs;
      totalEvents++;
      if (events.length < NATIVE_AUDIT_LIMIT) {
        const value = args[1];
        const details = key.startsWith('display') ? { id: value?.id ?? null, scaleFactor: value?.scaleFactor ?? null,
          bounds: value?.bounds ? { ...value.bounds } : null,
          changedMetrics: Array.isArray(args[2]) ? args[2].slice(0, 16).map(String) : [] }
          : key === 'childProcessGone' ? { type: value?.type ?? null, reason: value?.reason ?? null, exitCode: value?.exitCode ?? null } : {};
        events.push({ atMonotonicMs, phase: armed ? 'measuring' : 'initializing', event: key, details });
      }
    };
    target.on(event, listener); listeners.push({ target, event, listener });
  }
  watch(window, 'hide', 'hide'); watch(window, 'minimize', 'minimize');
  watch(powerMonitor, 'suspend', 'suspend'); watch(powerMonitor, 'lock-screen', 'lockScreen');
  watch(screen, 'display-added', 'displayAdded'); watch(screen, 'display-removed', 'displayRemoved');
  watch(screen, 'display-metrics-changed', 'displayMetricsChanged');
  watch(app, 'child-process-gone', 'childProcessGone');
  const snapshot = () => ({ ...measured });
  const quietForMs = () => now() - lastDisplayEventAt;
  const audit = () => ({ maxEvents: NATIVE_AUDIT_LIMIT, totalEvents, truncated: totalEvents > events.length, events: structuredClone(events) });
  return Object.freeze({ snapshot, quietForMs, audit,
    beginMeasurement() {
      if (!active || armed) throw new Error('Measurement boundary can be established only once');
      const quiet = quietForMs();
      if (!Number.isFinite(quiet) || quiet < STARTUP_POLICY.quietMs) throw new Error('Display initialization has not settled');
      armed = true;
      return { phase: 'measuring', startupNativeEvents: { ...startup },
        policy: STARTUP_POLICY, quietForMs: quiet, armedAtMonotonicMs: now() };
    },
    stop() {
      active = false;
      for (const { target, event, listener } of listeners) target.off(event, listener);
      return snapshot();
    }
  });
}

export async function waitForDisplaySettle(observer, {
  now = () => performance.now(), delay = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const startedAt = now();
  while (observer.quietForMs() < STARTUP_POLICY.quietMs) {
    if (now() - startedAt >= STARTUP_POLICY.timeoutMs) throw new Error('Display initialization did not settle within startup budget');
    await delay(50);
  }
}
