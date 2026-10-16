# Authoredclip03 increment over measurement02

Development version stays0.1.0; this is a reviewed foundation checkpoint, not a product release.

## Runtime changes

- Optional manifest.clips asset and explicit authored-quaternion-clips capability.
- Strict independent joint/accessory quaternion tracks with STEP or LINEAR sampling, unequal holds, exact phase endpoints, bounded key spacing and combined-angle limits.
- A playClip event uses an explicit linear-spherical entry bridge from the sampled current pose. Authored time starts after that bridge. Existing target events remain separate; they do not smooth authored key timing.
- Small-angle/cross-axis interpolation uses true shortest-arc spherical interpolation rather than Three's small-angle normalized-linear approximation. Exact endpoint copies preserve event-time values.
- Existing target primitive rotations now normalize/canonicalize before planning, and cap validation uses normalized angle. This closes a tiny normalization discontinuity when a legally near-unit target was followed by a clip.
- Final authored values hold without active clip references. Same-time play/playClip events share insertion order; cancel still wins and invalidates queued generation events.
- Key scalars are charged per actor; encoded clip-library bytes join shared source admission. Invalid/budget-exceeding packs reject before actor activation.

## Review corrections

- Validation-only floating arithmetic allowance at the exact0.1ms minimum key gap; no epsilon shifts STEP sampling edges.
- Near-unit target → authored entry now tends continuously to the event-time pose as dt tends to zero.
- Added exact decimal and large-clock-origin boundary tests, non-collinear/small-angle/sign-equivalent quaternions, same-time mixed playback, cadence equivalence, malformed data, admission and disposal regressions.

## Scope retained

No art package, expression-key track, root motion, retarget, surface contact, final long-press/drag, live equipment transaction, gaze/brows, visual LOD or real GPU capability was activated. Mechanical fixtures retain the original geometry/profile. The old measurement02 package and its published evidence stay frozen.
