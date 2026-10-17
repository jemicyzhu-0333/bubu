# Candidate D facial accents — pending user acceptance

This is a small recoverable candidate backup, NOT approval, production registration, or runtime integration. Approved 18-expression assets and runtime remain unchanged.

## Review
- review/review-original-vs-candidate-d.png: original versus candidate, P2 and N3 front.
- review/P2-local-soft-quarter.png: three-quarter detail.
- Individual P2 and N3 front renders are also included.

## Restore using the already tracked approved source
Requirements: Blender 4.3.2; Pillow and DejaVu Sans for assembling the review only.
Use the repository's existing expression-library/approved-v1/shared-library/bubu-expression-library-v1-look.blend.gz and face_library.py. No source archive or generated Blender binary is duplicated in this backup.

Run from any working directory, supplying paths explicitly:

    blender -b --python PATH_TO_THIS_BACKUP/rebuild.py -- --source PATH_TO_APPROVED_SHARED_LIBRARY/bubu-expression-library-v1-look.blend.gz --out RECOVERY_OUTPUT --render
    python PATH_TO_THIS_BACKUP/compose_review.py --input RECOVERY_OUTPUT --out RECOVERY_OUTPUT/review-original-vs-candidate-d.png

The mapper defaults to face_library.py next to the source archive; --mapper accepts an explicit path if needed. Both source hashes are checked before loading. Omit --render for a quick geometry/color rebuild. Outputs include P2 and N3 .blend scenes, exact-geometry/local-color audits, and optionally five renders. The preview originals use 96 samples on rebuild, versus the earlier supplied comparison's 48-sample original column; geometry, colors, lights and camera remain identical.

## Parameters
Both cheeks use center x=±0.61,z=0.80; compact support radii x=.27,z=.17; squared radial falloff; front-surface smooth gate; peak mix multiplier .72 toward linear RGB (.95,.090,.125). It modifies 1111 body vertices after float32 rounding (1112 have mathematically nonzero weights) out of 45945. Colors outside the support are exactly unchanged.
N3 only: existing mouth center gets a warm-dark color field with strength .85, preserving the outer black edge. Its tongue geometry/material remain exactly original. P2 gets no mouth modification. All body and facial coordinates, topology and shape-key arrays remain exact.

## Checks
The new explicit-input rebuild recovered BOTH latest P2 and N3 successfully. audits/audit-P2.json and audit-N3.json verify geometry, outside-support color identity and color hashes. saved-vs-recovered-colors.json verifies the recovered color attributes exactly match the candidate scenes used for the delivered review. Geometry identity reports include every mesh and shape key.
Dynamic amount mapping, all intermediate-color transitions, side-view material transitions, GLB shader parity and runtime integration are not accepted or implemented here. No production hash has been registered. Await user visual choice before expansion.
