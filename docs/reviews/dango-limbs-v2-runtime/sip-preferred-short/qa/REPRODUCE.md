# Original preferred-source geometry audit

This compact QA package records the previously completed audit of the exact preferred middle-column painter, not the subsequently integrated short-source selector. `results.json` retains aggregate results and original-source diagnostics; `input-hashes.json` was checked against the four existing PNG files. No per-frame rows or bulk frames are checked in. The sole PNG is the existing inspected two-phase comparison; its depth candidate is diagnostic-only and is not promoted.

## Baseline isolation

`audit.mjs` deep-clones the imported manifest and explicitly disables every `sip-front-short-v1` and `sip-front-v2` source gate in that in-memory clone. It checks that the imported manifest is unchanged and that the baseline artist never resolves either source selector. It then forces the original immutable `sip-front-v1/left-logical.png` and `right-logical.png` through the same foreground painter as the middle-column oracle, translated solely by original cup position minus `[23,43]`.

This matters after short-source production is enabled: the source geometry must still be measured independently of any new visibility envelope. Recovery uses original `handoffRecovery`, original hand opacity and original prop opacity, plus a separate forced-opaque geometry measurement. No new envelope is introduced into this source audit.

## Reproduction

Use Node with the repository's existing `@napi-rs/canvas` dependency and Python 3. Both arguments must be absolute paths. All dynamic module imports use `pathToFileURL`; subprocess arguments are passed as a list. Spaces in either path are supported. Generated output must be outside the repository.

From this QA directory, replacing the quoted paths:

```sh
node --expose-gc audit.mjs --repo="/absolute/repository" --out="/new/smoke audit" --smoke
node --expose-gc audit.mjs --repo="/absolute/repository" --out="/new/ordinary audit" --full
node --expose-gc audit.mjs --repo="/absolute/repository" --out="/new/outline audit" --outline
python run-recovery.py --repo="/absolute/repository" --out="/new/recovery audit"
```

The smoke covers p0 and p.5 at DPR 1/1.25/1.5/2, writes JSON only, and records the imported-versus-baseline gate states. `portable-smoke.json` contains the verified compact result from running with spaces in both repository and output paths while the imported short gates were enabled.

The recovery helper uses 17 serial workers: sixteen 16-phase batches and one final phase. Each worker is explicitly bounded; direct recovery runs larger than 32 phases are rejected to avoid unbounded offscreen-Canvas memory accumulation. The merged result checks exactly 1,028 rows and 257 distinct recovery phases. Full results remain in the external output directory.

Optional reproduction of the already evaluated single depth diagnostic or existing comparison images is listed in `excluded-reproducible.json`. Default/full geometry runs do not emit images. Do not treat a depth-partition diagnostic as accepted source artwork.

## Interpretation

- Ordinary 257-phase and recovery 257-phase sweeps each covered four DPRs.
- No measured hand–cup gap, exposed proximal-cut cell, body-alpha-below-240 cut cell or face overlap.
- Each hand and hand+cup alpha union stays 4-connected. Two original 8-connected black outline arcs remain two throughout the ordinary sweep.
- Proximal cut means source alpha-boundary cells within 1.1 art units of the authored cut, not the entire outer forearm contour. Geometric containment does not claim a foreground source-color seam is visually buried.
- One complementary depth split preserved all source pixels but left six colored frontier cells per side different from the underlying body. It was not promoted.

These are offscreen actual-artist source-geometry checks. Final integrated entry/exit/interruption behavior, native browser/Windows/macOS playback, and visual acceptance are separate checks. No full production suite is claimed by this package.
