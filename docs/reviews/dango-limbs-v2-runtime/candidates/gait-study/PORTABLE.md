# Portable offline gait candidate

Not integrated, not activated, not production-approved. All three generation masters remain untouched; v1/v2 remain rejected as complete gait sources. Eight candidate feet come only from v3. See README.md and playback-review/REVIEW.md.

Rebuild with Python/Pillow and Node: python rebuild.py --canonical-package PATH_TO_LIMBS_PACKAGE

The argument is the existing canonical limbs directory containing limbs.json and sources/canonical/render-reference.json. The dependency is explicit; no local computer path is required. The canonical body package is intentionally not duplicated. Generation is not repeated. Optional MP4 conversion uses ffmpeg and is not required for extraction/checks.

Provenance references beginning canonical-package/ identify assets beneath that supplied directory; references beginning gait-production/ identify this candidate package. Original image bytes and prompt text are retained. Portable metadata path normalization does not change source art.
