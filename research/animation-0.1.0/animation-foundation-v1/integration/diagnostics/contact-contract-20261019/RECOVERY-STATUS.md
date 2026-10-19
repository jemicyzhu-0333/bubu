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
