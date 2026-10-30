# Recovery snapshot: unverified work in progress

accepted: false

This snapshot preserves existing contact analysis files after interrupted portability edits. It does not complete or validate the portability repair, rerun the analysis, approve a visual correction, or change the body/assets/default runtime. Paths and replay behavior remain unverified.

The original FREEZE-FILES.txt and SHA256SUMS.json are retained unchanged as historical evidence. The following seven files differ from that old hash list:

- README.md
- audit.py
- displacement.py
- export-motion.mjs
- export.mjs
- pin-depth.py
- verify-provenance.py

All other 35 entries covered by the old SHA256SUMS.json still match their recorded SHA256, including the existing analysis reports and input data. SHA256SUMS.json does not hash itself. This establishes byte preservation only; it does not establish validity of those analysis conclusions or the partially edited scripts.

The original static-cape and tea-keyframes input JSON retains temporary cloud-workspace source/asset/normal-file paths. These are preserved provenance fields, not portable dependency locations. Their presence and the incomplete script edits remain explicitly unresolved.

SNAPSHOT-MANIFEST.json records the current 43 preserved files plus this status document, with SHA256 and Git blob identities. It excludes itself to avoid recursive hashing. It does not supersede historical evidence or missing portability acceptance. No logs, dependencies or source models are added.

## Recovery verification, 2026-10-20

The interrupted snapshot above is retained as history. The missing `export-paths.mjs` and `portable-smoke.py` have now been implemented. All four sampled-data analysis scripts pass in a renamed Unicode directory from an unrelated cwd, preserving the original files. Current-source cape and tea exports match the frozen JSON structures/numbers exactly. The unified foundation verifier reruns these checks into a new external evidence directory and records current source hashes.

This closes the sampled replay/source-export portability task. It does not accept cape/tea compatibility, continuous collision, visual corrections or cloth performance. The old SHA256SUMS and SNAPSHOT-MANIFEST remain historical, not current-source manifests.

## Local-contact checkpoint, 2026-10-24

The same working tree and all five frozen model/controller identities remain
intact. Current evidence is in
[local-contact-20261024](../../../verification/local-contact-20261024/audit.json).
The final verifier completed 36 stages, 828 Node cases and two Python cases with
unchanged tested sources. The local collision proxy, rendered-pin witness and
short-run reporting contracts were corrected in isolated research code.

The production gates remain open: five full-outfit pairs, actual cloth strain,
cloth-to-trim coupling, CPU simulation cost and original cape/tea attachments.
Native/GPU checks are separately not run. Rejected candidate source snapshots,
saved failure geometries, independent replay scripts and raw logs are archived;
none changes frozen models or the default runtime. The old snapshot manifests
above remain historical and are not rewritten to cover this later work.
