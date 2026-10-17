# Independent theme-state verification

Scope: pure ledger semantics only. No renderer, visual effect, production adapter, durable outbox, asset or source authenticity certification. User decisions supersede r3 proposals: routine default 600s, explicit presets 600..900s, feed 30s, no history activation, edits do not extend deadlines.

Independent oracle: each accepted semantic completion has an immutable first deadline and separate current deadline, version and revocation. At time t, eligible sources are non-revoked ready sources where t < current deadline. Theme projection is the set union; deadline = maximum source deadline, never sum. Event/source ordering and compaction must not revive previously handled or revoked business instances. API and clock protocol are to be frozen with implementation before executable cases are authored.

Required matrix:
1. Short/long same-theme ordering both directions; independent removal; same-time expiry; precise deadline minus 1 / exact / plus 1.
2. Duplicate event, changed delivery ID/generation, changed mapping; lower/equal version, revoke before completion, independent completion generations reusing occurrence IDs.
3. Routine default and both duration endpoints; invalid intermediate/fractional/nonfinite/unsafe values; feed exact fixed 30s.
4. Text/time correction later/earlier, historical/new recovery events, skipped/failed/cancelled/pending feeds, true second transaction versus replay.
5. Unknown/unapproved/unready mappings and later changes; exact matching versus title/coarse-kind; no revival on remapping.
6. Delayed events, hidden TTL, restore remaining lifetime, UTC forward/backward jumps and protocol mismatch; provenance/time trust must be explicit.
7. Source switch/invalidation and stale callbacks; detection toggle cannot clear routine/feed; focus and visuals explicitly outside ledger coverage.
8. Capacity exhaustion must fail closed explicitly, not silently drop dedup; compaction watermark ownership/order; old replays cannot revive; bounded retained state.
9. Invalid checkpoint last element cannot partially import; copy/immutability input and output; restore cannot manufacture eligibility/deadline or change source identity.
10. Strict records: accessor/getter does not run; prototypes, inherited keys, symbols, non-enumerable keys, array extra fields/holes; nested objects checked too. Proxies cannot in general be made side-effect-free and are separately documented.

Results will identify concrete tests actually run and remaining integration gates; case counts alone are not evidence of effect correctness.
