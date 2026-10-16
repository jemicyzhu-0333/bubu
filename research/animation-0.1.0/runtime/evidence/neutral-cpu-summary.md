# Neutral04 CPU observation

Real fixed-hash assets through prepareNeutralPack → ActorPool. Node v24.19.0, Three 186. One warmup and five measured repetitions per case. All times below are medians in milliseconds; raw samples and source fingerprints are in neutral-cpu.json.

| Source | Actors | Preflight | Prepare | Cold create incl parity | Remaining cached clones | Group disposal |
|---|---:|---:|---:|---:|---:|---:|
| static05 | 1 | 13.4544 | 23.5014 | 31.0849 | 0.0005 | 0.0926 |
| static05 | 4 | 9.1091 | 18.6436 | 30.8320 | 0.7694 | 0.0650 |
| r6 | 1 | 43.7659 | 62.0247 | 144.6351 | 0.0006 | 0.0619 |
| r6 | 4 | 22.6654 | 42.9470 | 93.1782 | 1.3679 | 0.0721 |

Cold creation includes parsing, all-array numeric parity, material/rest checks and the first clone. It is intentionally larger than a pure GLTFLoader timing. Cached-clone time is the remaining three actors for four-actor cases; single-actor cases have an empty group. Prepare includes local file reads, SHA256, preflight and profile checks. These operations can allocate; they are not frame-time claims.

static05 actual geometry backing: 2,337,048 B; r6: 8,044,044 B. Reservations are separately conservative: 4,679,628 B / 16,200,432 B. Source encoded bytes and prepared/parse copies, transient comparison arrays, JS metadata, skin state, renderer staging and GPU allocation must not be conflated.

All 24 lifecycle iterations (4 warmups +20 measured) returned owned counters to zero. Source hashes before/after match. CPU getVertexPosition calls:0. The neutral advance loop is a no-op and is not evidence of rendering speed. No WebGL, GPU, native/Electron, artistic appearance or animation-expression acceptance claim.
