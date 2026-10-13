# Distinct forearm and level-support study: reproducible overlay

This is a backup staging bundle for two unfinished asset candidates. It contains no production activation and no replacement canonical body. Generated full-character masters are anatomical source studies only.

## Acceptance limits

- Distinct forearm: source extraction, all sixteen directions, all 256 joint alpha unions, and the five registered static examples passed independent checks. Actual forced sip-tea, hiccup and keyboard frames still fail wrist/root contact and contour acceptance. The fixed-right-shoulder fragment and open hold-root seam remain unresolved. Keep runtime fallback; do not describe these candidates as accepted production arms.
- Level support: two exact-downward-normal reprojections are included. The measured action audit only passed the strict contact gate in **64 of 516** samples. 443 had a level candidate; 187 had a non-penetrating candidate. Level orientation alone is not planted support acceptance.
- Neither result authorizes a whole-body replacement, new contact geometry or shoulder movement. Existing upper/body/face sources remain external and unchanged.

## Bundle contents

- `masters/`: complete unmodified new short-arm v1/v2 source PNGs and exact saved prompt text; existing v1 provenance retained verbatim. The v2 generation model/seed and attachment order are not invented when unavailable in the original saved record.
- `expected-overlay/`: sixteen new forearm logical/8×/pivot sets; two level-support sets; new forearm crop and extraction recipe; 256 regenerated joint repair sets and contact sheet; exact frame JSON records. This is a thin overlay, not the full old asset package.
- `build_forearm.py`, `build_level_support.py`, `build_joint_pairs.py`: output-safe staged versions with explicit `--canonical-package` and `--output`. They never write to the canonical dependency.
- `rebuild_overlay.py`: validates dependency hashes and builds a fresh thin candidate overlay.
- `check_overlay.py`: checks palette, binary alpha, exact8×, source identity, actual joint union alpha and optionally byte-for-byte equality to the preserved candidate outputs.
- `render_overlay_previews.py`: resolves an overlay file first and falls back to the explicit canonical package for unchanged sources; rebuilds the five static examples without copying the old package.
- `original-scripts/`: byte-preserved historical input scripts, kept for provenance only. Do not execute these originals: they retain their original environment assumptions. Use the staged top-level CLI scripts instead.
- `evidence/`: original independent forearm review, actual failed runtime diagnostic and contact numbers, level-support audit, static preview evidence, and current packaging checks.

## External dependency

Supply a read-only canonical Dango limbs package containing its original `limbs.json`, `sources/rebuild-recipe.json`, source crops, existing upper/old-fore sprites and canonical preview sources. `canonical-dependency.json` pins the required inputs by SHA-256 and rejects a different baseline. No prior asset pack is copied into this bundle.

Requirements: Python 3.10+ and Pillow 12.3.0 (`requirements.txt`). No image-generation service, API key, browser, network or credential is needed to reproduce the saved-source extraction.

## Rebuild and check

Use paths chosen for the current machine. OUTPUT must be new or empty, outside both the canonical package and this staging directory.

```sh
python rebuild_overlay.py --canonical-package /path/to/canonical/limbs --output /path/to/new-arm-overlay --verify
python render_overlay_previews.py --canonical-package /path/to/canonical/limbs --overlay /path/to/new-arm-overlay --output /path/to/new-static-previews --verify
```

The first command:
1. Verifies external input hashes.
2. Copies only the new preserved masters into the new overlay.
3. Recreates the new crop, sixteen tapered forearm frames and metadata from the saved v2 master.
4. Creates merged manifest/recipe metadata referring to external unchanged assets; replaces only forearm records.
5. Reprojects the two existing source support palms to an exactly downward contact normal and appends those candidate records.
6. Regenerates all 256 joint pairs against unchanged canonical upper arms and the distinct new forearms.
7. Checks all new outputs against 1,340 preserved candidate files.

The second command resolves unchanged images directly from the canonical dependency. Its `--verify` compares native/2× pixels against the preserved reviewed static examples, not against a newly invented expected rendering.

The resulting `limbs.json` and rebuild recipe are overlay metadata; absent unchanged assets resolve from the external canonical package. Do not point production at the thin overlay as if it were a standalone runtime pack. A runtime integration must provide overlay-aware resolution or independently apply the overlay to an authorized disposable full working package, and must retain the failed runtime gates. `runtimeReady` is explicitly false.

## Current packaging verification

The reproduced overlay matches all 1,340 stored candidate outputs byte for byte. Eighteen new base frames satisfy binary alpha, the allowed four-color palette and exact nearest-neighbor8×. All 256 reconstructed joint edits preserve the actual source union alpha; 208 pairs are legal. Five static native/2× examples match prior review pixels exactly. These are offline reproduction results, not action-wide runtime acceptance.

No new generation, upload, publication, production write, source-pixel reshaping or wardrobe change occurred during packaging.

## Complete source archive

`arm-study.tar.gz` contains all masters, exact prompts, original and portable scripts, source crops, recipes, all 1,340 candidate outputs, checks and review evidence. Extract into a new directory before using the commands above. Verify ARCHIVE.sha256 first. It is a disabled study, not a production asset package.
