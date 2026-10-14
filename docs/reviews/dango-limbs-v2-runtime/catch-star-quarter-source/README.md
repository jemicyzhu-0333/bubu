# Catch-star: authored quarter hold and free helper

The default manual `catch-star` action now uses a source-authored right fore/palm, with its proximal material behind the unchanged body and its complete palm/wrist contour in front. These are **two material records for one anatomical right arm**: one existing back-layer tool material and one foreground palm hand. The original tools are preserved, with only the proximal material appended. The late left hand is a same-view alias of the accepted snack resting-hand source, lifting at most2.5 art units as a free preparatory gesture. It does not claim to touch the star.

## Source and scope

- Source package: `assets/companion/dango/raster/action-contact/catch-star-quarter-v1/`. The original official imagegen master, prompt, ordered reference provenance, independently reviewed masks, compact recipe and portable rebuild are retained. Generated body, eyes, feet and star were discarded. The original source wrist crease is retained.
- One fixed .1 source projection; all runtime movement is translation. Uniform source coverage uses35% alpha and20% ink thresholds, then fixed source4 palette/binary alpha/transparentRGBA0 and exact nearest8×.69 logical pixels split disjointly into43 palm/wrist foreground and26 proximal fore background. The split union is byte-exact.
- This quantization is **not source-pixel-identical**: real source ink area18.73 art² becomes30 logical black pixels (+60.17%). The increase and per-cell original source hashes are recorded. No hand-painted ink or per-cell threshold override.
- Root cut is an explicitly reviewed internal cut through continuous source fore/body fill, not a claimed natural seam. It excludes a previously overlong extraction of the generated body's side contour. No production body or star was moved.
- Right hand is a free approach beforep=.42, then continuous star hold/lowering. The original star path, face, feet, body, tools and action timing stay unchanged. The original left helper was not a star-bound grip; its replacement deliberately stays near its own flank.

## Verification

Actual production selector/artist:2,064 frames over129 phases, DPR1/1.25/1.5/2, both facings and bare/heavy wardrobe;938 lifecycle frames covering finish, sip interruption, clear/reopen, reduced/resume and heavy mirrored playback. All pass. Eight same-input frames at DPR1/2,p=.25/.5/.8/.9 match the separately frozen helper oracle in every RGBA component. No production QA injects an artwork pose; only the explicitly labeled parity oracle does.

The portable actual-production pixel check passes1,032 frames. It asserts final draw-call order **back material → canonical cached body pasted to stage → star → foreground palm** on every frame. Body cache and stage canvas dimensions differ: body alpha is mapped through its actual final drawImage transform into the same stage-size buffers before comparison. All30,792 right-root and15,288 helper-root device samples are covered by canonical body alpha>=250. Held palm/star alpha intersects continuously, minimum60/94/137/238 device pixels for DPR1/1.25/1.5/2.34 changed eye-sprite margin pixels are source-pink; black-eye/white-highlight and unknown nonpink changes are0. Existing star occlusion is excluded by same-phase baseline. No hand or prop offset was introduced to silence that alarm.

Pre-publication correction: the initial candidate used an unsupported behind-body paw flag, and its old root audit incorrectly indexed a cached-body canvas as if it had stage dimensions. Those old root results and depth claims are withdrawn. The helper now uses the existing supported back tool layer; all reports here were rerun on that corrected production helper. Back tool opacity is multiplied by the production tool painter's action envelope exactly once; the foreground palm receives the same effective envelope.

Formal tests cover source hashes/palette/8×/partition, immutable transforms, metadata/original-contact mutation rejection, all-resource atomic load/failure/loss, full-episode readiness lock,16 channels, cancellation/restart, real delayed decode, and257 real-artist phases with actual generic-host fallback. See `final-validation.json` for the final repository-wide check, integration result and file hashes.

These are real **offscreen Skia** renders, not native Windows/macOS or browser visual acceptance. The previously denied local preview URL was not retried. Catch does not emit `handoffRecovery` in the observed lifecycle; no fabricated recovery-frame coverage is claimed. Other requested action/material repairs remain open, so the complete repair remains NO-GO for merge/release.

## Reproduce

From repository root:

    python assets/companion/dango/raster/action-contact/catch-star-quarter-v1/rebuild.py --output-dir /tmp/catch-star-rebuild
    node --test test/dango-catch-star-contact.test.mjs
    node docs/reviews/dango-limbs-v2-runtime/catch-star-quarter-source/scripts/full-phase-qa.mjs --out /tmp/catch-star-qa
    node docs/reviews/dango-limbs-v2-runtime/catch-star-quarter-source/scripts/lifecycle-qa.mjs --out /tmp/catch-star-qa
    node docs/reviews/dango-limbs-v2-runtime/catch-star-quarter-source/scripts/selector-parity-qa.mjs --out /tmp/catch-star-qa
    node docs/reviews/dango-limbs-v2-runtime/catch-star-quarter-source/scripts/contact-pixel-qa.mjs --out /tmp/catch-star-qa

The rendering scripts accept`--repo`, `--out` and optional`--images`; fixtures and generated images go outside the repository. The source rebuild was also verified from an independent directory containing only the minimal file list, rebuilding all six PNGs byte-exact. Pillow12.3.0 was used for encoded-byte verification. `--full-audit` reconstructs the expanded per-source mapping.

Excluded reproducible outputs: expanded1.43MB source mapping, generated renderer fixtures, every phase frame, preview images, videos and the original rendered imagegen reference. Reference reconstruction inputs and its original hash are retained in generation provenance. No existing user artifact was deleted.
