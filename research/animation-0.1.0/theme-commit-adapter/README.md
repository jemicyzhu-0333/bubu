# Committed routine/feed → theme adapter candidate

Functional implementation against fixed main `1a66a0d3b7a51b19ac843b80f6629d0eb20eeb18`. No root source tree, remote branch, user computer, real profile or account was modified. `overlay/` contains exact production target modules; `production-main.patch` contains the same edits. `MANIFEST.json` records original/current SHA256 and original Git blob identities. Apply only after checking the exact baseline and reviewing the schema upgrade. This is not a deployed animation feature.

## Implemented behavior

- Routine completion metadata belongs to the existing `routineLog` transaction. UUID generation is an application port; pure domain functions receive IDs and timestamps. The immutable completion identity records original occurrence/commit time, origin, exact preset ID and mapping version. Corrected time has a nonincreasing deadline watermark.
- Same occurrence edits, explicit undo/restore, and done → skipped → done retain original generation and deadline. Recovery after expiry cannot mint another 10 minutes. A newly added free record is the existing API call with no `occurrenceId`; it is a distinct business intent and can reuse a freed raw slot with a fresh generation. Explicitly supplying the old slot denotes restoration/correction. A time-correction request cannot change slot identity.
- A bounded canonical correction-receipt list preserves removed identities across restart and beyond the theme TTL. Its 72-hour technical guard covers the today/yesterday correction window, including DST; it is not a new user-facing retention promise. At 256 receipts, overflow keeps business undo available and conservatively suppresses theme identity creation for requested slots until the correction guard expires. Facts expose `themeSuppressionReason`. A small-capacity test covers this behavior. Fresh independent free records remain possible.
- Legacy records have no fabricated live completion identity. Undo/restore of an old unidentified record stays ineligible. Existing inbox capture logging remains historical. No routine title or broad kind maps to coffee, exercise or another fine-grained preset.
- Feed result receipts preserve `commandId`, `issuedAt`, first `fedAt` and exact mapping version. A receipt replay returns its original time and no new committed fact; old receipts remain readable and replay with `fedAt:null`, never an invented timestamp. Receipt inner/outer identity mismatch is rejected.
- All adapter input originates after `transaction.committed`. Failed commands, revision conflict, failed repository commit and receipt replay emit no new theme success. Presentation/adapter failure does not roll back a successful business command.
- The adapter feeds the frozen V2 ledger. Default routine duration remains 600 seconds, explicitly registered presets may configure 600–900, feed 30. Individual sources keep separate deadlines and exact revoke targets.

## Production composition and remaining boundaries

`src/main.js` composes `bootstrap/theme-state-runtime.js`, passes mapping resolution into routine/feed commands, and forwards routine/inbox/feed postcommit facts. `bootstrap/companion-feeding.js` exposes a postcommit theme hook. The main-process wiring currently supplies Date.now(), which is not yet a rollback-resistant trusted clock. Before enabling a live production registry, supply and verify that clock boundary and the authority-backed restart reconciliation. The runtime is one ephemeral ledger per profile process under a stable producer namespace. It does not restore a ledger snapshot without an independently verified authority cursor, and it does not claim a durable outbox. Restart does not replay old completion as a new live event.

`content/theme-source-registry.js` is deliberately empty. The approved fine-grained preset catalog and ready artwork have not been identified in these sources. The optional preset ID hook exists in routine creation/domain/schema; no public IPC/UI preset picker is invented. Production therefore does not show an unregistered theme. The runtime exposes a projection, but this patch does not connect a renderer or assert actual visibility/performance. The scene-coordinator integration is headless plan verification, using test-only ready recipes.

The schema changes require schema21. The existing explicit, verified profile-upgrade path now offers 20 → 21, makes its existing full private backup before mutation, and validates old/new canonical forms. Migration itself changes only `schemaVersion`; it assigns no preset, ID or event to old history. Old 18 → 19 and 19 → 20 paths keep their explicit intermediate validators. Do not simply copy schema fields into a running schema20 application, silently normalize old profiles, or test against real profiles.

## Verification

Node 22.12+ is an existing project requirement; fixed-main package metadata specifies Electron `^44.0.0`. Cloud verification used Node 24.19.0, not an Electron GUI.

The publication contains only the changed target modules, patch, tests, manifests and restore script. It does not duplicate the complete application. From a local Git repository containing the pinned main commit:

    python3 restore-harness.py --repo /path/to/bubu --out /tmp/bubu-theme-adapter-harness
    cd /tmp/bubu-theme-adapter-harness
    node --test tests/*.test.cjs

The script reads Git objects without changing the checkout or contacting a remote. An exported exact-main source tree may instead be passed with --source-dir. Every source and overlay file is hash-verified; output must be a new directory. The tests and frozen scene fixture are self-contained after restoration.

24 tests exercise actual application workflows, actual routine/feed domain functions, actual UnitOfWork, the actual V2 ledger and actual SceneCoordinator. The commit suite uses a fake repository with real canonical validation, not a fake domain function. The upgrade suite uses real SQLite databases and the real upgrade/backup implementation, exclusively in generated temporary profiles. Cases include complete/edit/correct/undo/restore/new-record, expired restoration, legacy metadata, capacity fail-closed behavior, independent routine/feed TTL, feed replay/failure, real feed bootstrap, zero-ready production registry, full backup-byte comparison with live WAL, second reopen fixed point and six precommit failure boundaries.

`TEST-RESULTS.txt` records the run. `SHA256SUMS` freezes this publication. `SOURCE-MANIFEST.json` records exact source Git blobs and SHA256s from fixed main. Unrelated nonmatching development-stage files are omitted from the restore manifest. ISOLATED-HARNESS-RESULTS.txt records the clean isolated reproduction.

Not run: complete application architecture/build suite, Electron UI, real renderer frame validation, real profile upgrade, real OS integrations or production deployment. These remain separate gates before applying this candidate to production.
