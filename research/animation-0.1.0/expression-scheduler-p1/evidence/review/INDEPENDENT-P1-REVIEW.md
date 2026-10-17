# Independent P1 correctness review

Result: PASS for the documented opt-in reference scheduler and P0 binding. No production artistic configuration is approved or activated.

Evidence: `independent-p1.mjs` / `independent-p1.json` pass 8/8 focused groups; the implementation suite independently reruns 16/16 (`independent-full-suite.txt`). Reviewed source hashes are recorded in the JSON.

Verified:
- Different integer weights affect selection, not authored amount; fixed durations consume no duration RNG. Uniform hold/gap sampling remains separate from the selection stream.
- Same seed reproduces choices. Rejected or interaction-owned decisions do not commit RNG/history.
- Zero weights and recent semantic aliases yield Infinity when nothing can become eligible with time; cooldown yields its exact future wake.
- Primitive seed/weight ranges reject unsupported values and excessive total weight.
- A real request at a decision timestamp wins before random sampling. Real release subsequently allows an actual autonomous arrival, not merely a logged selection.
- Reused request labels with old host lifetimes cannot cancel new interactions.
- Actual P0 arrival starts the sampled hold; actual Basis completion starts the sampled gap. Budget-1 30/60/120 Hz runs match large-jump records and final state.
- An empty eligible context truly sleeps without animation or random consumption.

Issues found and fixed during review:
1. The first binding attempted idle selection exactly when a real owner's P0 gap expired. P0 still retained real-owner priority for that batch, rejected the idle request, but the scheduler committed random state and then stalled at Basis forever. The binding now releases the old matching real identity in that same batch before accepting idle.
2. The first public release adapter matched only owner/requestId and substituted the latest P0 lifetime, allowing stale same-label release to cancel new work. Public host lifetimes are now mandatory and verified before mapping.

Adaptation boundaries reviewed in CONTRACT.md:
- The module imports the canonical runtime-facepath05 owner08/full18 Director. It contains no independent FaceTimeline or morph writer; apply remains the existing P0 sink.
- Normal cooldown begins at Basis. Interrupted cooldown begins at semantic invalidation, not physical old-face disappearance. Recent history counts accepted selections, not actual exposure. These are deliberate narrower semantics than the broad proposal.
- Reset is actor-intent reset; previously admitted future host facts/events remain authoritative. It is not a binding-wide queue cancellation.
- P0 hold=3600 and gap=.001 are adapter sentinels. Real interactions retain that finite safety ceiling; this is not an indefinite long-press lifecycle API.
- `enabled:false` safely suppresses/releases autonomous work, not wall-clock freezing. Physical input integration and shared visibility-clock remapping remain outside this module.
- Diagnostics retain 2048 records, not an unlimited replay archive. Production policy remains null. No renderer, GPU, visual naturalness, full-library mapping or production activation claim is made.

All test timing, weights and face mappings are fixtures, not product defaults. Frozen runtime and existing renders were not changed by this review.

## Canonical dependency re-verification

The earlier observer01-dependent result is superseded for publication. In the restored Git-relative layout, independent 8/8 and implementation 16/16 tests were rerun against the actual canonical imports. No copied Director or FaceTimeline is introduced into the scheduler.

Dependency root: `runtime-facepath05/src`.
- director.mjs: 8e2398af1a63017892ef85aef35afee350891f0e44043b917709a94ffa3fa4ec
- face-timeline.mjs: 286ded8d6c6992cd0333e1985a0baee0e21dd951dcf3ab91b8bb790cd7641892
- approved-full-face-source.mjs: d7ad8d998bfd0c7845a6796b7f49df360a2b5c4888abe0d4f3573d29c27d0bc3

ADMISSION uses canonical full18 metadata. The probe now captures these dependency hashes and admitted face count on every rerun. Passing these scheduler tests is not equivalent to independently testing every full18 art path or renderer.

Final strict-input refresh: non-enumerable fields explicitly reject before copying. Existing independent 8/8 groups and implementation 16/16 tests rerun after that change.

Final scheduler SHA256: 8208537ace569c8227ca86dd0389d91ac150006b541347ebeccbf06a91ce07c8
Final binding SHA256: 819b3b2d9bb092b96f142e041260c3864c6934b0472b150b1e75ec3e5773c85a

Final capacity refresh: external batches now cap at 30 events, reserving two slots for internal P0 intents. Existing independent 8/8 tests rerun successfully after this change.
