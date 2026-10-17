# Observer isolation fix 01

This is a new copy of the frozen P0 closure. The original directory/backup remains unchanged. Only diagnostic observation isolation changes; no timing, art, priority, lifecycle identity or production-renderer integration capability is added.

## Contract

`onRecord` is a synchronous diagnostic observer, not a control callback. Lifecycle records are accumulated for one bounded canonical timestamp boundary and delivered in their original order only after that entire boundary's core state is committed. A callback reading state observes the committed end-of-boundary state, not necessarily the historical intermediate stage named by each record. Each record carries its canonical event time/token. The boundary is never rolled back or replayed because observation fails.

Any synchronous observer exception is caught. The observer is disabled permanently for that Director instance after its first failure; pending diagnostic records are dropped, and no later observer invocation occurs. Core clock/lifecycle/input processing continues. This bounded circuit-breaker avoids repeatedly invoking a broken observer or retaining an unbounded error list. Read-only `observerStatus` reports enabled/disabled, failure kind and the record's type/time/token. No raw exception object or user-defined error property is read or retained.

Callback mutation (`submit` or `advance`) remains forbidden during delivery. It throws before mutation. If the observer does not catch that error, normal observer isolation disables it; if it catches it, core processing still continues without changes. Read-only state/progress/lifetime queries are allowed; progress represents the last completed advance call while delivery occurs inside the current advance.

A native Promise return is unsupported asynchronous observation: attach a rejection-consuming handler, disable the observer immediately, and expose `async-return` status. The director does not await it or treat later async work as an event/control channel. General thenables and hostile code are not supported. A synchronous callback may return an ordinary unused value (e.g. Array.push's integer) for compatibility.

This does not isolate `apply`, the core semantic output sink. Its existing trusted non-throwing, non-reentrant contract remains; production fault/dispose integration is a separate gate and is not certified by this patch.

## Verification

Tests inject a throw at every record type (request, arrival, release, exit-start, gap-start, done, reset), then exercise later lifecycle progress, owner release/global reset, large jumps, and bounded continuation. They compare final state/semantic writes to a no-failure run, verify one-shot observer disablement and bounded diagnostics, and test both propagated and caught mutation attempts. Records are delivered only after committed boundary state.
